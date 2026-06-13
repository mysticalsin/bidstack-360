import { prisma } from '@bidstack/db';

type TenantEntityType =
  | 'account'
  | 'company'
  | 'contact'
  | 'document'
  | 'file'
  | 'lead'
  | 'opportunity'
  | 'proposal'
  | 'service-case'
  | 'task'
  | 'territory'
  | 'user'
  | 'workflow';

type TenantDb = typeof prisma;

const ENTITY_ALIASES: Record<string, TenantEntityType> = {
  account: 'account',
  accounts: 'account',
  company: 'company',
  companies: 'company',
  contact: 'contact',
  contacts: 'contact',
  document: 'document',
  documents: 'document',
  file: 'file',
  files: 'file',
  lead: 'lead',
  leads: 'lead',
  opportunity: 'opportunity',
  opportunities: 'opportunity',
  proposal: 'proposal',
  proposals: 'proposal',
  servicecase: 'service-case',
  servicecases: 'service-case',
  service_case: 'service-case',
  service_cases: 'service-case',
  'service-case': 'service-case',
  'service-cases': 'service-case',
  task: 'task',
  tasks: 'task',
  territory: 'territory',
  territories: 'territory',
  user: 'user',
  users: 'user',
  workflow: 'workflow',
  workflows: 'workflow',
};

/**
 * Normalizes a caller-supplied entity type string to the canonical internal form.
 *
 * @param entityType - Raw string (e.g. `"leads"`, `"Contact"`, `"opportunity"`).
 * @returns The canonical `TenantEntityType` or `null` if unrecognized.
 */
export function normalizeTenantEntityType(entityType: string): TenantEntityType | null {
  const normalized = entityType.trim().toLowerCase();
  return ENTITY_ALIASES[normalized] ?? null;
}

/**
 * Checks that a single entity row belongs to the requesting organisation.
 * Multi-tenancy guard — call before returning or mutating any record.
 *
 * @param entityType - Entity type string (see {@link normalizeTenantEntityType}).
 * @param id - Primary key of the record.
 * @param orgId - The authenticated organisation's ID.
 * @param db - Optional Prisma client (defaults to shared singleton).
 * @returns `true` if the record exists and belongs to `orgId`, `false` otherwise.
 */
export async function tenantEntityBelongsToOrg(
  entityType: string,
  id: string,
  orgId: string,
  db: TenantDb = prisma,
): Promise<boolean> {
  const normalized = normalizeTenantEntityType(entityType);
  if (!normalized) return false;

  switch (normalized) {
    case 'account':
    case 'company':
      return (await db.company.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'contact':
      return (await db.contact.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'document':
      return (await db.document.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'file':
      return (await db.fileAttachment.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'lead':
      return (await db.lead.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'opportunity':
      return (await db.opportunity.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'proposal':
      return (await db.proposal.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'service-case':
      return (await db.serviceCase.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'task':
      return (await db.task.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'territory':
      return (await db.territory.count({ where: { id, orgId } })) > 0;
    case 'user':
      return (await db.user.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'workflow':
      return (await db.workflow.count({ where: { id, orgId, deletedAt: null } })) > 0;
  }
}

/**
 * Bulk variant of {@link tenantEntityBelongsToOrg}.
 * Returns `true` only if **all** IDs belong to `orgId`.
 *
 * @param entityType - Entity type string.
 * @param ids - Array of primary keys to check (duplicates are deduplicated).
 * @param orgId - The authenticated organisation's ID.
 * @param db - Optional Prisma client (defaults to shared singleton).
 * @returns `true` if every ID belongs to `orgId`, `false` if any is foreign or missing.
 */
export async function tenantEntitiesBelongToOrg(
  entityType: string,
  ids: readonly string[],
  orgId: string,
  db: TenantDb = prisma,
): Promise<boolean> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return true;

  const results = await Promise.all(
    uniqueIds.map((id) => tenantEntityBelongsToOrg(entityType, id, orgId, db)),
  );
  return results.every(Boolean);
}
