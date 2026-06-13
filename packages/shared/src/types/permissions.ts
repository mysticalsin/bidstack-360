// Canonical permission keys for the BidStack RBAC system. Mirrors the
// PERMISSION_SEEDS list in packages/db/src/seed.ts — keep both in sync.

export const PERMISSION_KEYS = [
  'accounts:read',
  'accounts:write',
  'activities:read',
  'activities:write',
  'agents:read',
  'agents:write',
  'audit-log:read',
  'bid-scores:read',
  'bid-scores:write',
  'companies:read',
  'companies:write',
  'contacts:read',
  'contacts:write',
  'documents:read',
  'documents:write',
  'files:read',
  'files:write',
  'integrations:read',
  'integrations:write',
  'invoices:read',
  'invoices:write',
  'leads:read',
  'leads:write',
  'mcp:read',
  'mcp:write',
  'opportunities:read',
  'opportunities:write',
  'products:read',
  'products:write',
  'proposals:read',
  'proposals:write',
  'reports:read',
  'reports:write',
  'sales-orders:read',
  'sales-orders:write',
  'service-desk:read',
  'service-desk:write',
  'settings:read',
  'settings:write',
  'tags:read',
  'tags:write',
  'tasks:read',
  'tasks:write',
  'territories:read',
  'territories:write',
  'users:read',
  'users:write',
  'webhooks:read',
  'webhooks:write',
  'workflows:read',
  'workflows:write',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

const permissionKeySet = new Set<string>(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionKeySet.has(value);
}
