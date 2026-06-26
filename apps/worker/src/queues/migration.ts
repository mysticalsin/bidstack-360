/**
 * Migration import queue worker — the consumer side of the migration
 * connector (producer: apps/api/src/routes/migrations.ts + migrations-hubspot.routes.ts).
 *
 * Queue: migration (defined in @bidstack/shared MIGRATION)
 * Payload: MigrationJobPayload — ONE chunk of rows, not a whole import.
 *
 * Sources:
 *   SALESFORCE_CSV / CSV — rows pre-parsed client-side, stored in Redis under
 *     payload.redisKey (1h TTL); this worker slices [chunkOffset, +chunkSize).
 *   HUBSPOT_OAUTH       — rows fetched live from the HubSpot CRM v3 API using
 *     an encrypted IntegrationConfig credential reference. Raw OAuth tokens are
 *     never stored in BullMQ payloads. Pagination: each chunk
 *     enqueues the next one while HubSpot returns paging.next.after.
 *     KNOWN GAP: no token refresh — imports started with <30min-old OAuth
 *     tokens (the normal flow) complete fine; an expired token fails the job
 *     with an explicit "reconnect HubSpot" error rather than hanging.
 *
 * Undo support: every chunk writes ONE AuditLog row
 *   { action: 'migration.chunk.imported', targetId: migrationJobId,
 *     diff: { created: { company: [...ids], ... } } }
 * so DELETE /migrations/:id/undo can remove contacts/opportunities too
 * (they have no `source` column to tag, unlike Company/Lead).
 */

import { Worker, Queue, type Job } from 'bullmq';
import type IORedis from 'ioredis';
import type pino from 'pino';

import { prisma, Prisma } from '@bidstack/db';
import { MIGRATION, MigrationJobPayload, type MigrationJobError } from '@bidstack/shared';
import { decryptSecret } from '@bidstack/shared/server-crypto';

import { serumConnectorDenialMessage } from '../lib/serum-connector-policy.js';

// ─── Entity normalization ──────────────────────────────────────────────────

type TargetEntity = 'company' | 'contact' | 'lead' | 'opportunity';

const ENTITY_ALIASES: Record<string, TargetEntity> = {
  account: 'company',
  accounts: 'company',
  company: 'company',
  companies: 'company',
  contact: 'contact',
  contacts: 'contact',
  lead: 'lead',
  leads: 'lead',
  opportunity: 'opportunity',
  opportunities: 'opportunity',
  deal: 'opportunity',
  deals: 'opportunity',
};

export function normalizeEntity(entityType: string): TargetEntity | null {
  return ENTITY_ALIASES[entityType.toLowerCase()] ?? null;
}

// ─── Value coercion ────────────────────────────────────────────────────────

