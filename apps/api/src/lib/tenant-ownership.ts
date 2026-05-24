import { prisma } from '@bidstack/db';

type TenantEntityType =
  | 'account'
  | 'agent'
  | 'company'
  | 'contact'
  | 'document'
  | 'file'
  | 'invoice'
  | 'lead'
  | 'opportunity'
  | 'product'
  | 'proposal'
  | 'sales-order'
  | 'service-case'
  | 'task'
  | 'territory'
  | 'user'
  | 'workflow';

type TenantDb = typeof prisma;

const ENTITY_ALIASES: Record<string, TenantEntityType> = {
  account: 'account',
  accounts: 'account',
  agent: 'agent',
  agents: 'agent',
  company: 'company',
  companies: 'company',
  contact: 'contact',
  contacts: 'contact',
  document: 'document',
  documents: 'document',
  file: 'file',
  files: 'file',
  invoice: 'invoice',
  invoices: 'invoice',
  lead: 'lead',
  leads: 'lead',
  opportunity: 'opportunity',
  opportunities: 'opportunity',
  product: 'product',
  products: 'product',
  proposal: 'proposal',
  proposals: 'proposal',
  salesorder: 'sales-order',
  salesorders: 'sales-order',
  sales_order: 'sales-order',
  sales_orders: 'sales-order',
  'sales-order': 'sales-order',
  'sales-orders': 'sales-order',
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

export function normalizeTenantEntityType(entityType: string): TenantEntityType | null {
  const normalized = entityType.trim().toLowerCase();
  return ENTITY_ALIASES[normalized] ?? null;
}

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
    case 'agent':
      return (await db.agent.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'contact':
      return (await db.contact.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'document':
      return (await db.document.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'file':
      return (await db.fileAttachment.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'invoice':
      return (await db.invoice.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'lead':
      return (await db.lead.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'opportunity':
      return (await db.opportunity.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'product':
      return (await db.product.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'proposal':
      return (await db.proposal.count({ where: { id, orgId, deletedAt: null } })) > 0;
    case 'sales-order':
      return (await db.salesOrder.count({ where: { id, orgId, deletedAt: null } })) > 0;
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
