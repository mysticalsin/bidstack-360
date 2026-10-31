import { enrichmentProjectAnchor } from '@bidstack/shared';

import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

import type { CompanyEnrichment, CountRow, OpenRole } from './types';

export type Dimension = 'function' | 'seniority' | 'region';
export const DIMENSIONS: Array<{ id: Dimension; label: string }> = [
  { id: 'function', label: 'Function' },
  { id: 'seniority', label: 'Seniority' },
  { id: 'region', label: 'Region' },
];
// Sample labels (Entry, Director+) and API labels (Intern … C-level) in one ladder.
const SENIORITY_ORDER = ['Intern', 'Entry', 'Junior', 'Mid', 'Senior', 'Lead', 'Principal', 'Manager', 'Director', 'Director+', 'VP', 'C-level'];

/** Open roles counted by one dimension. Seniority keeps its natural order; the rest sort by count. */
export function breakdown(roles: OpenRole[], dim: Dimension): Array<{ label: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of roles) m.set(r[dim], (m.get(r[dim]) ?? 0) + 1);
  const rows = [...m].map(([label, count]) => ({ label, count }));
  if (dim === 'seniority') return rows.sort((a, b) => SENIORITY_ORDER.indexOf(a.label) - SENIORITY_ORDER.indexOf(b.label));
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Counts by one dimension: the server's buckets (over all postings) when present, else counted from the loaded roles. */
export function hiringRows(h: CompanyEnrichment['hiring'], dim: Dimension): CountRow[] {
  return h.buckets?.[dim]?.length ? h.buckets[dim] : breakdown(h.roles, dim);
}

/** Postings opened in the last `days` days, relative to `asOf`. Undated postings don't count. */
export function recentCount(roles: OpenRole[], asOf: string, days = 30): number {
  const end = new Date(asOf).getTime();
  return roles.filter((r) => r.postedAt && end - new Date(r.postedAt).getTime() <= days * 86_400_000).length;
}

/** Headcount change across the trend window, as a signed percentage (null when not computable). */
export function trendPct(trend: Array<{ value: number }>): number | null {
  if (trend.length < 2 || !trend[0]!.value) return null;
  return Math.round(((trend.at(-1)!.value - trend[0]!.value) / trend[0]!.value) * 1000) / 10;
}

export const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

export const projectAnchor = enrichmentProjectAnchor;

/**
 * Sample data only: inferred projects as (non-dismissible) opportunity signals
 * in the account watchdog, so the feed shows what enrichment will add. Real
 * projects arrive from the server as ordinary watch events (source
 * 'enrichment'), which can be dismissed. Medium and high confidence only.
 * The "Sample:" title prefix makes the watchdog show its badge.
 */
export function mergeEnrichmentSignals(data: AccountWatchdog, enr: CompanyEnrichment | undefined): AccountWatchdog {
  if (!enr || !enr.sample || enr.companyId !== data.companyId) return data;
  const have = new Set(data.events.map((e) => e.id));
  const extra: AccountWatchdog['events'] = enr.projects
    .filter((p) => p.confidence !== 'low' && !have.has(`enr:${p.id}`) && !data.events.some((e) => e.source === 'enrichment'))
    .map((p) => ({
      id: `enr:${p.id}`,
      source: 'enrichment',
      kind: 'INFERRED_PROJECT',
      title: `Sample: Potential project: ${p.title}`,
      summary: `${p.summary} ${CONFIDENCE_LABEL[p.confidence]}${p.score != null ? ` (${Math.round(p.score * 100)}%)` : ''}, from ${p.postingCount} job posting${p.postingCount === 1 ? '' : 's'}.`,
      sourceUrl: `/accounts/${encodeURIComponent(enr.companyId)}#${projectAnchor(p.id)}`,
      occurredAt: p.inferredAt,
      implication: 'OPPORTUNITY',
      implicationRationale: `Inferred from hiring (${p.source}). Check with the account team before acting.`,
      severity: p.confidence === 'high' ? 2 : 1,
      status: 'NEW',
    }));
  if (!extra.length) return data;
  return { ...data, events: [...data.events, ...extra].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)) };
}
