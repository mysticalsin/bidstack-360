// Inbound activity ingest: the one service behind POST /api/v1/ingest/activities
// (apps/api) and the MCP write tool activities_ingest (apps/mcp-server). Both
// surfaces validate with the same zod schema and land here, so dedupe, record
// mapping, key scope, PII handling and audit cannot drift between them.
//
// Dedupe: externalSource + externalId, folded with the org into
// Activity.idempotencyKey (globally unique column). A replay with identical
// content is skipped as `unchanged`; changed content updates the row.
//
// PII: participant emails are never stored on the activity. They are resolved
// to a Contact (Contact.email is in PII_MAP, so the lookup goes through the
// encryption middleware's hash rewrite) and linked by contactId; unknown
// addresses are dropped.

import { createHash } from 'node:crypto';

import type { IngestActivitiesResponse, IngestActivity, IngestSkipReason } from '@bidstack/shared';
import type { Prisma } from '../../generated/client/index.js';

import { prisma } from '../index.js';

export type IngestActor = { kind: 'api_key'; keyId: string } | { kind: 'user'; userId: string };

export interface IngestActivitiesInput {
  orgId: string;
  actor: IngestActor;
  channel: 'rest' | 'mcp';
  /** API-key company allowlist; null = unrestricted. */
  companyScope: string[] | null;
  activities: IngestActivity[];
}

const KEY_PREFIX = 'ingest:';

