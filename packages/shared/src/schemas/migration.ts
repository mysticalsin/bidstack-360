// Migration connector schemas.
// Shared between apps/api (routes) and apps/worker (job processing).
// Why separate file: migration is a Wave 3 feature with its own data shapes.

import { z } from 'zod';

// ─── Enums (mirror Prisma enums) ────────────────────────────────────────────

export const MigrationSourceEnum = z.enum([
  'SALESFORCE_CSV',
  'HUBSPOT_OAUTH',
  'CSV',
]);
export type MigrationSource = z.infer<typeof MigrationSourceEnum>;

export const MigrationStatusEnum = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETE',
  'FAILED',
  'CANCELLED',
]);
export type MigrationStatus = z.infer<typeof MigrationStatusEnum>;

// ─── Column-mapping types ────────────────────────────────────────────────────

// One entry in a column-mapping: user picked which source column maps to which
// target field in BidStack (or null to skip the column).
export const ColumnMapping = z.object({
  sourceColumn: z.string().min(1),
  targetField: z.string().nullable(),
});
export type ColumnMapping = z.infer<typeof ColumnMapping>;

// The full mappings object stored in MigrationMapping.mappings.
// Key is source column name; value is target field path (e.g. "company.name").
export const MappingsRecord = z.record(z.string().nullable());
export type MappingsRecord = z.infer<typeof MappingsRecord>;

// ─── MigrationJob (API response) ────────────────────────────────────────────

export const MigrationJobError = z.object({
  row: z.number().int().nonnegative(),
  field: z.string().nullable(),
  message: z.string(),
});
export type MigrationJobError = z.infer<typeof MigrationJobError>;

export const MigrationJobResponse = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  source: MigrationSourceEnum,
  status: MigrationStatusEnum,
  totalRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  errorSummary: z.array(MigrationJobError),
  meta: z.record(z.unknown()),
  undoableUntil: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MigrationJobResponse = z.infer<typeof MigrationJobResponse>;

// ─── MigrationMapping (API response) ────────────────────────────────────────

export const MigrationMappingResponse = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  source: MigrationSourceEnum,
  sourceEntity: z.string().min(1),
  mappings: MappingsRecord,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MigrationMappingResponse = z.infer<typeof MigrationMappingResponse>;

// ─── Dedup strategy ─────────────────────────────────────────────────────────

export const DedupStrategyEnum = z.enum([
  'skip',       // Skip row if external_id already exists.
  'update',     // Overwrite existing row fields with incoming data.
  'duplicate',  // Always create a new row regardless of external_id.
]);
export type DedupStrategy = z.infer<typeof DedupStrategyEnum>;

const RAW_SECRET_META_KEY_RE =
  /(^|[_-])(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|private[_-]?key|client[_-]?secret|secret)$/i;
const SECRET_REFERENCE_META_KEY_RE =
  /(secretRefs?|secretReferences?|credentialRefs?|credentialReferences?|credentialId|integrationConfigId)$/i;

function rawSecretMetaPaths(value: unknown, path: string[] = []): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const nextPath = [...path, key];
    if (RAW_SECRET_META_KEY_RE.test(key) && !SECRET_REFERENCE_META_KEY_RE.test(key)) {
      paths.push(nextPath.join('.'));
      continue;
    }
    paths.push(...rawSecretMetaPaths(nested, nextPath));
  }
  return paths;
}

// ─── Job payload stored in BullMQ ───────────────────────────────────────────

// One BullMQ job is a chunk of rows, not the entire import, so large imports
// fan out into multiple jobs and the worker never times out.
export const MigrationJobPayload = z
  .object({
    migrationJobId: z.string().uuid(),
    orgId: z.string().uuid(),
    userId: z.string().uuid(),
    source: MigrationSourceEnum,
    // Entity being imported: "Account", "Contact", "Lead", "Opportunity", "Activity"
    entityType: z.string().min(1),
    // Row offset for this chunk (0-indexed). Used for progress tracking.
    chunkOffset: z.number().int().nonnegative(),
    // Chunk size (default 100).
    chunkSize: z.number().int().positive().default(100),
    // Total rows in the full import (set on first chunk so worker can report progress).
    totalRows: z.number().int().nonnegative(),
    // For CSV imports: path in Redis where the parsed rows are stored.
    // For HubSpot OAuth: not used (rows are fetched directly from API).
    redisKey: z.string().min(1).optional(),
    // For HubSpot OAuth: pagination cursor for this chunk.
    hubspotAfter: z.string().optional(),
    mappings: MappingsRecord,
    dedupStrategy: DedupStrategyEnum.default('update'),
    // Which column name (if any) holds the source system's record ID for dedup.
    externalIdColumn: z.string().optional(),
    // Non-secret provider-specific state. Queue payloads may carry stable
    // references such as IntegrationConfig ids; raw provider tokens stay in the
    // encrypted credential store and are resolved by workers just in time.
    meta: z.record(z.unknown()).optional(),
  })
  .superRefine((payload, ctx) => {
    const secretPaths = rawSecretMetaPaths(payload.meta);
    for (const path of secretPaths) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', ...path.split('.')],
        message:
          'Migration job payload meta cannot contain raw secret material; store a credential reference instead.',
      });
    }
  });