function asTrimmed(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export function asInt(v: unknown): number | null {
  const s = asTrimmed(v);
  if (!s || !/\d/.test(s)) return null; // require a digit — "n/a" is not 0
  const n = Number(s.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Currency units (e.g. "1,200,000.50") → micros BigInt. */
export function asMicros(v: unknown): bigint | null {
  const s = asTrimmed(v);
  // Require a digit so a non-numeric cell ("n/a", "TBD") is SKIPPED, not
  // silently coerced to €0 (Number('') === 0 would otherwise do that).
  if (!s || !/\d/.test(s)) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(n * 1_000_000));
}

function asDate(v: unknown): Date | null {
  const s = asTrimmed(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const LEAD_STATUSES = new Set([
  'new',
  'contacted',
  'qualified',
  'nurture',
  'disqualified',
  'converted',
]);

const OPP_STAGES = new Set([
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
]);

/** Loose source-CRM stage label → canonical OpportunityStage. */
export function mapStage(v: unknown): string {
  const s = asTrimmed(v)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return 's1_lead';
  if (OPP_STAGES.has(s)) return s;
  if (s.includes('won')) return 'closed_won';
  if (s.includes('lost') || s.includes('closed')) return 'closed_lost';
  if (s.includes('negoti') || s.includes('contract')) return 's4_negotiation';
  if (s.includes('proposal') || s.includes('sent') || s.includes('quote')) return 's2_sent';
  if (s.includes('demo') || s.includes('technical') || s.includes('evaluation'))
    return 's3_technical_iteration';
  return 's1_lead';
}

/** Map a source row through the column mappings into { targetField: rawValue }. */
export function applyMappings(
  row: Record<string, unknown>,
  mappings: Record<string, string | null>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [sourceColumn, targetField] of Object.entries(mappings)) {
    if (!targetField) continue;
    const value = row[sourceColumn];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    out[targetField] = value;
  }
  return out;
}

// ─── Entity writers ────────────────────────────────────────────────────────
// Dedup keys (no externalId columns exist on these models):
//   company → (orgId, name)  ·  contact → (orgId, email) falling back to name
//   lead → (orgId, email) falling back to (firstName,lastName,companyName)
//   opportunity → (orgId, customer, name)

interface WriteCtx {
  orgId: string;
  sourceTag: string;
  dedupStrategy: 'skip' | 'update' | 'duplicate';
}

async function writeCompany(ctx: WriteCtx, t: Record<string, unknown>): Promise<string | null> {
  const name = asTrimmed(t['company.name']);
  if (!name) throw new Error('company.name is required');
  const data = {
    name,
    domain: asTrimmed(t['company.domain']),
    website: asTrimmed(t['company.website']),
    industry: asTrimmed(t['company.industry']),
    employeeCount: asInt(t['company.employeeCount']),
    countryCode: asTrimmed(t['company.countryCode'])?.slice(0, 2).toUpperCase() ?? null,
  };
  if (ctx.dedupStrategy !== 'duplicate') {
    const existing = await prisma.company.findFirst({
      where: { orgId: ctx.orgId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await prisma.company.update({ where: { id: existing.id }, data });
      return null; // updated, not created — undo must not delete pre-existing rows
    }
  }
  const created = await prisma.company.create({
    data: { ...data, orgId: ctx.orgId, source: ctx.sourceTag, confidence: 1 },
    select: { id: true },
  });
  return created.id;
}

async function writeContact(ctx: WriteCtx, t: Record<string, unknown>): Promise<string | null> {
  const first = asTrimmed(t['contact.firstName']);
  const last = asTrimmed(t['contact.lastName']);
  const name = [first, last].filter(Boolean).join(' ') || asTrimmed(t['contact.name']);
  if (!name) throw new Error('contact first/last name is required');
  const customer = asTrimmed(t['contact.companyName']) ?? '';
  const email = asTrimmed(t['contact.email']);
  const company = customer
    ? await prisma.company.findFirst({
        where: {
          orgId: ctx.orgId,
          name: { equals: customer, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      })
    : null;
  const data = {
    name,
    customer,
    companyId: company?.id ?? null,
    email,
    phone: asTrimmed(t['contact.phone']) ?? asTrimmed(t['contact.mobile']),
    role: asTrimmed(t['contact.title']),
  };
  if (ctx.dedupStrategy !== 'duplicate' && email) {
    const existing = await prisma.contact.findFirst({
      where: { orgId: ctx.orgId, email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await prisma.contact.update({ where: { id: existing.id }, data });
      return null;
    }
  }
  const created = await prisma.contact.create({
    data: { ...data, orgId: ctx.orgId },
    select: { id: true },
  });
  return created.id;
}

async function writeLead(ctx: WriteCtx, t: Record<string, unknown>): Promise<string | null> {
  const firstName = asTrimmed(t['lead.firstName']) ?? '';
  const lastName = asTrimmed(t['lead.lastName']) ?? '';
  if (!firstName && !lastName) throw new Error('lead first or last name is required');
  const companyName = asTrimmed(t['lead.company']) ?? asTrimmed(t['lead.companyName']) ?? '';
  if (!companyName) throw new Error('lead company is required');
  const email = asTrimmed(t['lead.email']);
  const statusRaw = asTrimmed(t['lead.status'])?.toLowerCase();
  const data = {
    firstName,
    lastName,
    email,
    phone: asTrimmed(t['lead.phone']),
    companyName,
    title: asTrimmed(t['lead.title']),
    notes: asTrimmed(t['lead.notes']),
    status: (statusRaw && LEAD_STATUSES.has(statusRaw) ? statusRaw : 'new') as never,
  };
  if (ctx.dedupStrategy !== 'duplicate' && email) {
    const existing = await prisma.lead.findFirst({
      where: { orgId: ctx.orgId, email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await prisma.lead.update({ where: { id: existing.id }, data });
      return null;
    }
  }
  // `source` doubles as the undo tag — same mechanism the undo route already
  // queries for (source: 'migration:<jobId>').
  const created = await prisma.lead.create({
    data: { ...data, orgId: ctx.orgId, source: ctx.sourceTag },
    select: { id: true },
  });
  return created.id;
}

/** Inline copy of apps/api/src/routes/opportunities.helpers.ts mintNextCode —
 * the worker cannot import from apps/api. Keep the two in sync. */
async function mintNextCode(tx: Prisma.TransactionClient, orgId: string): Promise<string> {
  const last = await tx.opportunity.findFirst({
    where: { orgId, code: { startsWith: 'OP-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  if (!last) return 'OP-2001';
  const n = Number(last.code.slice(3));
  return `OP-${(n + 1).toString().padStart(4, '0')}`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function writeOpportunity(
  ctx: WriteCtx,
  t: Record<string, unknown>,
): Promise<string | null> {
  const name = asTrimmed(t['opportunity.name']);
  if (!name) throw new Error('opportunity.name is required');
  const customer =
    asTrimmed(t['opportunity.companyName']) ?? asTrimmed(t['opportunity.customer']) ?? 'Unknown';
  if (ctx.dedupStrategy !== 'duplicate') {
    const existing = await prisma.opportunity.findFirst({
      where: {
        orgId: ctx.orgId,
        name: { equals: name, mode: 'insensitive' },
        customer: { equals: customer, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await prisma.opportunity.update({
        where: { id: existing.id },
        data: {
          valueMicros: asMicros(t['opportunity.valueMicros']) ?? undefined,
          probability: asInt(t['opportunity.probability']) ?? undefined,
          dueDate: asDate(t['opportunity.closeDate']) ?? undefined,
        },
      });
      return null;
    }
  }
  // Bounded retry on (orgId, code) unique collisions — same pattern as the
  // API's create route.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const code = await mintNextCode(tx, ctx.orgId);
        return tx.opportunity.create({
          data: {
            orgId: ctx.orgId,
            code,
            name,
            customer,
            stage: mapStage(t['opportunity.stage']) as never,
            valueMicros: asMicros(t['opportunity.valueMicros']) ?? 0n,
            probability: asInt(t['opportunity.probability']) ?? 0,
            dueDate: asDate(t['opportunity.closeDate']),
          },
          select: { id: true },
        });
      });
      return created.id;
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 4) throw err;
    }
  }
  return null;
}

const WRITERS: Record<
  TargetEntity,
  (ctx: WriteCtx, t: Record<string, unknown>) => Promise<string | null>
> = {
  company: writeCompany,
  contact: writeContact,
  lead: writeLead,
  opportunity: writeOpportunity,
};

// ─── HubSpot page fetch ────────────────────────────────────────────────────

interface HubSpotPage {
  rows: Record<string, unknown>[];
  nextAfter: string | null;
}

const HUBSPOT_INTEGRATION_TYPE = 'hubspot' as const;
const HUBSPOT_MIGRATION_CONFIG_NAME = 'hubspot-migration';

interface StoredHubSpotTokens {
  accessToken?: unknown;
  refreshToken?: unknown;
  expiresAt?: unknown;
}

export async function resolveHubSpotAccessToken(
  payload: MigrationJobPayload,
): Promise<string> {
  const meta = payload.meta as Record<string, unknown> | undefined;
  const configId =
    typeof meta?.hubspotIntegrationConfigId === 'string'
      ? meta.hubspotIntegrationConfigId
      : undefined;

  const config = await prisma.integrationConfig.findFirst({
    where: {
      ...(configId ? { id: configId } : {}),
      orgId: payload.orgId,
      type: HUBSPOT_INTEGRATION_TYPE,
      name: HUBSPOT_MIGRATION_CONFIG_NAME,
      isActive: true,
      deletedAt: null,
    },
    select: { credentials: true },
  });

  if (!config) {
    throw new Error('HubSpot not connected — complete OAuth flow first');
  }

  const encrypted = (config.credentials as Record<string, unknown>).encrypted;
  if (typeof encrypted !== 'string' || !encrypted) {
    throw new Error('HubSpot credential reference is missing encrypted tokens');
  }

  let tokens: StoredHubSpotTokens;
  try {
    tokens = JSON.parse(decryptSecret(encrypted)) as StoredHubSpotTokens;
  } catch {
    throw new Error('Failed to decrypt HubSpot tokens');
  }

  if (typeof tokens.accessToken !== 'string' || !tokens.accessToken) {
    throw new Error('HubSpot credential reference is missing an access token');
  }

  return tokens.accessToken;
}

export async function fetchHubSpotPage(
  orgId: string,
  entityType: string,
  accessToken: string,
  properties: string[],
  limit: number,
  after?: string,
): Promise<HubSpotPage> {
  const denial = await serumConnectorDenialMessage({
    orgId,
    connectorId: 'hubspot',
    operation: `hubspot.import.${entityType}`,
    writeRequested: false,
  });
  if (denial) throw new Error(denial);

  const params = new URLSearchParams({ limit: String(limit) });
  if (after) params.set('after', after);
  if (properties.length > 0) params.set('properties', properties.join(','));
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/${entityType}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (res.status === 401 || res.status === 403) {
    throw new Error('HubSpot authorization expired — reconnect HubSpot and restart the import');
  }
  if (!res.ok) {
    throw new Error(`HubSpot API error ${res.status}`);
  }
  const body = (await res.json()) as {
    results?: Array<{ id: string; properties?: Record<string, unknown> }>;
    paging?: { next?: { after?: string } };
  };
  return {
    rows: (body.results ?? []).map((r) => ({ ...(r.properties ?? {}), hs_object_id: r.id })),
    nextAfter: body.paging?.next?.after ?? null,
  };
}

// ─── Job bookkeeping ───────────────────────────────────────────────────────

/** Atomic counter bump + capped JSONB error append (concurrent chunks are safe). */
async function recordChunkOutcome(
  migrationJobId: string,
  processed: number,
  errored: number,
  errors: MigrationJobError[],
): Promise<void> {
  await prisma.migrationJob.update({
    where: { id: migrationJobId },
    data: { processedRows: { increment: processed }, errorRows: { increment: errored } },
  });
  if (errors.length > 0) {
    // Cap stored errors at 200 — the CSV download stays useful, the row stays small.
    await prisma.$executeRaw`
      UPDATE migration_jobs
      SET error_summary = CASE
        WHEN jsonb_array_length(error_summary) < 200
        THEN error_summary || ${JSON.stringify(errors)}::jsonb
        ELSE error_summary
      END
      WHERE id = ${migrationJobId}::uuid`;
  }
}

/**
 * Returns how many rows of this chunk a prior (retried) run already committed, so
 * the import loop resumes PAST them instead of restarting. WHY audit-log based:
 * the chunk audit row is the only durable per-chunk record, and it is written in
 * the same worker pass — its `rowsConsumed` is an exact cursor (processed +
 * errored). Returns 0 when this chunk has never run (the common, first-attempt
 * path). Org-scoped; never reads another tenant's chunk progress.
 */
async function resolveChunkResumeCursor(
  orgId: string,
  migrationJobId: string,
  chunkOffset: number,
): Promise<number> {
  const prior = await prisma.auditLog.findFirst({
    where: {
      orgId,
      action: 'migration.chunk.imported',
      targetType: 'MigrationJob',
      targetId: migrationJobId,
      // JSONB path filter — only the audit row for THIS chunk.
      diff: { path: ['chunkOffset'], equals: chunkOffset },
    },
    orderBy: { at: 'desc' },
    select: { diff: true },
  });
  if (!prior) return 0;
  const diff = prior.diff as { rowsConsumed?: unknown } | null;
  const consumed = typeof diff?.rowsConsumed === 'number' ? diff.rowsConsumed : 0;
  return consumed >= 0 ? consumed : 0;
}

async function maybeComplete(migrationJobId: string, forceTotal?: number): Promise<void> {
  const job = await prisma.migrationJob.findUnique({ where: { id: migrationJobId } });
  if (!job || job.status !== 'RUNNING') return;
  const done = job.processedRows + job.errorRows;
  const total = forceTotal ?? job.totalRows;
  if (done >= total) {
    await prisma.migrationJob.update({
      where: { id: migrationJobId },
      data: {
        status: 'COMPLETE',
        completedAt: new Date(),
        totalRows: forceTotal ?? job.totalRows,
        undoableUntil: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });
  }
}

// ─── Worker ────────────────────────────────────────────────────────────────

let queueSingleton: Queue | null = null;

function getMigrationQueue(connection: IORedis): Queue {
  if (!queueSingleton) {
    queueSingleton = new Queue(MIGRATION.name, {
      connection,
      defaultJobOptions: MIGRATION.defaultJobOptions,
    });
  }
  return queueSingleton;
}

export async function startMigrationWorker(
  connection: IORedis,
  log: pino.Logger,
  workers: Worker[],
  queues: Queue[],
): Promise<void> {
  const queue = getMigrationQueue(connection);
  queues.push(queue);

  const worker = new Worker(
    MIGRATION.name,
    async (job: Job) => {
      const payload = MigrationJobPayload.parse(job.data);
      const childLog = log.child({
        migrationJobId: payload.migrationJobId,
        entityType: payload.entityType,
        chunkOffset: payload.chunkOffset,
      });

      // Respect cancellation between chunks.
      const jobRow = await prisma.migrationJob.findUnique({
        where: { id: payload.migrationJobId },
        select: { status: true },
      });
      if (!jobRow || jobRow.status === 'CANCELLED' || jobRow.status === 'FAILED') {
        childLog.info({ status: jobRow?.status }, 'migration chunk skipped — job not running');
        return;
      }

      const entity = normalizeEntity(payload.entityType);
      if (!entity) {
        // e.g. HubSpot "tasks" — fail the job loudly instead of hanging RUNNING.
        await prisma.migrationJob.update({
          where: { id: payload.migrationJobId },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorSummary: [
              {
                row: 0,
                field: null,
                message: `Entity type "${payload.entityType}" is not supported by the import worker yet`,
              },
            ],
          },
        });
        childLog.warn('unsupported entity type — job failed honestly');
        return;
      }

      // ── Acquire this chunk's rows ──
      let rows: Record<string, unknown>[];
      let nextAfter: string | null = null;
      if (payload.source === 'HUBSPOT_OAUTH') {
        const accessToken = await resolveHubSpotAccessToken(payload);
        const page = await fetchHubSpotPage(
          payload.orgId,
          payload.entityType,
          accessToken,
          Object.keys(payload.mappings),
          payload.chunkSize,
          payload.hubspotAfter,
        );
        rows = page.rows;
        nextAfter = page.nextAfter;
      } else {
        if (!payload.redisKey) throw new Error('CSV chunk missing redisKey');
        const raw = await connection.get(payload.redisKey);
        if (!raw) {
          throw new Error(
            'CSV rows expired from Redis (1h TTL) — restart the import to re-upload',
          );
        }
        const all = JSON.parse(raw) as Record<string, unknown>[];
        rows = all.slice(payload.chunkOffset, payload.chunkOffset + payload.chunkSize);
      }

      // ── Import rows ──
      const ctx: WriteCtx = {
        orgId: payload.orgId,
        sourceTag: `migration:${payload.migrationJobId}`,
        dedupStrategy: payload.dedupStrategy,
      };

      // Retry idempotency: a BullMQ retry re-runs the WHOLE chunk from the start.
      // For the 'skip'/'update' strategies the per-row dedup check makes that safe,
      // but 'duplicate' re-inserts every row unconditionally — so a retry after a
      // partial commit would double-insert. We persist a resume cursor (rows
      // consumed = processed + errored) in the prior chunk audit row and skip PAST
      // already-committed rows so a retry resumes instead of restarting.
      const resumeFrom = await resolveChunkResumeCursor(
        payload.orgId,
        payload.migrationJobId,
        payload.chunkOffset,
      );

      const createdIds: string[] = [];
      const errors: MigrationJobError[] = [];
      let processed = 0;

      for (let i = resumeFrom; i < rows.length; i++) {
        const absoluteRow = payload.chunkOffset + i;
        try {
          const mapped = applyMappings(rows[i]!, payload.mappings);
          const createdId = await WRITERS[entity](ctx, mapped);
          if (createdId) createdIds.push(createdId);
          processed += 1;
        } catch (err) {
          errors.push({
            row: absoluteRow,
            field: null,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ── Undo trail: contacts/opportunities have no `source` column, so the
      // undo route reads these audit rows to find what this job created. The
      // `rowsConsumed` field doubles as the resume cursor for retry idempotency. ──
      if (createdIds.length > 0 || processed > 0 || errors.length > 0) {
        const rowsConsumed = resumeFrom + processed + errors.length;
        await prisma.auditLog.create({
          data: {
            orgId: payload.orgId,
            userId: payload.userId,
            action: 'migration.chunk.imported',
            targetType: 'MigrationJob',
            targetId: payload.migrationJobId,
            diff: { entity, createdIds, chunkOffset: payload.chunkOffset, rowsConsumed },
          },
        });
      }

      await recordChunkOutcome(payload.migrationJobId, processed, errors.length, errors);

      // ── HubSpot pagination: enqueue the next page while there is one. ──
      if (payload.source === 'HUBSPOT_OAUTH' && nextAfter) {
        const nextOffset = payload.chunkOffset + rows.length;
        await queue.add(
          `${payload.migrationJobId}-chunk-${nextOffset}`,
          { ...payload, chunkOffset: nextOffset, hubspotAfter: nextAfter },
          { jobId: `${payload.migrationJobId}-${payload.entityType}-chunk-${nextOffset}` },
        );
      } else if (payload.source === 'HUBSPOT_OAUTH') {
        // Last page — HubSpot discovery counts are approximate, so completion
        // is "no more pages", not "processed == discovered total".
        const jobNow = await prisma.migrationJob.findUnique({
          where: { id: payload.migrationJobId },
          select: { processedRows: true, errorRows: true },
        });
        await maybeComplete(
          payload.migrationJobId,
          (jobNow?.processedRows ?? 0) + (jobNow?.errorRows ?? 0),
        );
      } else {
        await maybeComplete(payload.migrationJobId);
      }

      childLog.info(
        { processed, errored: errors.length, created: createdIds.length },
        'migration chunk done',
      );
    },
    {
      connection,
      concurrency: 4,
    },
  );

  worker.on('failed', async (job, err) => {
    log.error({ jobId: job?.id, err }, 'migration chunk failed');
    // After BullMQ exhausts retries (attempts: 5), fail the parent job row so
    // the UI never shows RUNNING forever on a dead chunk.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const migrationJobId = (job.data as { migrationJobId?: string }).migrationJobId;
      if (migrationJobId) {
        await prisma.migrationJob
          .updateMany({
            where: { id: migrationJobId, status: 'RUNNING' },
            data: { status: 'FAILED', completedAt: new Date() },
          })
          .catch((updateErr) =>
            log.error({ updateErr, migrationJobId }, 'failed to mark migration job FAILED'),
          );
        await prisma.$executeRaw`
          UPDATE migration_jobs
          SET error_summary = CASE
            WHEN jsonb_array_length(error_summary) < 200
            THEN error_summary || ${JSON.stringify([
              { row: 0, field: null, message: `chunk failed permanently: ${err.message}` },
            ])}::jsonb
            ELSE error_summary
          END
          WHERE id = ${migrationJobId}::uuid`.catch(() => undefined);
      }
    }
  });

  workers.push(worker);
  log.info('migration import worker started');
}
