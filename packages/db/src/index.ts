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

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function buildPrismaClient(): PrismaClient {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma $use types require any-typed params
    (client as any).$use(makePiiMiddleware());
  }

  return client;
}

const globalForPrisma2 = globalForPrisma as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma2.prisma ?? buildPrismaClient();

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
  Invoice,
  InvoiceLine,
  Payment,
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
  OrderState,
  InvoiceState,
  PaymentMethod,
  CasePriority,
  CaseStatus,
  WorkflowTriggerKind,
  WorkflowActionKind,
  LeadStatus,
  LeadPriority,
} from '../generated/client/index.js';
