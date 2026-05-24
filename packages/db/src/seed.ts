// Seeds the local Postgres with the prototype's fixtures so the API + web app
// have realistic data on first boot. Idempotent: re-running upserts.
//
// Maps prototype stage names to the canonical enum:
//   qualifying  -> qualified
//   won         -> closed_won
//   lost        -> closed_lost

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenvFlow from 'dotenv-flow';

import { type Prisma, PrismaClient } from '../generated/client/index.js';
import {
  fixtureCompanyEnrichments,
  fixtureContacts,
  fixtureLeads,
  fixtureOpps,
  fixtureTasks,
  fixtureUsers,
  intelFor,
} from './seed-data.js';
import {
  fixtureProductCategories,
  fixtureProducts,
  fixtureSalesCustomers,
  fixtureSalesOrders,
} from './sales-seed-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvFlow.config({ path: path.resolve(__dirname, '../../..'), silent: true });

const prisma = new PrismaClient();

const SEED_ORG_CLERK = 'org_seed_mantu';
const SEED_ORG_NAME = 'Mantu (seed)';

const PERMISSION_SEEDS = [
  permission('accounts:read', 'Read accounts', 'View account records and account cockpit data.'),
  permission('accounts:write', 'Manage accounts', 'Create and update account records.'),
  permission('activities:read', 'Read activities', 'View CRM activity timelines.'),
  permission('activities:write', 'Manage activities', 'Create and update CRM activities.'),
  permission('agents:read', 'Read agents', 'View RFP and CRM agent configuration.'),
  permission('agents:write', 'Manage agents', 'Configure RFP and CRM agents.'),
  permission('audit-log:read', 'Read audit log', 'View security, admin, and data audit history.'),
  permission('bid-scores:read', 'Read bid scores', 'View bid/no-bid scoring and rationale.'),
  permission('bid-scores:write', 'Manage bid scores', 'Create and update bid/no-bid scoring.'),
  permission('companies:read', 'Read companies', 'View company records.'),
  permission('companies:write', 'Manage companies', 'Create and update company records.'),
  permission('contacts:read', 'Read contacts', 'View contact records.'),
  permission('contacts:write', 'Manage contacts', 'Create and update contact records.'),
  permission('documents:read', 'Read documents', 'View bid and account documents.'),
  permission('documents:write', 'Manage documents', 'Upload and update bid and account documents.'),
  permission('files:read', 'Read files', 'View uploaded files and attachments.'),
  permission('files:write', 'Manage files', 'Upload, finalize, and manage file attachments.'),
  permission('integrations:read', 'Read integrations', 'View integration configuration.'),
  permission('integrations:write', 'Manage integrations', 'Configure external integrations.'),
  permission('invoices:read', 'Read invoices', 'View invoices and payments.'),
  permission('invoices:write', 'Manage invoices', 'Create and update invoices and payments.'),
  permission('leads:read', 'Read leads', 'View lead records.'),
  permission('leads:write', 'Manage leads', 'Create and update lead records.'),
  permission('mcp:read', 'Use MCP read tools', 'Call read-only MCP tools.'),
  permission('mcp:write', 'Use MCP write tools', 'Call MCP tools that mutate data.'),
  permission('opportunities:read', 'Read opportunities', 'View opportunities and pipeline data.'),
  permission('opportunities:write', 'Manage opportunities', 'Create and update opportunities.'),
  permission('products:read', 'Read products', 'View products and catalog data.'),
  permission('products:write', 'Manage products', 'Create and update products and catalog data.'),
  permission('proposals:read', 'Read proposals', 'View proposal workspace data.'),
  permission('proposals:write', 'Manage proposals', 'Create and update proposals.'),
  permission('reports:read', 'Read reports', 'View reports and analytics.'),
  permission('reports:write', 'Manage reports', 'Create and update report definitions.'),
  permission('sales-orders:read', 'Read quotes and orders', 'View quotations and sales orders.'),
  permission(
    'sales-orders:write',
    'Manage quotes and orders',
    'Create and update quotations and orders.',
  ),
  permission('service-desk:read', 'Read service desk', 'View service cases.'),
  permission('service-desk:write', 'Manage service desk', 'Create and update service cases.'),
  permission('settings:read', 'Read settings', 'View organization settings and roles.'),
  permission(
    'settings:write',
    'Manage settings',
    'Update organization settings, roles, and permissions.',
  ),
  permission('tasks:read', 'Read tasks', 'View tasks.'),
  permission('tasks:write', 'Manage tasks', 'Create and update tasks.'),
  permission(
    'territories:read',
    'Read territories',
    'View territories, forecasts, and routing rules.',
  ),
  permission(
    'territories:write',
    'Manage territories',
    'Create and update territories, forecasts, and routing rules.',
  ),
  permission('users:read', 'Read users', 'View organization users.'),
  permission('users:write', 'Manage users', 'Update organization users and role assignments.'),
  permission('webhooks:read', 'Read webhooks', 'View webhook subscriptions.'),
  permission('webhooks:write', 'Manage webhooks', 'Create and update webhook subscriptions.'),
  permission('workflows:read', 'Read workflows', 'View workflow automation definitions and runs.'),
  permission('workflows:write', 'Manage workflows', 'Create, update, and run workflow automation.'),
] as const;

