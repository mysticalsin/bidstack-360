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
import {
  ACCOUNT_INTEL,
  MIGRATION,
  MigrationJobPayload,
  type MigrationJobError,
  MIGRATION_STALE_MS,
  MIGRATION_STALE_REASON,
  migrationAttemptId,
  migrationChunkMatchesAttempt,
  migrationChunkMayRun,
  migrationFrom,
  migrationProgressAt,
  migrationStaleDue,
} from '@bidstack/shared';
import { decryptSecret } from '@bidstack/shared/server-crypto';

import {
  queueImportEnrichment,
  type IntelEnqueueJob,
} from '../lib/company-intel/import-enrichment.js';
import { serumConnectorDenialMessage } from '../lib/serum-connector-policy.js';
import { queueTechDetectAfterImport } from './company-tech-detect.js';

// ─── Entity normalization ──────────────────────────────────────────────────

type TargetEntity = 'company' | 'contact' | 'lead' | 'opportunity' | 'financial';

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
  financial: 'financial',
  financials: 'financial',
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
  const s = asTrimmed(v)
    ?.toLowerCase()
    .replace(/[\s-]+/g, '_');
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
  tx: Prisma.TransactionClient;
}

/** Shown to users and written on the error CSV. No process ids, transaction ids, or SQL. */
export const MIGRATION_DEADLOCK_PUBLIC =
  'The import conflicted with another write and will be tried again.';

/** Postgres 40P01, including when Prisma nests it on `meta.code`. */
export function isMigrationDeadlock(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const row = err as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
  if (row.code === '40P01' || row.meta?.code === '40P01') return true;
  return row.cause !== undefined && row.cause !== err && isMigrationDeadlock(row.cause);
}

/** A deadlock aborts the transaction. The chunk fails so BullMQ retries the whole chunk. */
export class MigrationChunkConflict extends Error {
  readonly code = '40P01';
  constructor() {
    super(MIGRATION_DEADLOCK_PUBLIC);
    this.name = 'MigrationChunkConflict';
  }
}

