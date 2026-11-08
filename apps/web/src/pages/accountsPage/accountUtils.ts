// Shared types and pure utility functions for the Accounts board.
// WHY separate: consumed by both AccountsPage (rows derivation, sorting,
// filter labels) and AccountCard (healthTone, healthLabel, sourcePillsFor).
import type { CrmCompany, CrmDeal } from '@bidstack/shared';

export type SortKey = 'name' | 'pipeline' | 'health' | 'industry' | 'coverage';
export type AccountSegmentKey = 'all' | 'enriched' | 'with_tech' | 'needs_data' | 'watch';

export interface AccountRow {
  company: CrmCompany;
  openDeals: number;
  pipelineMicros: number;
  totalDeals: number;
  // Coarse health proxy until real data enhancement lands: weighted-pipeline / open-deals
  // banded into 4 buckets. Real CompanyHealth lives in cockpit; per-account here
  // is derived because we only have aggregate signal at the list level.
  health: 'strong' | 'good' | 'needs_attention' | 'critical';
  coverage: {
    score: number;
    present: string[];
    missing: string[];
    reason: string;
    nextAction: string;
  };
}

const COVERAGE_NEXT_ACTIONS: Record<string, string> = {
  Industry: 'Assign an industry to unlock sector routing.',
  Domain: 'Add the official domain to improve enrichment.',
  Logo: 'Attach a logo source for visual confidence.',
  'Tech stack': 'Capture the stack to guide presales plays.',
  FTE: 'Add FTE to size the account.',
  Pipeline: 'Link open opportunities to make this actionable.',
};

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
  const coverageFields = [
    { ok: Boolean(company.industry), label: 'Industry' },
    { ok: Boolean(company.domain ?? company.website), label: 'Domain' },
    { ok: Boolean(company.logo?.url), label: 'Logo' },
    { ok: (company.technicalStack?.length ?? 0) > 0, label: 'Tech stack' },
    { ok: company.employeeCount != null, label: 'FTE' },
    { ok: matched.length > 0, label: 'Pipeline' },
  ];
  const present = coverageFields.filter((field) => field.ok).map((field) => field.label);
  const missing = coverageFields.filter((field) => !field.ok).map((field) => field.label);
  const coverage = {
    score: Math.round((present.length / coverageFields.length) * 100),
    present,
    missing,
    reason:
      missing.length === 0
        ? 'All account list signals are present.'
        : `Missing ${compactList(missing.slice(0, 3))}.`,
    nextAction:
      missing.length === 0
        ? 'Open the cockpit to review strategy and activity.'
        : COVERAGE_NEXT_ACTIONS[missing[0]!] ?? 'Complete the missing account signal.',
  };
  return {
    company,
    openDeals: open.length,
    pipelineMicros,
    totalDeals: matched.length,
    health,
    coverage,
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
    case 'coverage':
      return b.coverage.score - a.coverage.score || b.pipelineMicros - a.pipelineMicros;
  }
}

export function segmentMatches(row: AccountRow, segment: AccountSegmentKey): boolean {
  switch (segment) {
    case 'all':
      return true;
    case 'enriched':
      return row.company.source === 'verified_data' || row.company.sourceAttribution.length > 0;
    case 'with_tech':
      return (row.company.technicalStack?.length ?? 0) > 0;
    case 'needs_data':
      return row.coverage.score < 67;
    case 'watch':
      return row.health === 'critical' || row.health === 'needs_attention';
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

function compactList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
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

export function techStackPillsFor(company: CrmCompany): string[] {
  const items = company.technicalStack?.flatMap((category) => {
    const firstItem = category.items[0]?.name;
    return firstItem ? [`${category.label}: ${firstItem}`] : [category.label];
  }) ?? [];
  return items.slice(0, 3);
}

export function sourceLabel(source: string): string {
  const normalized = source.toLowerCase();
  if (normalized.includes('external_erp')) return 'ERP';
  if (normalized.includes('external_crm')) return 'External CRM';
  // Data-source vendor names stay out of the product UI (Settings/MCP only) —
  // surface a neutral source label on the account view instead.
  if (normalized.includes('apollo')) return 'External Intelligence';
  if (normalized.includes('brandfetch')) return 'Logo provider';
  if (normalized.includes('logo_dev')) return 'Logo provider';
  if (normalized.includes('official')) return 'Official';
  if (normalized.includes('favicon')) return 'Favicon';
  if (normalized.includes('bidstack')) return 'Polo PreSales';
  if (normalized.includes('verified_data')) return 'Verified';
  return titleCase(source.replace(/[-.]/g, ' '));
}

export function logoSourceLabel(source: NonNullable<CrmCompany['logo']>['source']): string {
  if (source === 'logo_dev') return 'Logo.dev';
  if (source === 'official_website') return 'Official';
  return sourceLabel(source);
}
