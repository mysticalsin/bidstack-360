// tenant-export-registry — the GDPR Art. 20 export contract.
//
// TWO layers of secret protection:
//   1. MODEL ALLOWLIST (this file): only the business/personal-data entities
//      listed in TENANT_EXPORT_ENTITIES are ever exported. Secret-bearing
//      models — ApiKey, IntegrationToken, IntegrationConfig (encrypted
//      credentials), WebhookSubscription/ZapierApp (signing secrets),
//      SlackWorkspace / GraphSubscription (bot tokens), NativePushToken,
//      SyncEvent, audit logs, RBAC join rows — are deliberately absent.
//   2. FIELD DENYLIST (safeSelectForModel): even within an exported model, any
//      scalar field whose name matches a secret pattern (hash, token, secret,
//      *Encrypted, storageKey/cancelToken pointers) is dropped from the
//      positive Prisma `select`. Relation fields are never selected.

import { Prisma } from '@bidstack/db';

export interface TenantExportEntity {
  /** Stable name written to each NDJSON record's `_entity` tag. */
  name: string;
  /** Prisma model name (PascalCase) used to read the DMMF. */
  model: string;
  /** Prisma client delegate accessor (camelCase) used at runtime. */
  accessor: string;
}

/**
 * Curated set of org-scoped business / personal-data entities. Order is the
 * write order in the archive. Every model here has `id` (UUID), `orgId` (or is
 * the Org itself), and `createdAt`, so the worker can keyset-paginate uniformly.
 */
export const TENANT_EXPORT_ENTITIES: readonly TenantExportEntity[] = [
  { name: 'org', model: 'Org', accessor: 'org' },
  { name: 'users', model: 'User', accessor: 'user' },
  { name: 'companies', model: 'Company', accessor: 'company' },
  { name: 'contacts', model: 'Contact', accessor: 'contact' },
  { name: 'opportunities', model: 'Opportunity', accessor: 'opportunity' },
  { name: 'leads', model: 'Lead', accessor: 'lead' },
  { name: 'tasks', model: 'Task', accessor: 'task' },
  { name: 'activities', model: 'Activity', accessor: 'activity' },
  { name: 'notes', model: 'Note', accessor: 'note' },
  { name: 'fileAttachments', model: 'FileAttachment', accessor: 'fileAttachment' },
  { name: 'serviceCases', model: 'ServiceCase', accessor: 'serviceCase' },
  { name: 'bidScores', model: 'BidScore', accessor: 'bidScore' },
  { name: 'proposals', model: 'Proposal', accessor: 'proposal' },
  { name: 'tags', model: 'Tag', accessor: 'tag' },
  { name: 'companyEnrichments', model: 'CompanyEnrichment', accessor: 'companyEnrichment' },
] as const;

/**
 * Field-name fragments that mark a column as secret material we must never put
 * in a portability export. Matched case-insensitively against the column name.
 * `storageKey` and `cancelToken` are internal pointers/links, not the data
 * subject's content, so they are excluded too (defense in depth).
 */
const SECRET_FIELD_PATTERNS: readonly RegExp[] = [
  /hash/i,
  /token/i,
  /secret/i,
  /encrypted/i,
  /password/i,
  /credential/i,
  /apikey/i,
  /privatekey/i,
  /\bsalt\b/i,
  /storagekey/i,
];

function isSecretField(name: string): boolean {
  return SECRET_FIELD_PATTERNS.some((re) => re.test(name));
}

// Build the model field map from the generated DMMF once at module load.
const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));

// Cache the computed safe-select per model — the DMMF never changes at runtime.
const selectCache = new Map<string, Record<string, true>>();

/**
 * Build a positive Prisma `select` of safe scalar fields for a model: every
 * scalar (incl. enum/JSON) column whose name is not on the secret denylist.
 * Relation and list-relation fields are excluded (they are exported as their
 * own top-level entities or are foreign keys already covered by scalars).
 */
export function safeSelectForModel(model: string): Record<string, true> {
  const cached = selectCache.get(model);
  if (cached) return cached;

  const def = MODELS.get(model);
  if (!def) throw new Error(`tenant-export: model "${model}" not found in Prisma DMMF`);

  const select: Record<string, true> = {};
  for (const field of def.fields) {
    // `kind === 'object'` is a relation; only export scalars/enums.
    if (field.kind === 'object') continue;
    if (field.isList) continue;
    if (isSecretField(field.name)) continue;
    select[field.name] = true;
  }
  // `id` must always be present — it is the keyset cursor.
  if (!select.id) {
    throw new Error(`tenant-export: model "${model}" has no exportable id column`);
  }
  selectCache.set(model, select);
  return select;
}
