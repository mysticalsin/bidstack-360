// Single source of the Prisma client across the monorepo.
// Apps and packages should import from `@bidstack/db`, never from
// `@prisma/client` or the generated path directly.
//
// We hold a single PrismaClient instance per process (singleton) to avoid
// the "too many connections" anti-pattern in dev with HMR.

import { PrismaClient } from '../generated/client/index.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
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
  ProposalDocument,
  ProviderHealth,
  QueueHealth,
  ReleaseScore,
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
} from '../generated/client/index.js';
