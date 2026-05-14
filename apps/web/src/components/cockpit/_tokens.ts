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
  if (l.includes('pipeline') || l.includes('revenue') || l.includes('arr')) return 'dollar';
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
  return s === 'critical' ? 'C' : s === 'high' ? 'H' : s === 'medium' ? 'M' : 'L';
}

export function labelForBand(b: AccountCockpitSnapshot['health']['band']): string {
  return b === 'strong'
    ? 'Strong'
    : b === 'good'
      ? 'Good'
      : b === 'needs_attention'
        ? 'Watch'
        : 'At risk';
}

// Static fixtures used by the BusinessSnapshotCard when the company row's
// fields are sparse (older seed data, accounts without verified enrichment).
// These dictionaries belong in the seeder long-term; for now they live with
// the card that consumes them so the dashboard isn't reaching into an
// unrelated module for a literal lookup.
export function headquartersFor(companyName: string): string | null {
  const normalized = companyName.toLowerCase();
  if (normalized.includes('mantu')) return 'Paris, France';
  if (normalized.includes('rush')) return 'Chicago, United States';
  if (normalized.includes('dnb')) return 'Oslo, Norway';
  if (normalized.includes('mapfre')) return 'Madrid, Spain';
  if (normalized.includes('mahle')) return 'Stuttgart, Germany';
  if (normalized.includes('aritzia')) return 'Vancouver, Canada';
  if (normalized.includes('nos')) return 'Lisbon, Portugal';
  return null;
}

export function tickerForCompany(companyName: string): string | null {
  const normalized = companyName.toLowerCase();
  if (normalized.includes('apple')) return 'AAPL';
  if (normalized.includes('microsoft')) return 'MSFT';
  if (normalized.includes('dnb')) return 'OSL:DNB';
  if (normalized.includes('aritzia')) return 'TSX:ATZ';
  if (normalized.includes('mapfre')) return 'BME:MAP';
  if (normalized.includes('ci financial')) return 'TSX:CIX';
  return null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2)
  ).toUpperCase();
}