const ALL_PERMISSION_KEYS = PERMISSION_SEEDS.map((p) => p.key);
const READ_PERMISSION_KEYS = ALL_PERMISSION_KEYS.filter((key) => key.endsWith(':read'));

const ROLE_SEEDS = [
  role('Admin', 'Full tenant administrator with all permissions.', ALL_PERMISSION_KEYS),
  role('Sales', 'Owns leads, accounts, contacts, opportunities, quotes, and sales activity.', [
    ...readKeys(
      'accounts',
      'activities',
      'companies',
      'contacts',
      'leads',
      'opportunities',
      'products',
      'proposals',
      'reports',
      'sales-orders',
      'tasks',
    ),
    ...writeKeys(
      'accounts',
      'activities',
      'contacts',
      'leads',
      'opportunities',
      'sales-orders',
      'tasks',
    ),
  ]),
  role(
    'Presales',
    'Owns bid qualification, proposal work, documents, and compliance preparation.',
    [
      ...readKeys(
        'accounts',
        'activities',
        'agents',
        'bid-scores',
        'companies',
        'contacts',
        'documents',
        'files',
        'opportunities',
        'products',
        'proposals',
        'reports',
        'tasks',
      ),
      ...writeKeys('activities', 'bid-scores', 'documents', 'files', 'proposals', 'tasks'),
    ],
  ),
  role('Finance', 'Owns quote-to-cash financial records.', [
    ...readKeys(
      'accounts',
      'companies',
      'contacts',
      'invoices',
      'products',
      'reports',
      'sales-orders',
    ),
    ...writeKeys('invoices', 'sales-orders'),
  ]),
  role('Manager', 'Manages commercial execution, team performance, and approvals.', [
    ...READ_PERMISSION_KEYS,
    ...writeKeys(
      'activities',
      'bid-scores',
      'leads',
      'opportunities',
      'reports',
      'tasks',
      'territories',
      'workflows',
    ),
  ]),
  role(
    'Executive',
    'Read-only executive visibility across CRM and audit data.',
    READ_PERMISSION_KEYS,
  ),
  role('Service Desk', 'Handles post-sale service cases and customer follow-up.', [
    ...readKeys(
      'accounts',
      'activities',
      'companies',
      'contacts',
      'reports',
      'service-desk',
      'tasks',
    ),
    ...writeKeys('activities', 'service-desk', 'tasks'),
  ]),
  role(
    'Read-only',
    'Read-only access for internal viewers.',
    READ_PERMISSION_KEYS.filter((key) => !key.startsWith('mcp:')),
  ),
  role('External Partner', 'Restricted proposal collaboration access for approved partners.', [
    ...readKeys('documents', 'proposals', 'tasks'),
  ]),
  // ─── Wave 4 spec roles ────────────────────────────────────────────────────
  // Named exactly as the product spec requires so UI role pickers and
  // feature-flag checks can reference them by canonical string.
  role(
    'Sales Manager',
    'Manages the sales team; full CRM read/write + territory + reports + workflow.',
    [
      ...READ_PERMISSION_KEYS,
      ...writeKeys(
        'accounts',
        'activities',
        'contacts',
        'leads',
        'opportunities',
        'reports',
        'sales-orders',
        'tasks',
        'territories',
        'workflows',
      ),
    ],
  ),
  role(
    'Account Executive',
    'Owns a set of accounts and opportunities; full CRM read/write on core objects.',
    [
      ...readKeys(
        'accounts',
        'activities',
        'companies',
        'contacts',
        'leads',
        'opportunities',
        'products',
        'proposals',
        'reports',
        'sales-orders',
        'tasks',
      ),
      ...writeKeys(
        'accounts',
        'activities',
        'contacts',
        'leads',
        'opportunities',
        'proposals',
        'sales-orders',
        'tasks',
      ),
    ],
  ),
  role('SDR', 'Inbound/outbound lead development; limited to leads and early-stage pipeline.', [
    ...readKeys('accounts', 'activities', 'companies', 'contacts', 'leads', 'tasks'),
    ...writeKeys('activities', 'contacts', 'leads', 'tasks'),
  ]),
  role(
    'Customer Success',
    'Post-sale relationship management; accounts, contacts, service, tasks.',
    [
      ...readKeys(
        'accounts',
        'activities',
        'companies',
        'contacts',
        'opportunities',
        'reports',
        'service-desk',
        'tasks',
      ),
      ...writeKeys('accounts', 'activities', 'contacts', 'service-desk', 'tasks'),
    ],
  ),
  role(
    'Read-Only',
    'Read-only access to all non-MCP, non-audit resources.',
    READ_PERMISSION_KEYS.filter((key) => !key.startsWith('mcp:') && key !== 'audit-log:read'),
  ),
] as const;

