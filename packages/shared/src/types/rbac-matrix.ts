// Canonical RBAC matrix — defines the 6 spec-required system roles and their
// permission sets. This is the single source of truth used by:
//   1. packages/db/src/seed.ts (seeds the DB at boot)
//   2. apps/api/src/services/rbac.service.ts (runtime checks)
//   3. apps/web/src/pages/RolesPage.tsx (visual matrix)
//
// NOTE: Changes here require a re-seed (`pnpm db:seed`) to take effect in the
// running application. The DB is the authoritative runtime store; this file
// documents the intended baseline.

import type { PermissionKey } from './permissions.js';

/**
 * Commercial approval is a separate authority from administrator and from
 * proposals:write. It is intentionally absent from every role in RBAC_MATRIX,
 * including Admin. The seeded Manager role is the grant (see seed.rbac.ts).
 */
export const PROPOSAL_APPROVE_PERMISSION = 'proposals:approve' satisfies PermissionKey;

export const SYSTEM_ROLE_NAMES = [
  'Admin',
  'Sales Manager',
  'Account Executive',
  'SDR',
  'Customer Success',
  'Read-Only',
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

/** All read permissions (resources ending in :read) */
const ALL_READ: PermissionKey[] = [
  'accounts:read',
  'activities:read',
  'agents:read',
  'audit-log:read',
  'bid-scores:read',
  'comments:read',
  'companies:read',
  'contacts:read',
  'documents:read',
  'files:read',
  'integrations:read',
  'invoices:read',
  'kam:read',
  'leads:read',
  'mcp:read',
  'meetings:read',
  'migrations:read',
  'msa:read',
  'opportunities:read',
  'orgchart:read',
  'products:read',
  'proposals:read',
  'reports:read',
  'sales-orders:read',
  'service-desk:read',
  'settings:read',
  'tasks:read',
  'territories:read',
  'users:read',
  'webhooks:read',
  'workflows:read',
];

const ALL_WRITE: PermissionKey[] = [
  'accounts:write',
  'activities:write',
  'agents:write',
  'comments:write',
  'companies:write',
  'contacts:write',
  'documents:write',
  'files:write',
  'integrations:write',
  'invoices:write',
  'kam:write',
  'leads:write',
  'mcp:write',
  'meetings:write',
  'msa:write',
  'opportunities:write',
  'orgchart:write',
  'products:write',
  'proposals:write',
  'reports:write',
  'sales-orders:write',
  'service-desk:write',
  'settings:write',
  'tasks:write',
  'territories:write',
  'users:write',
  'webhooks:write',
  'workflows:write',
];

function read(...res: string[]): PermissionKey[] {
  return res.map((r) => `${r}:read` as PermissionKey);
}

function write(...res: string[]): PermissionKey[] {
  return res.map((r) => `${r}:write` as PermissionKey);
}

/**
 * The RBAC permission matrix for the 6 canonical spec roles.
 * Each entry lists the permissions granted to that role.
 */
export const RBAC_MATRIX: Record<SystemRoleName, ReadonlyArray<PermissionKey>> = {
  // msa:admin (archive MSAs and file versions, edit any MSA) is Admin-only.
  Admin: [...ALL_READ, ...ALL_WRITE, 'msa:admin'],

  'Sales Manager': [
    ...ALL_READ,
    ...write(
      'accounts',
      'activities',
      'comments',
      'contacts',
      'kam',
      'meetings',
      'leads',
      'msa',
      'opportunities',
      'reports',
      'sales-orders',
      'tasks',
      'territories',
      'workflows',
    ),
  ],

  'Account Executive': [
    ...read(
      'accounts',
      'activities',
      'comments',
      'companies',
      'contacts',
      'documents',
      'leads',
      'migrations',
      'meetings',
      'msa',
      'opportunities',
      'orgchart',
      'products',
      'proposals',
      'reports',
      'sales-orders',
      'tasks',
      'territories',
    ),
    ...write(
      'accounts',
      'activities',
      'comments',
      'contacts',
      'kam',
      'meetings',
      'leads',
      'msa',
      'opportunities',
      'proposals',
      'sales-orders',
      'tasks',
    ),
  ],

  SDR: [
    ...read(
      'accounts',
      'activities',
      'comments',
      'companies',
      'contacts',
      'leads',
      'msa',
      'opportunities',
      'orgchart',
      'proposals',
      'reports',
      'tasks',
    ),
    ...write('activities', 'comments', 'contacts', 'leads', 'tasks'),
  ],

  'Customer Success': [
    ...read(
      'accounts',
      'activities',
      'comments',
      'companies',
      'contacts',
      'leads',
      'msa',
      'opportunities',
      'orgchart',
      'reports',
      'service-desk',
      'tasks',
    ),
    ...write(
      'accounts',
      'activities',
      'comments',
      'contacts',
      'kam',
      'meetings',
      'msa',
      'service-desk',
      'tasks',
    ),
  ],

  'Read-Only': ALL_READ.filter((k) => !k.startsWith('mcp:') && k !== 'audit-log:read'),
};

/** Resources that appear in the permission matrix (for matrix display) */
export const MATRIX_RESOURCES = [
  'accounts',
  'activities',
  'agents',
  'audit-log',
  'bid-scores',
  'comments',
  'companies',
  'contacts',
  'documents',
  'files',
  'integrations',
  'invoices',
  'kam',
  'leads',
  'mcp',
  'meetings',
  'msa',
  'opportunities',
  'orgchart',
  'products',
  'proposals',
  'reports',
  'sales-orders',
  'service-desk',
  'settings',
  'tasks',
  'territories',
  'users',
  'webhooks',
  'workflows',
] as const;

export type MatrixResource = (typeof MATRIX_RESOURCES)[number];
