/**
 * audit-log/audit-log-helpers.ts — pure helper functions for the AuditLog feature.
 *
 * WHY a separate module: ~28 stateless functions live here so each UI module can
 * import exactly what it needs without pulling in component code. This is the only
 * file below the UI layer that imports @bidstack/shared at the page level.
 */
import type { AuditLogEntry } from '@bidstack/shared';

import type {
  AuditClassification,
  DateRange,
  QuickFilter,
  TargetTypeFilter,
} from './audit-log-types';
import {
  CRM_TARGETS,
  DATE_RANGES,
  DESTRUCTIVE_TERMS,
  QUICK_FILTERS,
  SECURITY_TERMS,
  SYSTEM_TERMS,
  TARGET_TYPES,
} from './audit-log-types';

// ─── Exported shape types ─────────────────────────────────────────────────────

export interface AuditStats {
  total: number;
  security: number;
  destructive: number;
  crm: number;
  system: number;
  all: number;
  latest: string | undefined;
}

export interface EvidenceHealth {
  total: number;
  withDiff: number;
  withTarget: number;
  withActor: number;
  diffPct: number;
  targetPct: number;
  actorPct: number;
  score: number;
}

export interface ActivityBucket {
  key: string;
  label: string;
  count: number;
  security: number;
  destructive: number;
}

// ─── URL parameter parsers ────────────────────────────────────────────────────

export function parseDateRange(value: string | null): DateRange {
  return DATE_RANGES.some((option) => option.value === value) ? (value as DateRange) : '7d';
}

export function parseTargetType(value: string | null): TargetTypeFilter {
  return TARGET_TYPES.some((option) => option.value === value)
    ? (value as TargetTypeFilter)
    : 'all';
}

