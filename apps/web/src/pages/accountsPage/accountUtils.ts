// Shared types and pure utility functions for the Accounts board.
// WHY separate: consumed by both AccountsPage (rows derivation, sorting,
// filter labels) and AccountCard (healthTone, healthLabel, sourcePillsFor).
import type { CrmCompany, CrmDeal } from '@bidstack/shared';

export type SortKey = 'name' | 'pipeline' | 'health' | 'industry';

export interface AccountRow {
  company: CrmCompany;
  openDeals: number;
  pipelineMicros: number;
  totalDeals: number;
  // Coarse health proxy until real data enhancement lands: weighted-pipeline / open-deals
  // banded into 4 buckets. Real CompanyHealth lives in cockpit; per-account here
  // is derived because we only have aggregate signal at the list level.
  health: 'strong' | 'good' | 'needs_attention' | 'critical';
}

export function deriveAccount(company: CrmCompany, deals: CrmDeal[]): AccountRow {
  const matched = deals.filter(
    (d) =>
      d.companyId === company.id || d.companyName?.toLowerCase() === company.name.toLowerCase(),
  );
  const open = matched.filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost');
  const pipelineMicros = open.reduce(
    (acc, d) => acc + Math.round(d.amountMicros * ((d.probability ?? 50) / 100)),
    0,
  );
  // Health proxy: 0 → critical, <250k → needs_attention, <2M → good, ≥2M → strong.
  const health: AccountRow['health'] =
    pipelineMicros === 0
      ? 'critical'
      : pipelineMicros < 250_000_000_000
        ? 'needs_attention'
        : pipelineMicros < 2_000_000_000_000
          ? 'good'
          : 'strong';
  return {
    company,
    openDeals: open.length,
    pipelineMicros,
    totalDeals: matched.length,
    health,
  };
}

export function sortRows(a: AccountRow, b: AccountRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.company.name.localeCompare(b.company.name);
    case 'pipeline':
      return b.pipelineMicros - a.pipelineMicros;
    case 'health': {
      const order = { strong: 0, good: 1, needs_attention: 2, critical: 3 };
      return order[a.health] - order[b.health];
    }
    case 'industry':
      return (a.company.industry ?? '').localeCompare(b.company.industry ?? '');
  }
}

export function healthTone(h: AccountRow['health']) {
  return h === 'strong'
    ? 'jade'
    : h === 'good'
      ? 'blue'
      : h === 'needs_attention'
        ? 'amber'
        : 'tomato';
}

export function healthLabel(h: AccountRow['health']) {
  return h === 'strong'
    ? 'Strong'
    : h === 'good'
      ? 'Good'
      : h === 'needs_attention'
        ? 'Watch'
        : 'At risk';
}

export function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function sourcePillsFor(company: CrmCompany): string[] {
  const pills = new Set<string>();
  pills.add(company.source === 'verified_data' ? 'Verified' : sourceLabel(company.source));
  if (company.logo?.source) pills.add(`Logo: ${logoSourceLabel(company.logo.source)}`);
  for (const source of company.sourceAttribution.slice(0, 2)) {
    pills.add(sourceLabel(source.source));
  }
  if (company.sourceAttribution.length === 0) pills.add('External CRM');
  return [...pills].slice(0, 4);
}

export function sourceLabel(source: string): string {
  const normalized = source.toLowerCase();
  if (normalized.includes('external_erp')) return 'ERP';
  if (normalized.includes('external_crm')) return 'External CRM';
  if (normalized.includes('apollo')) return 'Apollo';
  if (normalized.includes('brandfetch')) return 'Brandfetch';
  if (normalized.includes('logo_dev')) return 'Logo.dev';
  if (normalized.includes('official')) return 'Official';
  if (normalized.includes('favicon')) return 'Favicon';
  if (normalized.includes('bidstack')) return 'BidStack';
  if (normalized.includes('verified_data')) return 'Verified';
  return titleCase(source.replace(/[-.]/g, ' '));
}

export function logoSourceLabel(source: NonNullable<CrmCompany['logo']>['source']): string {
  if (source === 'logo_dev') return 'Logo.dev';
  if (source === 'official_website') return 'Official';
  return sourceLabel(source);
}
