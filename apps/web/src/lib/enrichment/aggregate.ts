import type { AccountWatchdog } from '@/hooks/useAccountWatchdog';

import type { CompanyEnrichment, OpenRole, PotentialProject } from './types';

export type Dimension = 'function' | 'seniority' | 'region';
export const DIMENSIONS: Array<{ id: Dimension; label: string }> = [
  { id: 'function', label: 'Function' },
  { id: 'seniority', label: 'Seniority' },
  { id: 'region', label: 'Region' },
];
const SENIORITY_ORDER = ['Entry', 'Mid', 'Senior', 'Lead', 'Director+'];

/** Open roles counted by one dimension. Seniority keeps its natural order; the rest sort by count. */
export function breakdown(roles: OpenRole[], dim: Dimension): Array<{ label: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of roles) m.set(r[dim], (m.get(r[dim]) ?? 0) + 1);
  const rows = [...m].map(([label, count]) => ({ label, count }));
  if (dim === 'seniority') return rows.sort((a, b) => SENIORITY_ORDER.indexOf(a.label) - SENIORITY_ORDER.indexOf(b.label));
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Postings opened in the last `days` days, relative to `asOf`. */
export function recentCount(roles: OpenRole[], asOf: string, days = 30): number {
  const end = new Date(asOf).getTime();
  return roles.filter((r) => end - new Date(r.postedAt).getTime() <= days * 86_400_000).length;
}

export function evidenceFor(p: PotentialProject, roles: OpenRole[]): OpenRole[] {
  const byId = new Map(roles.map((r) => [r.id, r]));
  return p.evidence.map((id) => byId.get(id)).filter((r): r is OpenRole => Boolean(r));
}

/** Headcount change across the trend window, as a signed percentage (null when not computable). */
export function trendPct(trend: Array<{ value: number }>): number | null {
  if (trend.length < 2 || !trend[0]!.value) return null;
  return Math.round(((trend.at(-1)!.value - trend[0]!.value) / trend[0]!.value) * 1000) / 10;
}

export const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;

export const projectAnchor = (id: string) => `enrichment-project-${id}`;

/**
 * Inferred projects as opportunity signals in the account watchdog. Medium and
 * high confidence only, so low-confidence guesses don't read as signals.
 * Sample data keeps the "Sample:" title prefix the watchdog uses to show its badge.
 */
export function mergeEnrichmentSignals(data: AccountWatchdog, enr: CompanyEnrichment | undefined): AccountWatchdog {
  if (!enr || enr.companyId !== data.companyId) return data;
  const have = new Set(data.events.map((e) => e.id));
  const extra: AccountWatchdog['events'] = enr.projects
    .filter((p) => p.confidence !== 'low' && !have.has(`enr:${p.id}`))
    .map((p) => ({
      id: `enr:${p.id}`,
      source: 'enrichment',
      kind: 'INFERRED_PROJECT',
      title: `${enr.sample ? 'Sample: ' : ''}Potential project: ${p.title}`,
      summary: `${p.summary} ${CONFIDENCE_LABEL[p.confidence]} (${Math.round(p.score * 100)}%), from ${p.evidence.length} job posting${p.evidence.length === 1 ? '' : 's'}.`,
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