export type MigrationJobPayload = z.infer<typeof MigrationJobPayload>;

// ─── HubSpot discovery (entity counts pre-import) ───────────────────────────

export const HubSpotDiscovery = z.object({
  companies: z.number().int().nonnegative(),
  contacts: z.number().int().nonnegative(),
  deals: z.number().int().nonnegative(),
  tasks: z.number().int().nonnegative(),
});
export type HubSpotDiscovery = z.infer<typeof HubSpotDiscovery>;

// ─── API request/response shapes ────────────────────────────────────────────

// POST /api/v1/migrations — start a migration job.
// For CSV/Salesforce sources the request body is multipart (handled by Fastify
// multipart plugin); this schema covers JSON metadata sent alongside files.
export const StartMigrationRequest = z.object({
  source: MigrationSourceEnum,
  // Entities to import (subset selected by user).
  entities: z.array(z.string().min(1)).min(1),
  dedupStrategy: DedupStrategyEnum.default('update'),
  externalIdColumn: z.string().optional(),
  // Column mappings per entity (keyed by entity type).
  mappings: z.record(MappingsRecord).optional(),
});
export type StartMigrationRequest = z.infer<typeof StartMigrationRequest>;

// POST /api/v1/migrations/mappings — save column mappings.
export const SaveMappingRequest = z.object({
  source: MigrationSourceEnum,
  sourceEntity: z.string().min(1),
  mappings: MappingsRecord,
});
export type SaveMappingRequest = z.infer<typeof SaveMappingRequest>;

// GET /api/v1/migrations/:id/errors — download failed rows as CSV.
// Returned as text/csv; this schema just shapes the JSON error list.
export const MigrationErrorRow = z.object({
  row: z.number().int().nonnegative(),
  field: z.string().nullable(),
  message: z.string(),
  originalData: z.record(z.unknown()).optional(),
});
export type MigrationErrorRow = z.infer<typeof MigrationErrorRow>;

// ─── Smart default mappings (Salesforce → BidStack) ─────────────────────────
// Why here: both the API (validation) and frontend (pre-populate wizard) need
// the same defaults. One source of truth prevents drift.

export const SALESFORCE_ACCOUNT_DEFAULTS: MappingsRecord = {
  'Account Name': 'company.name',
  'Account ID': 'company.externalId',
  'Website': 'company.website',
  'Industry': 'company.industry',
  'Employees': 'company.employeeCount',
  'Billing Country': 'company.countryCode',
  'Phone': 'company.phone',
  'Description': 'company.description',
  'Annual Revenue': 'company.annualRevenueMicros',
  'Account Owner': null,
};

export const SALESFORCE_CONTACT_DEFAULTS: MappingsRecord = {
  'First Name': 'contact.firstName',
  'Last Name': 'contact.lastName',
  'Email': 'contact.email',
  'Phone': 'contact.phone',
  'Mobile': 'contact.mobile',
  'Title': 'contact.title',
  'Department': 'contact.department',
  'Account Name': 'contact.companyName',
  'Contact ID': 'contact.externalId',
  'Description': 'contact.notes',
};

export const SALESFORCE_OPPORTUNITY_DEFAULTS: MappingsRecord = {
  'Opportunity Name': 'opportunity.name',
  'Opportunity ID': 'opportunity.externalId',
  'Account Name': 'opportunity.companyName',
  'Stage': 'opportunity.stage',
  'Amount': 'opportunity.valueMicros',
  'Close Date': 'opportunity.closeDate',
  'Probability (%)': 'opportunity.probability',
  'Description': 'opportunity.description',
  'Owner': null,
};

export const SALESFORCE_LEAD_DEFAULTS: MappingsRecord = {
  'First Name': 'lead.firstName',
  'Last Name': 'lead.lastName',
  'Email': 'lead.email',
  'Phone': 'lead.phone',
  'Company': 'lead.company',
  'Title': 'lead.title',
  'Lead ID': 'lead.externalId',
  'Lead Source': 'lead.source',
  'Status': 'lead.status',
  'Description': 'lead.notes',
};

export const HUBSPOT_COMPANY_DEFAULTS: MappingsRecord = {
  'name': 'company.name',
  'domain': 'company.domain',
  'website': 'company.website',
  'industry': 'company.industry',
  'numberofemployees': 'company.employeeCount',
  'country': 'company.countryCode',
  'phone': 'company.phone',
  'description': 'company.description',
  'annualrevenue': 'company.annualRevenueMicros',
  'hs_object_id': 'company.externalId',
};

export const HUBSPOT_CONTACT_DEFAULTS: MappingsRecord = {
  'firstname': 'contact.firstName',
  'lastname': 'contact.lastName',
  'email': 'contact.email',
  'phone': 'contact.phone',
  'mobilephone': 'contact.mobile',
  'jobtitle': 'contact.title',
  'department': 'contact.department',
  'company': 'contact.companyName',
  'hs_object_id': 'contact.externalId',
  'notes_body': 'contact.notes',
};

export const HUBSPOT_DEAL_DEFAULTS: MappingsRecord = {
  'dealname': 'opportunity.name',
  'dealstage': 'opportunity.stage',
  'amount': 'opportunity.valueMicros',
  'closedate': 'opportunity.closeDate',
  'hs_object_id': 'opportunity.externalId',
};