const LEGACY_ROLE_ASSIGNMENTS: Record<string, readonly string[]> = {
  admin: ['Admin'],
  bid_manager: ['Manager', 'Presales'],
  solution_arch: ['Presales'],
  account_exec: ['Sales'],
  finance: ['Finance'],
  manager: ['Manager'],
  service_desk: ['Service Desk'],
  viewer: ['Read-only'],
  member: ['Read-only'],
};

function permission(key: string, name: string, description: string) {
  return { key, name, description };
}

function role(name: string, description: string, permissionKeys: readonly string[]) {
  return { name, description, permissionKeys: Array.from(new Set(permissionKeys)) };
}

function readKeys(...resources: string[]) {
  return resources.map((resource) => `${resource}:read`);
}

function writeKeys(...resources: string[]) {
  return resources.map((resource) => `${resource}:write`);
}

async function main() {
  console.log('🌱 Seeding BidStack 360°…');

  const org = await prisma.org.upsert({
    where: { clerkOrg: SEED_ORG_CLERK },
    create: { clerkOrg: SEED_ORG_CLERK, name: SEED_ORG_NAME },
    update: { name: SEED_ORG_NAME },
  });
  console.log(`  ✓ org:   ${org.name} (${org.id})`);

  // Users
  const usersByInitials = new Map<string, string>();
  for (const u of fixtureUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        orgId: org.id,
        clerkUser: `seed_${u.initials.toLowerCase()}`,
        email: u.email,
        name: u.name,
        role: u.role,
      },
      update: { name: u.name, role: u.role },
    });
    usersByInitials.set(u.initials, user.id);
  }
  console.log(`  ✓ users: ${fixtureUsers.length}`);

  await seedRolesAndPermissions(org.id, usersByInitials);

  // Opportunities
  for (const o of fixtureOpps) {
    const ownerId = usersByInitials.get(o.ownerInitials) ?? null;
    await prisma.opportunity.upsert({
      where: { orgId_code: { orgId: org.id, code: o.code } },
      create: {
        orgId: org.id,
        code: o.code,
        customer: o.customer,
        name: o.name,
        stage: o.stage,
        valueMicros: Math.round(o.value * 1_000_000),
        probability: o.probability,
        dueDate: o.dueDate ? new Date(o.dueDate) : null,
        ownerId,
        industry: o.industry,
        logoUrl: o.logoUrl,
        country: o.country,
        intel: intelFor(o.code) as Prisma.InputJsonValue,
      },
      update: {
        stage: o.stage,
        valueMicros: Math.round(o.value * 1_000_000),
        probability: o.probability,
        dueDate: o.dueDate ? new Date(o.dueDate) : null,
        ownerId,
        country: o.country,
        intel: intelFor(o.code) as Prisma.InputJsonValue,
      },
    });
  }
  console.log(`  ✓ opps:  ${fixtureOpps.length}`);

  for (const company of fixtureCompanyEnrichments) {
    await prisma.companyEnrichment.upsert({
      where: {
        orgId_normalizedName: {
          orgId: org.id,
          normalizedName: company.normalizedName,
        },
      },
      create: {
        orgId: org.id,
        normalizedName: company.normalizedName,
        legalName: company.legalName,
        tradeName: company.tradeName,
        domain: company.domain,
        website: company.website,
        logoUrl: company.logoUrl,
        logoSource: company.logoSource,
        registryIds: {},
        formerNames: [],
        industryCodes: [],
        status: company.status,
        employeeCount: company.employeeCount,
        annualRevenueMicros: company.annualRevenueMicros,
        confidenceBps: company.confidenceBps,
        sourceAttribution: company.sourceAttribution as Prisma.InputJsonValue,
        providerMetadata: company.providerMetadata as Prisma.InputJsonValue,
        cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {
        legalName: company.legalName,
        tradeName: company.tradeName,
        domain: company.domain,
        website: company.website,
        logoUrl: company.logoUrl,
        logoSource: company.logoSource,
        status: company.status,
        employeeCount: company.employeeCount,
        annualRevenueMicros: company.annualRevenueMicros,
        confidenceBps: company.confidenceBps,
        sourceAttribution: company.sourceAttribution as Prisma.InputJsonValue,
        providerMetadata: company.providerMetadata as Prisma.InputJsonValue,
        cacheExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }
  console.log(`  ✓ company enrichments: ${fixtureCompanyEnrichments.length}`);

  // Contacts
  for (const c of fixtureContacts) {
    await prisma.contact.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        orgId: org.id,
        customer: c.customer,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
        influence: c.influence,
        sentiment: c.sentiment,
      },
      update: {
        role: c.role,
        email: c.email,
        phone: c.phone,
        influence: c.influence,
        sentiment: c.sentiment,
      },
    });
  }
  console.log(`  ✓ contacts: ${fixtureContacts.length}`);

  // Leads
  for (const l of fixtureLeads) {
    const ownerId = usersByInitials.get(l.ownerInitials) ?? null;
    await prisma.lead.upsert({
      where: { id: l.id },
      create: {
        id: l.id,
        orgId: org.id,
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        companyName: l.companyName,
        title: l.title,
        source: l.source,
        status: l.status,
        score: l.score,
        priority: l.priority,
        ownerId,
      },
      update: {
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        companyName: l.companyName,
        title: l.title,
        source: l.source,
        status: l.status,
        score: l.score,
        priority: l.priority,
        ownerId,
      },
    });
  }
  console.log(`  ✓ leads: ${fixtureLeads.length}`);

  // Tasks (linked to opportunities by code)
  const oppByCode = new Map(
    (
      await prisma.opportunity.findMany({
        where: { orgId: org.id },
        select: { id: true, code: true },
      })
    ).map((o) => [o.code, o.id]),
  );

  for (const t of fixtureTasks) {
    const oppId = oppByCode.get(t.oppCode) ?? null;
    const assigneeId = usersByInitials.get(t.assigneeInitials) ?? null;
    await prisma.task.upsert({
      where: { id: t.id },
      create: {
        id: t.id,
        orgId: org.id,
        oppId,
        title: t.title,
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        status: t.status,
        assigneeId,
      },
      update: {
        title: t.title,
        status: t.status,
        dueDate: t.dueDate ? new Date(t.dueDate) : null,
        assigneeId,
      },
    });
  }
  console.log(`  ✓ tasks: ${fixtureTasks.length}`);

  // ─── Sales module — categories, products, orders ──────────────────────
  const categoryIds = new Map<string, string>();
  for (const name of fixtureProductCategories) {
    const cat = await prisma.productCategory.upsert({
      where: { orgId_name: { orgId: org.id, name } },
      create: { orgId: org.id, name },
      update: {},
    });
    categoryIds.set(name, cat.id);
  }
  console.log(`  ✓ product categories: ${fixtureProductCategories.length}`);

  const productIdBySku = new Map<string, string>();
  for (const p of fixtureProducts) {
    const product = await prisma.product.upsert({
      where: { orgId_sku: { orgId: org.id, sku: p.sku } },
      create: {
        orgId: org.id,
        sku: p.sku,
        name: p.name,
        categoryId: categoryIds.get(p.category) ?? null,
        listPriceMicros: BigInt(Math.round(p.listPrice * 1_000_000)),
        currency: p.currency,
      },
      update: {
        name: p.name,
        categoryId: categoryIds.get(p.category) ?? null,
        listPriceMicros: BigInt(Math.round(p.listPrice * 1_000_000)),
        currency: p.currency,
      },
    });
    productIdBySku.set(p.sku, product.id);
  }
  console.log(`  ✓ products: ${fixtureProducts.length}`);

  // Quick lookups for orders
  const userByEmail = new Map<string, string>();
  for (const u of fixtureUsers) {
    const userRow = await prisma.user.findUnique({ where: { email: u.email } });
    if (userRow) userByEmail.set(u.email, userRow.id);
  }
  const customerByName = new Map(fixtureSalesCustomers.map((c) => [c.name, c]));

  for (const so of fixtureSalesOrders) {
    const customer = customerByName.get(so.customerName);
    if (!customer) continue;
    const orderDate = new Date(Date.now() - so.daysAgo * 24 * 60 * 60 * 1000);
    const lines = so.lines
      .filter((l) => productIdBySku.has(l.sku))
      .map((l) => {
        const unitMicros = BigInt(Math.round(l.unitPrice * 1_000_000));
        const subtotal = unitMicros * BigInt(l.qty);
        return {
          orgId: org.id,
          productId: productIdBySku.get(l.sku)!,
          description: fixtureProducts.find((p) => p.sku === l.sku)?.name ?? l.sku,
          quantity: l.qty,
          unitPriceMicros: unitMicros,
          subtotalMicros: subtotal,
        };
      });
    const total = lines.reduce((acc, l) => acc + l.subtotalMicros, BigInt(0));

    await prisma.salesOrder.upsert({
      where: { orgId_number: { orgId: org.id, number: so.number } },
      create: {
        orgId: org.id,
        number: so.number,
        state: so.state,
        customerName: so.customerName,
        salespersonId: userByEmail.get(customer.salespersonEmail) ?? null,
        countryCode: customer.countryCode,
        currency: customer.currency,
        totalMicros: total,
        orderDate,
        confirmedAt: so.state === 'confirmed' || so.state === 'done' ? orderDate : null,
        lines: { create: lines },
      },
      update: {
        state: so.state,
        salespersonId: userByEmail.get(customer.salespersonEmail) ?? null,
        countryCode: customer.countryCode,
        currency: customer.currency,
        totalMicros: total,
        orderDate,
        confirmedAt: so.state === 'confirmed' || so.state === 'done' ? orderDate : null,
        // Replace lines deterministically on re-run so quantities stay aligned with the fixture.
        lines: { deleteMany: {}, create: lines },
      },
    });
  }
  console.log(`  ✓ sales orders: ${fixtureSalesOrders.length}`);

  console.log('✅ Seed complete.');
}

