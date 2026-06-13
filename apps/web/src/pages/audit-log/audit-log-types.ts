/**
 * audit-log/audit-log-types.ts — shared types and constants for the AuditLog feature.
 *
 * WHY a separate module: every component + helper in this feature depends on
 * these types and constants. Extracting them to a leaf node keeps the import
 * DAG acyclic and avoids re-declaring the same union types in 5 files.
 */
import type { AuditLogEntry } from '@bidstack/shared';

import type { BadgeTone } from '@/components/ui/Badge';

// ─── Filter types ─────────────────────────────────────────────────────────────

export type DateRange = '24h' | '7d' | '30d' | 'all';

export type TargetTypeFilter =
  | 'all'
  | 'opportunity'
  | 'company'
  | 'contact'
  | 'lead'
  | 'task'
  | 'api_key'
  | 'agent'
  | 'webhook'
  | 'file';

export type QuickFilter = 'all' | 'security' | 'destructive' | 'crm' | 'system';

// ─── Option / shape types ─────────────────────────────────────────────────────

export interface DateRangeOption {
  value: DateRange;
  label: string;
}

export interface TargetTypeOption {
  value: TargetTypeFilter;
  label: string;
}

export interface QuickFilterOption {
  value: QuickFilter;
  label: string;
  description: string;
}

export interface AuditClassification {
  category: QuickFilter;
  label: string;
  tone: BadgeTone;
  railClass: string;
}

export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

// ─── Option lists ─────────────────────────────────────────────────────────────

export const DATE_RANGES: DateRangeOption[] = [
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
];

export const TARGET_TYPES: TargetTypeOption[] = [
  { value: 'all', label: 'All records' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'company', label: 'Companies' },
  { value: 'contact', label: 'Contacts' },
  { value: 'lead', label: 'Leads' },
  { value: 'task', label: 'Tasks' },
  { value: 'api_key', label: 'API keys' },
  { value: 'agent', label: 'Agents' },
  { value: 'webhook', label: 'Webhooks' },
  { value: 'file', label: 'Files' },
];

export const QUICK_FILTERS: QuickFilterOption[] = [
  { value: 'all', label: 'All', description: 'Every event in the selected range' },
  {
    value: 'security',
    label: 'Security',
    description: 'Keys, permissions, auth, MCP and webhooks',
  },
  {
    value: 'destructive',
    label: 'Destructive',
    description: 'Deletes, revokes, cancellations and removals',
  },
  {
    value: 'crm',
    label: 'CRM changes',
    description: 'Account, contact, lead and opportunity updates',
  },
  { value: 'system', label: 'System', description: 'Worker, import, sync and automation events' },
];

// ─── Classification term sets ─────────────────────────────────────────────────

export const CRM_TARGETS = new Set([
  'account',
  'bid_score',
  'company',
  'contact',
  'lead',
  'opportunity',
  'pipeline',
  // 'quote'/'invoice': modules removed; terms retained so HISTORICAL audit
  // rows still classify as CRM changes.
  'quote',
  'invoice',
  'task',
  'territory',
  'service_desk',
]);

export const SECURITY_TERMS = [
  'api_key',
  'apikey',
  'mcp',
  'webhook',
  'permission',
  'role',
  'auth',
  'login',
  'token',
  'secret',
  'agent',
  'integration',
];

export const DESTRUCTIVE_TERMS = [
  'delete',
  'remove',
  'revoke',
  'cancel',
  'disable',
  'void',
  'archive',
];
export const SYSTEM_TERMS = [
  'worker',
  'sync',
  'import',
  'export',
  'job',
  'queue',
  'automation',
  'system',
];

// ─── Query constants ──────────────────────────────────────────────────────────

export const EVENT_LIMIT = 200;
// Stable empty-array reference prevents useMemo churn in the page component
export const EMPTY_AUDIT_ROWS: AuditLogEntry[] = [];