/** A failed statement aborts the chunk transaction. A savepoint lets one row fail. */
async function withSavepoint<T>(tx: Prisma.TransactionClient, name: string, fn: () => Promise<T>): Promise<T> {
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    // 40P01 already aborted the transaction. Rolling back to the savepoint
    // would raise 25P02 and hide the deadlock in a later row error.
    if (isMigrationDeadlock(err)) throw err;
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    throw err;
  }
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
    const existing = await ctx.tx.company.findFirst({
      where: { orgId: ctx.orgId, name: { equals: name, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await ctx.tx.company.update({ where: { id: existing.id }, data });
      return null; // updated, not created — undo must not delete pre-existing rows
    }
  }
  const created = await ctx.tx.company.create({
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
    ? await ctx.tx.company.findFirst({
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
    const existing = await ctx.tx.contact.findFirst({
      where: { orgId: ctx.orgId, email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await ctx.tx.contact.update({ where: { id: existing.id }, data });
      return null;
    }
  }
  const created = await ctx.tx.contact.create({
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
    const existing = await ctx.tx.lead.findFirst({
      where: { orgId: ctx.orgId, email, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      if (ctx.dedupStrategy === 'skip') return null;
      await ctx.tx.lead.update({ where: { id: existing.id }, data });
      return null;
    }
  }
  // `source` doubles as the undo tag — same mechanism the undo route already
  // queries for (source: 'migration:<jobId>').
  const created = await ctx.tx.lead.create({
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

async function writeOpportunity(ctx: WriteCtx, t: Record<string, unknown>): Promise<string | null> {
  const name = asTrimmed(t['opportunity.name']);
  if (!name) throw new Error('opportunity.name is required');
  const customer =
    asTrimmed(t['opportunity.companyName']) ?? asTrimmed(t['opportunity.customer']) ?? 'Unknown';
  if (ctx.dedupStrategy !== 'duplicate') {
    const existing = await ctx.tx.opportunity.findFirst({
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
      await ctx.tx.opportunity.update({
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
  // API's create route. The savepoint keeps one collision from aborting the
  // chunk transaction these writes share with the attempt check.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const created = await withSavepoint(ctx.tx, `opp_code_${attempt}`, async () => {
        const code = await mintNextCode(ctx.tx, ctx.orgId);
        return ctx.tx.opportunity.create({
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

async function writeFinancial(ctx: WriteCtx, t: Record<string, unknown>): Promise<string | null> {
  const companyName = asTrimmed(t['financial.companyName']);
  if (!companyName) throw new Error('financial.companyName is required');
  const periodEndRaw = asTrimmed(t['financial.periodEnd']);
  const periodEnd = asDate(periodEndRaw);
  if (!periodEnd) throw new Error('financial.periodEnd must be an ISO date');
  const currency = (asTrimmed(t['financial.currency']) ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('financial.currency must be a 3-letter code');
  const periodType = (asTrimmed(t['financial.periodType']) ?? 'FY').toUpperCase();
  if (periodType !== 'FY' && periodType !== 'Q')
    throw new Error('financial.periodType must be FY or Q');
  const fiscalYear = asInt(t['financial.fiscalYear']) ?? periodEnd.getUTCFullYear();
  const company = await ctx.tx.company.findFirst({
    where: {
      orgId: ctx.orgId,
      name: { equals: companyName, mode: 'insensitive' },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!company) throw new Error(`No account named "${companyName}" — import accounts first`);

  const metric = (key: string, concept: string) => {
    const units = asMicros(t[key]);
    if (units === null) return undefined;
    return { value: Number(units) / 1_000_000, concept };
  };
  const metrics: Record<string, { value: number; concept: string }> = {};
  const revenue = metric('financial.revenue', 'manual.revenue');
  const operatingIncome = metric('financial.operatingIncome', 'manual.operatingIncome');
  const netIncome = metric('financial.netIncome', 'manual.netIncome');
  if (revenue) metrics.revenue = revenue;
  if (operatingIncome) metrics.operatingIncome = operatingIncome;
  if (netIncome) metrics.netIncome = netIncome;
  if (!metrics.revenue) throw new Error('financial.revenue is required');

  const existing = await ctx.tx.accountFinancialPeriod.findFirst({
    where: {
      orgId: ctx.orgId,
      companyId: company.id,
      source: 'manual_import',
      periodType,
      periodEnd,
    },
    select: { id: true },
  });
  if (existing) {
    if (ctx.dedupStrategy === 'skip') return null;
    await ctx.tx.accountFinancialPeriod.update({
      where: { id: existing.id },
      data: {
        currency,
        fiscalYear,
        periodStart: asDate(t['financial.periodStart']),
        metrics,
        sourceUrl: 'manual-import',
      },
    });
    return ctx.dedupStrategy === 'duplicate' ? existing.id : null;
  }

  const created = await ctx.tx.accountFinancialPeriod.create({
    data: {
      orgId: ctx.orgId,
      companyId: company.id,
      source: 'manual_import',
      entityId: company.id,
      periodType,
      fiscalYear,
      periodStart: asDate(t['financial.periodStart']),
      periodEnd,
      currency,
      sourceUrl: 'manual-import',
      metrics,
    },
    select: { id: true },
  });
  return created.id;
}

const WRITERS: Record<
  TargetEntity,
  (ctx: WriteCtx, t: Record<string, unknown>) => Promise<string | null>
> = {
  company: writeCompany,
  contact: writeContact,
  lead: writeLead,
  opportunity: writeOpportunity,
  financial: writeFinancial,
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

export async function resolveHubSpotAccessToken(payload: MigrationJobPayload): Promise<string> {
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

/** Atomic counter bump + capped JSONB error append (concurrent chunks are safe).
 * Runs on the caller's transaction client so the counters commit together with
 * the resume-cursor audit row — see commitChunkProgress for WHY. */
async function recordChunkOutcome(
  tx: Prisma.TransactionClient,
  migrationJobId: string,
  attemptId: string | null,
  processed: number,
  errored: number,
  errors: MigrationJobError[],
): Promise<number> {
  // The opening check can be stale. Count the rows only while this attempt
  // is still the one on the job, and the job is still RUNNING.
  const moved = await tx.$executeRaw`
    UPDATE migration_jobs
    SET processed_rows = processed_rows + ${processed},
        error_rows = error_rows + ${errored},
        updated_at = date_trunc('milliseconds', NOW())
    WHERE id = ${migrationJobId}::uuid
      AND status = 'RUNNING'
      AND (
        (${attemptId}::text IS NULL AND (meta->>'attemptId') IS NULL)
        OR meta->>'attemptId' = ${attemptId}
      )
  `;
  if (Number(moved) !== 1) return 0;
  if (errors.length > 0) {
    // Cap stored errors at 200 — the CSV download stays useful, the row stays small.
    await tx.$executeRaw`
      UPDATE migration_jobs
      SET error_summary = CASE
        WHEN jsonb_array_length(error_summary) < 200
        THEN error_summary || ${JSON.stringify(errors)}::jsonb
        ELSE error_summary
      END
      WHERE id = ${migrationJobId}::uuid`;
  }
  return 1;
}

/**
 * Persist a finished chunk's bookkeeping: the undo-trail/resume-cursor audit
 * row plus the processedRows/errorRows counter bump. ONE transaction, on
 * purpose: the audit row's `rowsConsumed` is the retry resume cursor, so if it
 * ever became durable without the matching counter increment (crash between
 * the two writes), the BullMQ retry would resume PAST every row while adding
 * zero to the counters — permanently undercounting processedRows, which
 * maybeComplete compares to totalRows, stranding the job in RUNNING forever.
 */
type ChunkBookkeeping = {
  orgId: string;
  userId: string;
  migrationJobId: string;
  entity: TargetEntity;
  chunkOffset: number;
  resumeFrom: number;
  createdIds: string[];
  processed: number;
  errors: MigrationJobError[];
  attemptId: string | null;
};

/** Counters and the undo-trail row. Returns 0 when this attempt no longer owns the job. */
async function persistChunkBookkeeping(tx: Prisma.TransactionClient, chunk: ChunkBookkeeping): Promise<number> {
  const { migrationJobId, processed, errors } = chunk;
  const moved = await recordChunkOutcome(
    tx,
    migrationJobId,
    chunk.attemptId,
    processed,
    errors.length,
    errors,
  );
  if (moved !== 1) return 0;
  if (chunk.createdIds.length > 0 || processed > 0 || errors.length > 0) {
    const rowsConsumed = chunk.resumeFrom + processed + errors.length;
    await tx.auditLog.create({
      data: {
        orgId: chunk.orgId,
        userId: chunk.userId,
        action: 'migration.chunk.imported',
        targetType: 'MigrationJob',
        targetId: migrationJobId,
        diff: {
          entity: chunk.entity,
          createdIds: chunk.createdIds,
          chunkOffset: chunk.chunkOffset,
          rowsConsumed,
        },
      },
    });
  }
  return 1;
}

export async function commitChunkProgress(chunk: ChunkBookkeeping): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await persistChunkBookkeeping(tx, chunk);
  });
}

/**
 * Returns how many rows of this chunk a prior (retried) run already committed, so
 * the import loop resumes PAST them instead of restarting. WHY audit-log based:
 * the chunk audit row is the only durable per-chunk record, and it is written in
 * the same worker pass — its `rowsConsumed` is an exact cursor (processed +
 * errored). Returns 0 when this chunk has never run (the common, first-attempt
 * path). Org-scoped; never reads another tenant's chunk progress.
 */
export async function resolveChunkResumeCursor(
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

export async function maybeComplete(
  migrationJobId: string,
  forceTotal?: number,
  log?: ChunkLog,
  attemptId: string | null = null,
): Promise<void> {
  const job = await prisma.migrationJob.findUnique({ where: { id: migrationJobId } });
  if (!job || !migrationChunkMayRun(job.status)) return;
  if (!migrationChunkMatchesAttempt(migrationAttemptId(job.meta), attemptId)) return;
  const done = job.processedRows + job.errorRows;
  const total = forceTotal ?? job.totalRows;
  if (done < total) return;
  // A cancel or a newer attempt can land after the read above. Only the
  // attempt that is still current, and still RUNNING, becomes COMPLETE.
  const completedAt = new Date();
  const undoableUntil = new Date(Date.now() + 24 * 3600 * 1000);
  const moved = await prisma.$executeRaw`
    UPDATE migration_jobs
    SET status = 'COMPLETE',
        completed_at = ${completedAt},
        total_rows = ${total},
        undoable_until = ${undoableUntil},
        updated_at = date_trunc('milliseconds', NOW())
    WHERE id = ${migrationJobId}::uuid
      AND status = 'RUNNING'
      AND (
        (${attemptId}::text IS NULL AND (meta->>'attemptId') IS NULL)
        OR meta->>'attemptId' = ${attemptId}
      )
  `;
  if (Number(moved) !== 1) {
    const current = await prisma.migrationJob.findUnique({
      where: { id: migrationJobId },
      select: { status: true },
    });
    log?.warn(
      { migrationJobId, from: current?.status ?? null, to: 'COMPLETE' },
      'illegal migration transition',
    );
  }
}

// ─── Chunk processing ──────────────────────────────────────────────────────

/** What one chunk needs from Redis and the queues; the worker wires the real ones. */
export interface MigrationChunkDeps {
  readRows(redisKey: string): Promise<string | null>;
  enqueueChunk(name: string, data: MigrationJobPayload, opts: { jobId: string }): Promise<unknown>;
  enqueueIntel(jobs: IntelEnqueueJob[]): Promise<void>;
  env: Record<string, string | undefined>;
}

type ChunkLog = Pick<pino.Logger, 'info' | 'warn'>;

/** Company ids every earlier pass of this chunk created (from the undo-trail rows). */
async function chunkCreatedIds(payload: MigrationJobPayload): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: {
      orgId: payload.orgId,
      action: 'migration.chunk.imported',
      targetType: 'MigrationJob',
      targetId: payload.migrationJobId,
      diff: { path: ['chunkOffset'], equals: payload.chunkOffset },
    },
    select: { diff: true },
    orderBy: { at: 'asc' },
    take: 50,
  });
  return rows.flatMap((r) => {
    const ids = (r.diff as { createdIds?: unknown } | null)?.createdIds;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  });
}

/**
 * The worker has the chunk. This is the stale clock. A job still sitting in
 * the queue has no progressAt, so time spent queued is not a stall.
 * Only progressAt is written. Rewriting meta from a snapshot would put back
 * an attempt id a retry had already replaced.
 */
async function noteChunkClaimed(id: string): Promise<void> {
  const progressAt = new Date().toISOString();
  // Milliseconds, not NOW(). Prisma reads this clock back at millisecond
  // resolution, and the stale compare-and-set requires an equal value.
  await prisma.$executeRaw`
    UPDATE migration_jobs
    SET meta = jsonb_set(
          COALESCE(meta, '{}'::jsonb),
          '{progressAt}',
          to_jsonb(${progressAt}::text),
          true
        ),
        updated_at = date_trunc('milliseconds', NOW())
    WHERE id = ${id}::uuid
      AND status = 'RUNNING'
  `;
}

/** Import one chunk: acquire rows, write them, commit progress, queue enrichment, page on. */
export async function processMigrationChunk(
  payload: MigrationJobPayload,
  deps: MigrationChunkDeps,
  log: ChunkLog,
): Promise<void> {
  // Respect cancellation between chunks.
  const jobRow = await prisma.migrationJob.findUnique({
    where: { id: payload.migrationJobId },
    select: { status: true, meta: true },
  });
  if (!jobRow || !migrationChunkMayRun(jobRow.status)) {
    log.info({ status: jobRow?.status }, 'migration chunk skipped — job not running');
    return;
  }
  if (!migrationChunkMatchesAttempt(migrationAttemptId(jobRow.meta), payload.attemptId ?? null)) {
    log.warn({ migrationJobId: payload.migrationJobId }, 'migration chunk skipped — attempt mismatch');
    return;
  }
  await noteChunkClaimed(payload.migrationJobId);

  const entity = normalizeEntity(payload.entityType);
  if (!entity) {
    // e.g. HubSpot "tasks" — fail the job loudly instead of hanging RUNNING.
    // Only from RUNNING: a cancel after the read above must stick.
    const moved = await prisma.migrationJob.updateMany({
      where: { id: payload.migrationJobId, status: { in: [...migrationFrom('fail')] } },
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
    if (moved.count === 0) {
      const current = await prisma.migrationJob.findUnique({
        where: { id: payload.migrationJobId },
        select: { status: true },
      });
      log.warn(
        { migrationJobId: payload.migrationJobId, from: current?.status ?? null, to: 'FAILED' },
        'illegal migration transition',
      );
      return;
    }
    log.warn('unsupported entity type — job failed honestly');
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
    const raw = await deps.readRows(payload.redisKey);
    if (!raw) {
      throw new Error('CSV rows expired from Redis (1h TTL). Restart the import to re-upload');
    }
    const all = JSON.parse(raw) as Record<string, unknown>[];
    rows = all.slice(payload.chunkOffset, payload.chunkOffset + payload.chunkSize);
  }

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

  // The attempt is checked again under a row lock, before any entity insert.
  // The inserts, the counters, and the undo trail commit together. A retry
  // that already replaced the attempt writes nothing.
  let written: { createdIds: string[]; processed: number; errors: MigrationJobError[] } | null;
  let skipReason: 'org' | 'attempt' | 'status' | null = null;
  try {
    written = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; org_id: string; meta: unknown }>>`
        SELECT status::text AS status, org_id::text AS org_id, meta
        FROM migration_jobs
        WHERE id = ${payload.migrationJobId}::uuid
        FOR UPDATE
      `;
      const holder = locked[0];
      if (!holder || holder.status !== 'RUNNING') {
        skipReason = 'status';
        return null;
      }
      if (holder.org_id !== payload.orgId) {
        skipReason = 'org';
        return null;
      }
      if (!migrationChunkMatchesAttempt(migrationAttemptId(holder.meta), payload.attemptId ?? null)) {
        skipReason = 'attempt';
        return null;
      }
      const ctx: WriteCtx = {
        orgId: holder.org_id,
        sourceTag: `migration:${payload.migrationJobId}`,
        dedupStrategy: payload.dedupStrategy,
        tx,
      };
      const createdIds: string[] = [];
      const errors: MigrationJobError[] = [];
      let processed = 0;
      for (let i = resumeFrom; i < rows.length; i++) {
        const absoluteRow = payload.chunkOffset + i;
        try {
          const mapped = applyMappings(rows[i]!, payload.mappings);
          const createdId = await withSavepoint(tx, `chunk_row_${i}`, () => WRITERS[entity](ctx, mapped));
          if (createdId) createdIds.push(createdId);
          processed += 1;
        } catch (err) {
          if (isMigrationDeadlock(err)) throw new MigrationChunkConflict();
          errors.push({
            row: absoluteRow,
            field: null,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const booked = await persistChunkBookkeeping(tx, {
        orgId: holder.org_id,
        userId: payload.userId,
        migrationJobId: payload.migrationJobId,
        entity,
        chunkOffset: payload.chunkOffset,
        resumeFrom,
        createdIds,
        processed,
        errors,
        attemptId: payload.attemptId ?? null,
      });
      // The lock makes this miss unreachable. Throw so a miss cannot commit the inserts.
      if (booked !== 1) throw new Error('migration attempt lost during chunk');
      return { createdIds, processed, errors };
    },
    { maxWait: 10_000, timeout: 120_000 },
    );
  } catch (err) {
    if (err instanceof MigrationChunkConflict) throw err;
    if (isMigrationDeadlock(err)) throw new MigrationChunkConflict();
    throw err;
  }
  if (!written) {
    if (skipReason === 'org') {
      log.warn({ migrationJobId: payload.migrationJobId }, 'migration chunk skipped — org mismatch');
    } else if (skipReason === 'attempt') {
      log.warn({ migrationJobId: payload.migrationJobId }, 'migration chunk skipped — attempt mismatch');
    }
    return;
  }
  const { createdIds, processed, errors } = written;

  // ── Import enrichment: queue public intel and Apollo org data per new company.
  // Prior passes of this chunk are included so a retry after a crash still queues them. ──
  if (entity === 'company') {
    for (const companyId of createdIds) queueTechDetectAfterImport(payload.orgId, companyId);
    const companyIds =
      resumeFrom > 0 ? [...(await chunkCreatedIds(payload)), ...createdIds] : createdIds;
    await queueImportEnrichment(
      {
        orgId: payload.orgId,
        userId: payload.userId,
        migrationJobId: payload.migrationJobId,
        origin: payload.source === 'HUBSPOT_OAUTH' ? 'hubspot' : 'csv',
        companyIds,
        env: deps.env,
        enqueue: deps.enqueueIntel,
      },
      log,
    );
  }

  // ── HubSpot pagination: enqueue the next page while there is one. ──
  if (payload.source === 'HUBSPOT_OAUTH' && nextAfter) {
    const nextOffset = payload.chunkOffset + rows.length;
    try {
      await deps.enqueueChunk(
        `${payload.migrationJobId}-chunk-${nextOffset}`,
        { ...payload, chunkOffset: nextOffset, hubspotAfter: nextAfter },
        { jobId: `${payload.migrationJobId}-${payload.entityType}-chunk-${nextOffset}` },
      );
    } catch (err) {
      await prisma.migrationJob.updateMany({
        where: { id: payload.migrationJobId, status: { in: [...migrationFrom('fail')] } },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorSummary: [{ row: 0, field: null, message: 'Failed to enqueue import chunks' }],
        },
      });
      throw err;
    }
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
      log,
      payload.attemptId ?? null,
    );
  } else {
    await maybeComplete(payload.migrationJobId, undefined, log, payload.attemptId ?? null);
  }

  log.info(
    { processed, errored: errors.length, created: createdIds.length },
    'migration chunk done',
  );
}

// ─── Stale scan ────────────────────────────────────────────────────────────

/** Repeatable job on the migration queue. No second queue. */
export const MIGRATION_STALE_SCAN = 'migration-stale-scan';
export const MIGRATION_STALE_SCAN_MS = 60_000;

/**
 * Compare-and-set RUNNING → FAILED for one observed progress time.
 * A chunk that committed after this time moved `updatedAt`, so the write misses.
 */
export async function claimStaleMigration(id: string, observedProgressAt: Date): Promise<boolean> {
  const moved = await prisma.migrationJob.updateMany({
    where: {
      id,
      status: { in: [...migrationFrom('stale')] },
      updatedAt: observedProgressAt,
    },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
      errorSummary: [{ row: 0, field: null, message: MIGRATION_STALE_REASON }],
    },
  });
  return moved.count === 1;
}

/** Fail running imports whose last progress is older than the shared window. */
export async function sweepStaleMigrations(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MIGRATION_STALE_MS);
  const candidates = await prisma.migrationJob.findMany({
    where: {
      status: 'RUNNING',
      processedRows: 0,
      errorRows: 0,
      updatedAt: { lte: cutoff },
    },
    select: { id: true, status: true, meta: true, updatedAt: true, processedRows: true, errorRows: true },
  });
  let claimed = 0;
  for (const job of candidates) {
    if (
      !migrationStaleDue({
        state: job.status,
        progressAt: migrationProgressAt(job.meta),
        processedRows: job.processedRows,
        errorRows: job.errorRows,
        now,
      })
    ) {
      continue;
    }
    if (await claimStaleMigration(job.id, job.updatedAt)) claimed += 1;
  }
  return claimed;
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
  const intelQueue = new Queue(ACCOUNT_INTEL.name, {
    connection,
    defaultJobOptions: ACCOUNT_INTEL.defaultJobOptions,
  });
  queues.push(intelQueue);
  const chunkDeps: MigrationChunkDeps = {
    readRows: (key) => connection.get(key),
    enqueueChunk: (name, data, opts) => queue.add(name, data, opts),
    enqueueIntel: async (jobs) => {
      await intelQueue.addBulk(
        jobs.map((j) => ({
          name: 'account-intel.full-refresh',
          data: j.data,
          opts: { jobId: j.jobId },
        })),
      );
    },
    env: process.env,
  };

  await queue.add(
    MIGRATION_STALE_SCAN,
    {},
    { repeat: { every: MIGRATION_STALE_SCAN_MS }, jobId: MIGRATION_STALE_SCAN },
  );

  const worker = new Worker(
    MIGRATION.name,
    async (job: Job) => {
      if (job.name === MIGRATION_STALE_SCAN) {
        await sweepStaleMigrations();
        return;
      }
      const payload = MigrationJobPayload.parse(job.data);
      const childLog = log.child({
        migrationJobId: payload.migrationJobId,
        entityType: payload.entityType,
        chunkOffset: payload.chunkOffset,
      });
      await processMigrationChunk(payload, chunkDeps, childLog);
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
        const moved = await prisma.migrationJob
          .updateMany({
            where: { id: migrationJobId, status: { in: [...migrationFrom('fail')] } },
            data: { status: 'FAILED', completedAt: new Date() },
          })
          .catch((updateErr) => {
            log.error({ updateErr, migrationJobId }, 'failed to mark migration job FAILED');
            return { count: 0 };
          });
        if (moved.count !== 1) {
          log.warn({ migrationJobId, to: 'FAILED' }, 'illegal migration transition');
        } else {
          await prisma.$executeRaw`
            UPDATE migration_jobs
            SET error_summary = CASE
              WHEN jsonb_array_length(error_summary) < 200
              THEN error_summary || ${JSON.stringify([
                {
                  row: 0,
                  field: null,
                  message: isMigrationDeadlock(err)
                    ? MIGRATION_DEADLOCK_PUBLIC
                    : `chunk failed permanently: ${err.message}`,
                },
              ])}::jsonb
              ELSE error_summary
            END
            WHERE id = ${migrationJobId}::uuid AND status = 'FAILED'`.catch((rawErr) =>
            log.warn({ err: rawErr, migrationJobId }, 'best-effort error_summary append failed'),
          );
        }
      }
    }
  });

  workers.push(worker);
  log.info('migration import worker started');
}