async function seedRolesAndPermissions(orgId: string, usersByInitials: Map<string, string>) {
  const permissionIds = new Map<string, string>();
  for (const p of PERMISSION_SEEDS) {
    const row = await prisma.permission.upsert({
      where: { key: p.key },
      create: {
        key: p.key,
        name: p.name,
        description: p.description,
      },
      update: {
        name: p.name,
        description: p.description,
      },
    });
    permissionIds.set(row.key, row.id);
  }

  const roleIds = new Map<string, string>();
  for (const r of ROLE_SEEDS) {
    const row = await prisma.role.upsert({
      where: { orgId_name: { orgId, name: r.name } },
      create: {
        orgId,
        name: r.name,
        description: r.description,
        isSystem: true,
      },
      update: {
        description: r.description,
        isSystem: true,
        deletedAt: null,
      },
    });
    roleIds.set(r.name, row.id);

    const unknownKeys = r.permissionKeys.filter((key) => !permissionIds.has(key));
    if (unknownKeys.length > 0) {
      throw new Error(`Role ${r.name} references unknown permissions: ${unknownKeys.join(', ')}`);
    }

    await prisma.rolePermission.deleteMany({ where: { roleId: row.id } });
    await prisma.rolePermission.createMany({
      data: r.permissionKeys.map((key) => ({
        orgId,
        roleId: row.id,
        permissionId: permissionIds.get(key)!,
      })),
      skipDuplicates: true,
    });
  }

  const seededSystemRoleIds = Array.from(roleIds.values());
  for (const user of fixtureUsers) {
    const userId = usersByInitials.get(user.initials);
    if (!userId) continue;

    const assignedRoleNames = LEGACY_ROLE_ASSIGNMENTS[user.role] ?? ['Read-only'];
    await prisma.userRole.deleteMany({
      where: {
        userId,
        roleId: { in: seededSystemRoleIds },
      },
    });
    await prisma.userRole.createMany({
      data: assignedRoleNames.map((name) => ({
        orgId,
        userId,
        roleId: roleIds.get(name)!,
      })),
      skipDuplicates: true,
    });
  }

  console.log(`  ✓ permissions: ${PERMISSION_SEEDS.length}`);
  console.log(`  ✓ roles: ${ROLE_SEEDS.length}`);
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
