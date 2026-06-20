// Single source of the Prisma client across the monorepo.
// Apps and packages should import from `@bidstack/db`, never from
// `@prisma/client` or the generated path directly.
//
// We hold a single PrismaClient instance per process (singleton) to avoid
// the "too many connections" anti-pattern in dev with HMR.
//
// PII field encryption is opt-in via PII_FIELD_ENCRYPTION=true.
// Default is false for backward compatibility with existing plaintext rows.
// Runbook: docs/security/pii-field-encryption.md

import { PrismaClient } from '../generated/client/index.js';
import { isPiiEncryptionEnabled, makePiiMiddleware } from './middleware/pii-encryption.js';
import { makeSoftDeleteMiddleware } from './middleware/soft-delete.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function buildPrismaClient(): PrismaClient {
  // Connection-pool sizing is NOT configured here on purpose. Prisma's canonical
  // knob is the connection string itself (`?connection_limit=N&pool_timeout=S`),
  // so the pool is owned by per-service env (DATABASE_URL) + the infra pooler,
  // not hardcoded in shared code. This matters at 100k scale: Prisma's DEFAULT
  // pool is num_cpus*2+1 PER PROCESS, so without an explicit connection_limit,
  // N api replicas + the worker silently multiply and blow past Postgres
  // max_connections. The worker is the busiest client (~150 in-flight jobs vs a
  // default ~17 connections → P2024 pool-timeout errors), so its connection_limit
  // must match its job concurrency. Front Postgres with PgBouncer (transaction
  // mode) and set per-service connection_limit such that
  //   sum(replicas * connection_limit) + worker < Postgres max_connections.
  // See DEPLOY.production.md §"Connection pool sizing" and .env.example.
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  // WHY: PII encryption middleware intercepts writes (create/update/upsert) to
  // auto-encrypt Contact/Lead/User PII fields, and reads to auto-decrypt.
  // Gated by PII_FIELD_ENCRYPTION=true so existing deployments are unaffected
  // until operators run the migration script and flip the flag.
  if (isPiiEncryptionEnabled()) {
    // $use is deprecated in Prisma 5 but still supported.
    // The alternative ($extends query) does not have the same hook surface for
    // post-read decryption across all operations, so we keep $use until
    // Prisma ships native $extends middleware equivalents.
    client.$use(makePiiMiddleware());
  }

  // Soft delete middleware automatically filters out records where deletedAt is not null.
  // We apply this globally so developers don't have to constantly append `deletedAt: null`.
  client.$use(makeSoftDeleteMiddleware());

  return client;
}

const globalForPrisma2 = globalForPrisma as unknown as { prisma?: PrismaClient };

/**
 * Shared Prisma client singleton.
 *
 * Reuses an existing client instance in development (hot reload) and creates
 * a fresh client in production. Always import `prisma` from `@bidstack/db`
 * rather than instantiating `PrismaClient` directly — that avoids connection
 * pool exhaustion from multiple instances.
 *
 * @example
 * ```ts
 * import { prisma } from '@bidstack/db';
 * const leads = await prisma.lead.findMany({ where: { orgId, deletedAt: null } });
 * ```
 */
export const prisma = globalForPrisma2.prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma2.prisma = prisma;
}

export type {
  Org,
  User,
  Opportunity,
  Contact,
  Task,
  Document,
  SyncEvent,
  ApiKey,
  WebhookSubscription,
  WebhookDelivery,
  AuditLog,
  Note,
  FileAttachment,
  CompanyEnrichment,
  AiInsight,
  DustRun,
  DashboardWidget,
  BidOpportunity,
  RiskRegisterItem,
  ComplianceCheck,
  Proposal,
  ProposalSection,
  ProposalStatus,
  ProviderHealth,
  QueueHealth,
  ReleaseScore,
  Lead,
} from '../generated/client/index.js';

// `Prisma` is exported as a value because we need its runtime classes
// (PrismaClientKnownRequestError, etc.) in the API error handler.
export {
  Prisma,
  PrismaClient,
  OpportunityStage,
  Sentiment,
  TaskStatus,
  DocumentKind,
  SyncEventStatus,
  CasePriority,
  CaseStatus,
  WorkflowTriggerKind,
  WorkflowActionKind,
  LeadStatus,
  LeadPriority,
  IntegrationProvider,
  EmailProvider,
} from '../generated/client/index.js';

// Curated multi-tenant demo seeding — shared by the `db:seed:demo` CLI and the
// runtime demo sign-in door, which populates a fresh per-visitor org on sign-in.
export { seedOrgData } from './seed-org-data.js';
export type { SeedOrgDataOptions } from './seed-org-data.js';