/** Org-scoped dedupe key stored in Activity.idempotencyKey (VarChar 128). */
export function ingestDedupeKey(orgId: string, externalSource: string, externalId: string): string {
  const digest = createHash('sha256')
    .update(`${orgId}\u0000${externalSource.trim().toLowerCase()}\u0000${externalId.trim()}`)
    .digest('hex');
  return `${KEY_PREFIX}${digest}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Content fingerprint: a replay with the same payload is a no-op. */
export function ingestContentHash(item: IngestActivity): string {
  return createHash('sha256').update(stableStringify(item)).digest('hex');
}

export function normalizeIngestDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

type CompanyHit = { id: string } | null;
type OpportunityHit = { id: string; companyId: string | null } | null;

/** Per-batch lookup cache so 500 rows on one account cost one query. */
function memo<T>() {
  const map = new Map<string, Promise<T>>();
  const get = (key: string, load: () => Promise<T>): Promise<T> => {
    let hit = map.get(key);
    if (!hit) {
      hit = load();
      map.set(key, hit);
    }
    return hit;
  };
  return Object.assign(get, { forget: (key: string) => map.delete(key) });
}

async function learnLink(
  orgId: string,
  source: string,
  entityType: 'company' | 'opportunity',
  externalId: string,
  entityId: string,
): Promise<void> {
  // Create-only: a link another integration already learned is never re-pointed.
  await prisma.externalRecordLink.createMany({
    data: [{ orgId, source, entityType, externalId, entityId }],
    skipDuplicates: true,
  });
}

async function linkedEntityId(
  orgId: string,
  source: string,
  entityType: 'company' | 'opportunity',
  externalId: string,
): Promise<string | null> {
  const link = await prisma.externalRecordLink.findUnique({
    where: {
      orgId_source_entityType_externalId: { orgId, source, entityType, externalId },
    },
    select: { entityId: true },
  });
  return link?.entityId ?? null;
}

function planned(item: IngestActivity): boolean {
  if (item.status) return item.status === 'planned';
  return Boolean(item.dueAt);
}

function activityData(
  item: IngestActivity,
  ctx: {
    source: string;
    hash: string;
    channel: IngestActivitiesInput['channel'];
    actor: IngestActor;
    companyId: string | null;
    opportunityId: string | null;
  },
) {
  const occurredAt = new Date(item.occurredAt);
  const startTime = item.dueAt ? new Date(item.dueAt) : occurredAt;
  const endTime =
    item.durationMinutes !== undefined
      ? new Date(startTime.getTime() + item.durationMinutes * 60_000)
      : null;
  const body: Record<string, unknown> = {};
  if (item.stage) body.stage = item.stage;
  if (item.direction) body.direction = item.direction;
  if (item.durationMinutes !== undefined) body.durationMinutes = item.durationMinutes;

  const metadata: Record<string, unknown> = {
    externalSource: ctx.source,
    externalId: item.externalId,
    ingestHash: ctx.hash,
    ingestChannel: ctx.channel,
    companyId: ctx.companyId,
    opportunityId: ctx.opportunityId,
  };
  if (ctx.actor.kind === 'api_key') metadata.apiKeyId = ctx.actor.keyId;

  return {
    type: item.type,
    subject: item.subject ?? null,
    description: item.description ?? null,
    status: item.status ?? (planned(item) ? 'planned' : 'completed'),
    startTime,
    endTime,
    occurredAt,
    entityType: ctx.opportunityId ? 'opportunity' : 'company',
    entityId: (ctx.opportunityId ?? ctx.companyId)!,
    actorType: ctx.actor.kind === 'user' ? ('user' as const) : ('system' as const),
    actorId: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    ownerId: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
    body: body as Prisma.InputJsonObject,
    metadata: metadata as Prisma.InputJsonObject,
  };
}

/** Fields an ingest replay may change; owner and actor stay with the first writer. */
function updatableData(data: ReturnType<typeof activityData>) {
  const { actorType: _a, actorId: _b, ownerId: _c, ...rest } = data;
  return rest;
}

export async function ingestActivities(
  input: IngestActivitiesInput,
): Promise<IngestActivitiesResponse> {
  const { orgId } = input;
  const out: IngestActivitiesResponse = {
    counts: { accepted: 0, updated: 0, skipped: 0 },
    accepted: [],
    updated: [],
    skipped: [],
  };
  const skip = (index: number, item: IngestActivity, reason: IngestSkipReason) => {
    out.skipped.push({
      index,
      externalSource: item.externalSource,
      externalId: item.externalId,
      reason,
    });
  };

  const companyById = memo<CompanyHit>();
  const companyByDomain = memo<CompanyHit>();
  const oppById = memo<OpportunityHit>();
  const oppByCode = memo<OpportunityHit>();
  const linked = memo<string | null>();
  const contactByEmail = memo<string | null>();

  const findCompany = (id: string) =>
    companyById(id, () =>
      prisma.company.findFirst({ where: { id, orgId, deletedAt: null }, select: { id: true } }),
    );
  const findOpportunity = (id: string) =>
    oppById(id, () =>
      prisma.opportunity.findFirst({
        where: { id, orgId, deletedAt: null },
        select: { id: true, companyId: true },
      }),
    );

  const scope = input.companyScope;
  // A scoped key must not learn which records exist outside its allowlist.
  const notFound = (reason: IngestSkipReason): IngestSkipReason =>
    scope ? 'out_of_scope' : reason;
  const seen = new Set<string>();

  for (const [index, item] of input.activities.entries()) {
    const source = item.externalSource.trim().toLowerCase();
    const batchKey = `${source}\u0000${item.externalId.trim()}`;
    if (seen.has(batchKey)) {
      skip(index, item, 'duplicate_in_batch');
      continue;
    }
    seen.add(batchKey);

    const pendingLinks: Array<{
      entityType: 'company' | 'opportunity';
      externalId: string;
      entityId: string;
    }> = [];

    // ── Opportunity: id, then code, then a learned external id ──
    let opportunity: OpportunityHit = null;
    if (item.opportunity) {
      const ref = item.opportunity;
      let resolvedBy: 'direct' | 'link' | null = null;
      if (ref.id) {
        opportunity = await findOpportunity(ref.id);
        if (opportunity) resolvedBy = 'direct';
      }
      if (!opportunity && ref.code) {
        const code = ref.code;
        opportunity = await oppByCode(code, () =>
          prisma.opportunity.findFirst({
            where: { orgId, code, deletedAt: null },
            select: { id: true, companyId: true },
          }),
        );
        if (opportunity) resolvedBy = 'direct';
      }
      if (!opportunity && ref.externalId) {
        const externalId = ref.externalId;
        const id = await linked(`opportunity\u0000${source}\u0000${externalId}`, () =>
          linkedEntityId(orgId, source, 'opportunity', externalId),
        );
        if (id) opportunity = await findOpportunity(id);
        if (opportunity) resolvedBy = 'link';
      }
      if (!opportunity) {
        skip(index, item, notFound('opportunity_not_found'));
        continue;
      }
      if (resolvedBy === 'direct' && ref.externalId) {
        pendingLinks.push({
          entityType: 'opportunity',
          externalId: ref.externalId,
          entityId: opportunity.id,
        });
      }
    }

    // ── Company: id, then a learned external id, then domain ──
    let company: CompanyHit = null;
    if (item.company) {
      const ref = item.company;
      let resolvedBy: 'direct' | 'link' | null = null;
      if (ref.id) {
        company = await findCompany(ref.id);
        if (company) resolvedBy = 'direct';
      }
      if (!company && ref.externalId) {
        const externalId = ref.externalId;
        const id = await linked(`company\u0000${source}\u0000${externalId}`, () =>
          linkedEntityId(orgId, source, 'company', externalId),
        );
        if (id) company = await findCompany(id);
        if (company) resolvedBy = 'link';
      }
      if (!company && ref.domain) {
        const domain = normalizeIngestDomain(ref.domain);
        company = await companyByDomain(domain, () =>
          prisma.company.findFirst({
            where: {
              orgId,
              deletedAt: null,
              domain: { in: [domain, `www.${domain}`], mode: 'insensitive' },
            },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          }),
        );
        if (company) resolvedBy = 'direct';
      }
      if (company && resolvedBy === 'direct' && ref.externalId) {
        pendingLinks.push({
          entityType: 'company',
          externalId: ref.externalId,
          entityId: company.id,
        });
      }
    }
    if (item.company && !company && !opportunity) {
      skip(index, item, notFound('company_not_found'));
      continue;
    }
    // The opportunity decides where the row lands, so its account must agree
    // with the company ref; otherwise a ref to an allowed company could carry
    // an opportunity of another account past the scope check.
    if (company && opportunity?.companyId && opportunity.companyId !== company.id) {
      skip(index, item, 'company_mismatch');
      continue;
    }
    // The row lands on the opportunity, so a scoped key needs the opportunity's
    // own account in its allowlist; an allowed company ref cannot vouch for an
    // opportunity with no account.
    if (scope && opportunity && (!opportunity.companyId || !scope.includes(opportunity.companyId))) {
      skip(index, item, 'out_of_scope');
      continue;
    }
    if (!company && opportunity?.companyId) company = { id: opportunity.companyId };
    if (!company && !opportunity) {
      skip(index, item, notFound('company_not_found'));
      continue;
    }

    const companyId = company?.id ?? null;
    if (scope && (!companyId || !scope.includes(companyId))) {
      skip(index, item, 'out_of_scope');
      continue;
    }

    // ── Participants: link to known contacts, never keep the address ──
    const contactIds = new Set<string>();
    for (const participant of item.participants ?? []) {
      if (!participant.email) continue;
      const email = participant.email.trim().toLowerCase();
      const id = await contactByEmail(email, async () => {
        const contact = await prisma.contact.findFirst({
          where: {
            orgId,
            email,
            deletedAt: null,
            ...(scope ? { companyId: { in: scope } } : {}),
          },
          select: { id: true },
        });
        return contact?.id ?? null;
      });
      if (id) contactIds.add(id);
    }
    const attendees = [...contactIds].map((contactId) => ({ orgId, contactId }));

    const hash = ingestContentHash(item);
    const idempotencyKey = ingestDedupeKey(orgId, source, item.externalId);
    const data = activityData(item, {
      source,
      hash,
      channel: input.channel,
      actor: input.actor,
      companyId,
      opportunityId: opportunity?.id ?? null,
    });
    const ref = { index, externalSource: item.externalSource, externalId: item.externalId };
    for (const link of pendingLinks) {
      await learnLink(orgId, source, link.entityType, link.externalId, link.entityId);
      // A miss cached earlier in this batch would hide the link just learned.
      linked.forget(`${link.entityType}\u0000${source}\u0000${link.externalId}`);
    }

    const existing = await prisma.activity.findFirst({
      where: { orgId, idempotencyKey },
      select: { id: true, metadata: true },
    });
    if (existing) {
      const stored = (existing.metadata as Record<string, unknown> | null) ?? {};
      // A scoped key may only replay rows that already sit on an allowed account.
      const storedCompany = typeof stored.companyId === 'string' ? stored.companyId : null;
      if (scope && (!storedCompany || !scope.includes(storedCompany))) {
        skip(index, item, 'out_of_scope');
        continue;
      }
      const previous = stored.ingestHash;
      if (previous === hash) {
        skip(index, item, 'unchanged');
        continue;
      }
      await prisma.$transaction([
        prisma.activityAttendee.deleteMany({ where: { orgId, activityId: existing.id } }),
        prisma.activity.update({
          where: { id: existing.id },
          data: { ...updatableData(data), attendees: { create: attendees } },
        }),
      ]);
      out.updated.push({ ...ref, activityId: existing.id });
      continue;
    }

    try {
      const created = await prisma.activity.create({
        data: { ...data, orgId, idempotencyKey, attendees: { create: attendees } },
        select: { id: true },
      });
      out.accepted.push({ ...ref, activityId: created.id });
    } catch (err) {
      // A concurrent request (or a soft-deleted row) already holds the key.
      if ((err as { code?: string }).code === 'P2002') {
        skip(index, item, 'unchanged');
        continue;
      }
      throw err;
    }
  }

  out.counts = {
    accepted: out.accepted.length,
    updated: out.updated.length,
    skipped: out.skipped.length,
  };

  const reasons: Record<string, number> = {};
  for (const s of out.skipped) reasons[s.reason] = (reasons[s.reason] ?? 0) + 1;
  await prisma.auditLog.create({
    data: {
      orgId,
      userId: input.actor.kind === 'user' ? input.actor.userId : null,
      action: 'activities.ingest',
      targetType: 'activity_ingest',
      targetId: input.actor.kind === 'api_key' ? input.actor.keyId : null,
      diff: {
        channel: input.channel,
        actor: input.actor.kind,
        batchSize: input.activities.length,
        counts: out.counts,
        skippedReasons: reasons,
      },
    },
  });

  return out;
}
