// Shared cockpit utilities. Lives next to the cockpit components so
// extracting these into their own files doesn't multiply the surface area
// of "what to import" for the consumer; the cockpit barrel re-exports the
// runtime helpers each card actually needs.

import type { AccountCockpitSnapshot, RiskItem } from '@bidstack/shared';

export type KpiTone = AccountCockpitSnapshot['kpis'][number]['tone'];

export const KPI_TONE_BG: Record<KpiTone, string> = {
  blue: 'var(--tag-blue-bg)',
  jade: 'var(--tag-jade-bg)',
  purple: 'var(--tag-purple-bg)',
  amber: 'var(--tag-amber-bg)',
  teal: 'var(--tag-teal-bg)',
  rose: 'var(--tag-rose-bg)',
};

export const KPI_TONE_FG: Record<KpiTone, string> = {
  blue: 'var(--tag-blue-fg)',
  jade: 'var(--tag-jade-fg)',
  purple: 'var(--tag-purple-fg)',
  amber: 'var(--tag-amber-fg)',
  teal: 'var(--tag-teal-fg)',
  rose: 'var(--tag-rose-fg)',
};

export function iconForKpi(label: string) {
  const l = label.toLowerCase();
  // Revenue and pipeline have no stored currency. A dollar glyph reads as USD.
  if (l.includes('pipeline') || l.includes('revenue') || l.includes('arr')) return 'briefcase';
  if (l.includes('win') || l.includes('won')) return 'trophy';
  if (l.includes('risk') || l.includes('overdue')) return 'warning';
  if (l.includes('growth') || l.includes('forecast')) return 'growth';
  if (l.includes('target') || l.includes('readiness')) return 'target';
  if (l.includes('insight') || l.includes('ai')) return 'sparkle';
  return 'briefcase';
}

export function severityTone(s: RiskItem['severity']): 'tomato' | 'amber' | 'gray' {
  return s === 'critical' || s === 'high' ? 'tomato' : s === 'medium' ? 'amber' : 'gray';
}

export function severityBg(s: RiskItem['severity']): string {
  if (s === 'critical' || s === 'high') return 'var(--tag-rose-bg)';
  if (s === 'medium') return 'var(--tag-amber-bg)';
  return 'var(--tag-gray-bg)';
}

export function severityShort(s: RiskItem['severity']): string {
  if (s === 'critical') return 'C';
  if (s === 'high') return 'H';
  if (s === 'medium') return 'M';
  if (s === 'low') return 'L';
  return '–';
}

/** Weights in computeSignalCoverage. The account-list health band is a different scale. */
export const SIGNAL_COVERAGE_WEIGHTS =
  'Weighted mix: firmographics 30%, contacts 25%, engagement 20%, open-deal completeness 25%. Not measured relationship health.';

export function labelForBand(b: AccountCockpitSnapshot['health']['band']): string {
  return b === 'strong'
    ? 'Strong, proxy'
    : b === 'good'
      ? 'Good, proxy'
      : b === 'needs_attention'
        ? 'Watch, proxy'
        : 'At risk, proxy';
}

/** A trade name is not a headquarters and not a ticker. */
export function headquartersFor(_companyName: string): string | null {
  return null;
}

export function tickerForCompany(_companyName: string): string | null {
  return null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  ).toUpperCase();
}
