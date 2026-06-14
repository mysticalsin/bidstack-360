/**
 * seed.rbac.ts — RBAC seed data: permissions, roles, legacy user-role
 * assignments, and the seedRolesAndPermissions() orchestrator.
 *
 * Extracted from seed.ts (BS-R1 file-size refactor).
 * Imported only by seed.ts.
 */
import type { PrismaClient } from '../generated/client/index.js';

import { fixtureUsers } from './seed-data.js';

// ─── Builder helpers (hoisted in seed.ts; explicit order here) ───────────────

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

// ─── Permission catalogue ─────────────────────────────────────────────────────

const PERMISSION_SEEDS = [
  permission('accounts:read', 'Read accounts', 'View account records and account cockpit data.'),
  permission('accounts:write', 'Manage accounts', 'Create and update account records.'),
  permission('activities:read', 'Read activities', 'View CRM activity timelines.'),
  permission('activities:write', 'Manage activities', 'Create and update CRM activities.'),
  permission('audit-log:read', 'Read audit log', 'View security, admin, and data audit history.'),
  permission('bid-scores:read', 'Read bid scores', 'View bid/no-bid scoring and rationale.'),
  permission('bid-scores:write', 'Manage bid scores', 'Create and update bid/no-bid scoring.'),
  permission('companies:read', 'Read companies', 'View company records.'),
  permission('companies:write', 'Manage companies', 'Create and update company records.'),
  permission('contacts:read', 'Read contacts', 'View contact records.'),
  permission('contacts:write', 'Manage contacts', 'Create and update contact records.'),
  permission('customFields:read', 'Read custom fields', 'View custom field definitions and values.'),
  permission(
    'customFields:write',
    'Manage custom fields',
    'Define custom fields and set their values on records.',
  ),
  permission('customObjects:read', 'Read custom objects', 'View custom object definitions and records.'),
  permission(
    'customObjects:write',
    'Manage custom objects',
    'Define custom objects, fields, relations, and manage their records.',
  ),
  permission('documents:read', 'Read documents', 'View bid and account documents.'),
  permission('documents:write', 'Manage documents', 'Upload and update bid and account documents.'),
  permission('files:read', 'Read files', 'View uploaded files and attachments.'),
  permission('files:write', 'Manage files', 'Upload, finalize, and manage file attachments.'),
  permission('integrations:read', 'Read integrations', 'View integration configuration.'),
  permission('integrations:write', 'Manage integrations', 'Configure external integrations.'),
  permission('leads:read', 'Read leads', 'View lead records.'),
  permission('leads:write', 'Manage leads', 'Create and update lead records.'),
  permission('mcp:read', 'Use MCP read tools', 'Call read-only MCP tools.'),
  permission('mcp:write', 'Use MCP write tools', 'Call MCP tools that mutate data.'),
  permission('opportunities:read', 'Read opportunities', 'View opportunities and pipeline data.'),
  permission('opportunities:write', 'Manage opportunities', 'Create and update opportunities.'),
  permission('proposals:read', 'Read proposals', 'View proposal workspace data.'),
  permission('proposals:write', 'Manage proposals', 'Create and update proposals.'),
  permission('reports:read', 'Read reports', 'View reports and analytics.'),
  permission('reports:write', 'Manage reports', 'Create and update report definitions.'),
  permission('service-desk:read', 'Read service desk', 'View service cases.'),
  permission('service-desk:write', 'Manage service desk', 'Create and update service cases.'),
  permission('settings:read', 'Read settings', 'View organization settings and roles.'),
  permission(
    'settings:write',
    'Manage settings',
    'Update organization settings, roles, and permissions.',
  ),
  permission('tags:read', 'Read tags', 'View tags and tag assignments.'),
  permission('tags:write', 'Manage tags', 'Create, update, delete, and apply tags.'),
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

// ─── Role definitions ─────────────────────────────────────────────────────────

const ROLE_SEEDS = [
  role('Admin', 'Full tenant administrator with all permissions.', ALL_PERMISSION_KEYS),
  role('Sales', 'Owns leads, accounts, contacts, opportunities, and sales activity.', [
    ...readKeys(
      'accounts',
      'activities',
      'companies',
      'contacts',
      'leads',
      'opportunities',
      'proposals',
      'reports',
      'tags',
      'tasks',
    ),
    ...writeKeys('accounts', 'activities', 'contacts', 'leads', 'opportunities', 'tags', 'tasks'),
  ]),
  role(
    'Presales',
    'Owns bid qualification, proposal work, documents, and compliance preparation.',
    [
      ...readKeys(
        'accounts',
        'activities',
        'bid-scores',
        'companies',
        'contacts',
        'documents',
        'files',
        'opportunities',
        'proposals',
        'reports',
        'tags',
        'tasks',
      ),
      ...writeKeys('activities', 'bid-scores', 'documents', 'files', 'proposals', 'tags', 'tasks'),
    ],
  ),
  // Quote-to-cash modules were removed with the sales/invoicing vertical;
  // Finance keeps read access to commercial records and reporting.
  role('Finance', 'Reads commercial records and reporting.', [
    ...readKeys('accounts', 'companies', 'contacts', 'reports', 'tags'),
  ]),
  role('Manager', 'Manages commercial execution, team performance, and approvals.', [
    ...READ_PERMISSION_KEYS,
    ...writeKeys(
      'activities',
      'bid-scores',
      'leads',
      'opportunities',
      'reports',
      'tags',
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
      'tags',
      'tasks',
    ),
    ...writeKeys('activities', 'service-desk', 'tags', 'tasks'),
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
        'tags',
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
        'proposals',
        'reports',
        'tags',
        'tasks',
      ),
      ...writeKeys(
        'accounts',
        'activities',
        'contacts',
        'leads',
        'opportunities',
        'proposals',
        'tags',
        'tasks',
      ),
    ],
  ),
  role('SDR', 'Inbound/outbound lead development; limited to leads and early-stage pipeline.', [
    ...readKeys('accounts', 'activities', 'companies', 'contacts', 'leads', 'tags', 'tasks'),
    ...writeKeys('activities', 'contacts', 'leads', 'tags', 'tasks'),
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
        'tags',
        'tasks',
      ),
      ...writeKeys('accounts', 'activities', 'contacts', 'service-desk', 'tags', 'tasks'),
    ],
  ),
  role(
    'Read-Only',
    'Read-only access to all non-MCP, non-audit resources.',
    READ_PERMISSION_KEYS.filter((key) => !key.startsWith('mcp:') && key !== 'audit-log:read'),
  ),
] as const;

// ─── Legacy role→UserRole mapping ─────────────────────────────────────────────

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

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Upsert all system permissions and roles for `orgId`, then assign each
 * fixture user the roles derived from their legacy `user.role` string.
 *
 * `prisma` is passed explicitly rather than imported at module level so the
 * caller (seed.ts) controls the client lifecycle.
 */
export async function seedRolesAndPermissions(
  prisma: PrismaClient,
  orgId: string,
  usersByInitials: Map<string, string>,
): Promise<void> {
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