export function parseQuickFilter(value: string | null): QuickFilter {
  return QUICK_FILTERS.some((option) => option.value === value) ? (value as QuickFilter) : 'all';
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function getSince(range: DateRange) {
  if (range === 'all') return undefined;
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function formatAbsolute(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

// ─── Activity chart helpers ───────────────────────────────────────────────────

export function buildActivityBuckets(rows: AuditLogEntry[]): ActivityBucket[] {
  const bucketCount = 12;
  if (rows.length === 0) {
    return Array.from({ length: bucketCount }, (_, index) => ({
      key: `empty-${index}`,
      label: '--',
      count: 0,
      security: 0,
      destructive: 0,
    }));
  }

  const times = rows.map((row) => new Date(row.createdAt).getTime()).filter(Number.isFinite);
  const latest = Math.max(...times);
  const earliest = Math.min(...times);
  const bucketMs = Math.max(
    Math.ceil((latest - earliest || 60 * 60 * 1000) / bucketCount),
    60 * 1000,
  );
  const start = latest - bucketMs * (bucketCount - 1);
  const buckets: ActivityBucket[] = Array.from({ length: bucketCount }, (_, index) => ({
    key: `${start + index * bucketMs}`,
    label: formatBucketLabel(start + index * bucketMs, bucketMs),
    count: 0,
    security: 0,
    destructive: 0,
  }));

  rows.forEach((row) => {
    const time = new Date(row.createdAt).getTime();
    if (!Number.isFinite(time)) return;
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor((time - start) / bucketMs)));
    const bucket = buckets[index];
    if (!bucket) return;
    const classification = classifyAudit(row);
    bucket.count += 1;
    if (classification.category === 'security') bucket.security += 1;
    if (classification.category === 'destructive') bucket.destructive += 1;
  });

  return buckets;
}

function formatBucketLabel(time: number, bucketMs: number) {
  const date = new Date(time);
  if (bucketMs <= 6 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

// ─── Stats / health builders ──────────────────────────────────────────────────

export function buildStats(rows: AuditLogEntry[]): AuditStats {
  return rows.reduce(
    (stats, row, index) => {
      const classification = classifyAudit(row);
      stats[classification.category] += 1;
      if (index === 0) stats.latest = row.createdAt;
      return stats;
    },
    {
      total: rows.length,
      security: 0,
      destructive: 0,
      crm: 0,
      system: 0,
      all: rows.length,
      latest: undefined as string | undefined,
    } satisfies AuditStats,
  );
}

export function buildEvidenceHealth(rows: AuditLogEntry[]): EvidenceHealth {
  const total = rows.length;
  const withDiff = rows.filter((row) => hasStructuredDiff(row.diff)).length;
  const withTarget = rows.filter((row) => Boolean(row.targetId)).length;
  const withActor = rows.filter((row) =>
    Boolean(row.userName || row.userEmail || row.userId),
  ).length;
  const diffPct = percent(withDiff, total);
  const targetPct = percent(withTarget, total);
  const actorPct = percent(withActor, total);
  const score = Math.round(diffPct * 0.4 + targetPct * 0.3 + actorPct * 0.3);
  return { total, withDiff, withTarget, withActor, diffPct, targetPct, actorPct, score };
}

function percent(part: number, total: number) {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

// ─── Classification / risk ────────────────────────────────────────────────────

export function classifyAudit(row: AuditLogEntry): AuditClassification {
  const haystack = `${row.action} ${row.targetType ?? ''}`.toLowerCase();

  if (DESTRUCTIVE_TERMS.some((term) => haystack.includes(term))) {
    return {
      category: 'destructive',
      label: 'High attention',
      tone: 'tomato',
      railClass: 'bg-[var(--tag-tomato-fg)]',
    };
  }
  if (SECURITY_TERMS.some((term) => haystack.includes(term))) {
    return {
      category: 'security',
      label: 'Security/API',
      tone: 'purple',
      railClass: 'bg-[var(--tag-purple-fg)]',
    };
  }
  if (CRM_TARGETS.has((row.targetType ?? '').toLowerCase())) {
    return {
      category: 'crm',
      label: 'CRM change',
      tone: 'teal',
      railClass: 'bg-[var(--tag-teal-fg)]',
    };
  }
  if (SYSTEM_TERMS.some((term) => haystack.includes(term)) || (!row.userId && !row.userEmail)) {
    return {
      category: 'system',
      label: 'System',
      tone: 'gray',
      railClass: 'bg-[var(--tag-gray-fg)]',
    };
  }
  return { category: 'crm', label: 'Activity', tone: 'blue', railClass: 'bg-[var(--tag-blue-fg)]' };
}

export function riskScore(row: AuditLogEntry) {
  const category = classifyAudit(row).category;
  const categoryScore =
    category === 'destructive'
      ? 82
      : category === 'security'
        ? 68
        : category === 'system'
          ? 42
          : 28;
  const missingEvidencePenalty =
    (hasStructuredDiff(row.diff) ? 0 : 8) +
    (row.targetId ? 0 : 6) +
    (row.userEmail || row.userName || row.userId ? 0 : 4);
  return Math.min(99, categoryScore + missingEvidencePenalty);
}

export function hasStructuredDiff(diff: unknown) {
  return Boolean(
    diff &&
    typeof diff === 'object' &&
    !Array.isArray(diff) &&
    Object.keys(diff as Record<string, unknown>).length > 0,
  );
}

// ─── Row filter predicates ────────────────────────────────────────────────────

export function rowMatchesQuickFilter(row: AuditLogEntry, quickFilter: QuickFilter) {
  if (quickFilter === 'all') return true;
  return classifyAudit(row).category === quickFilter;
}

export function rowMatchesSearch(row: AuditLogEntry, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const values = [
    row.action,
    row.targetType,
    row.targetId,
    row.userName,
    row.userEmail,
    row.userId,
    safeStringify(row.diff),
  ];
  return values.some((value) => value?.toLowerCase().includes(query));
}

// ─── Routing helper ───────────────────────────────────────────────────────────

export function recordHref(row: AuditLogEntry) {
  if (!row.targetId || !row.targetType) return undefined;
  const id = encodeURIComponent(row.targetId);
  switch (row.targetType.toLowerCase()) {
    case 'account':
      return `/accounts/${id}`;
    case 'company':
      return `/companies/${id}`;
    case 'opportunity':
      return `/opportunities/${id}`;
    case 'contact':
      return `/contacts/${id}`;
    case 'lead':
      return `/leads/${id}`;
    case 'task':
      return `/tasks/${id}`;
    case 'invoice':
      return `/sales/invoices/${id}`;
    case 'service_desk':
    case 'ticket':
      return `/service-desk/${id}`;
    default:
      return undefined;
  }
}

// ─── Display formatters ───────────────────────────────────────────────────────

export function formatAction(action: string) {
  return action
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function actorLabel(row: AuditLogEntry) {
  return row.userName || row.userEmail || row.userId || 'System';
}

export function actorInitials(row: AuditLogEntry) {
  const label = actorLabel(row);
  const parts = label
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return 'SY';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function truncateId(value: string) {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function humanizeKey(key: string) {
  return key.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return 'object';
}

export function summarizeDiff(diff: unknown): string[] {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return [];
  return Object.entries(diff as Record<string, unknown>)
    .slice(0, 8)
    .map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as Record<string, unknown>;
        if ('from' in nested || 'to' in nested) {
          return `${humanizeKey(key)}: ${formatValue(nested.from)} to ${formatValue(nested.to)}`;
        }
        return `${humanizeKey(key)} updated`;
      }
      return `${humanizeKey(key)}: ${formatValue(value)}`;
    });
}

export function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))[0];
}

// ─── Clipboard / CSV export ───────────────────────────────────────────────────

export function writeClipboard(value: string) {
  if (!value) return;
  void navigator.clipboard?.writeText(value);
}

export function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '';
  }
}

export function exportCsv(rows: AuditLogEntry[]) {
  if (rows.length === 0) return;
  const header = [
    'createdAt',
    'actor',
    'email',
    'action',
    'category',
    'riskScore',
    'targetType',
    'targetId',
    'diff',
  ];
  const csv = [
    header.join(','),
    ...rows.map((row) =>
      [
        row.createdAt,
        actorLabel(row),
        row.userEmail ?? '',
        row.action,
        classifyAudit(row).category,
        riskScore(row),
        row.targetType ?? '',
        row.targetId ?? '',
        safeStringify(row.diff),
      ]
        .map(escapeCsv)
        .join(','),
    ),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `bidstack-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  const safeText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}
