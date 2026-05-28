/**
 * dashboard.utils.ts — pure, stateless helpers for the CRM dashboard pipeline.
 *
 * WHY a separate module: dashboard.service.ts exceeded 1 700 lines. These
 * helpers have no local dependencies (only @bidstack/shared + zod), making
 * them the ideal leaf in the import DAG. Any service can import them without
 * risk of circular references.
 */
import { z } from 'zod';

import {
  type AccountCockpitSnapshot,
  type CrmCompany,
  type CrmDashboardSnapshot,
  type CrmDeal,
  type DataQualityReport,
  type ProviderHealth,
  SourceAttribution,
  type SourceAttribution as SourceAttributionType,
} from '@bidstack/shared';

// ─── Attribution ──────────────────────────────────────────────────────────────

export function attribution({
  source,
  label,
  sourceUrl,
  confidence,
}: {
  source: string;
  label: string;
  sourceUrl: string | null;
  confidence: number;
}): SourceAttributionType {
  return {
    source,
    label,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    confidence,
    providerMetadata: {},
  };
}

export function parseAttribution(value: unknown): SourceAttributionType[] {
  const parsed = z.array(SourceAttribution).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function latestAttributionDate(items: SourceAttributionType[]) {
  const times = items
    .map((item) => new Date(item.fetchedAt))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return times[0] ?? null;
}

// ─── Enum coercers ────────────────────────────────────────────────────────────

export function asRiskSeverity(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number]['severity'] {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

export function asRiskStatus(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['risks'][number]['status'] {
  return value === 'open' ||
    value === 'in_progress' ||
    value === 'mitigated' ||
    value === 'accepted'
    ? value
    : 'open';
}

export function asComplianceStatus(
  value: string,
): z.infer<typeof AccountCockpitSnapshot>['compliance'][number]['status'] {
  return value === 'compliant' ||
    value === 'in_progress' ||
    value === 'blocked' ||
    value === 'not_started'
    ? value
    : 'not_started';
}

export function asProviderStatus(value: string): z.infer<typeof ProviderHealth>['status'] {
  return value === 'healthy' || value === 'degraded' || value === 'disabled' || value === 'down'
    ? value
    : 'degraded';
}

// ─── String / record helpers ───────────────────────────────────────────────────

export function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function stringUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

export function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

export function formatMicrosCompact(micros: number) {
  const units = micros / 1_000_000;
  if (units >= 1_000_000_000) return `$${(units / 1_000_000_000).toFixed(1)}B`;
  if (units >= 1_000_000) return `$${(units / 1_000_000).toFixed(1)}M`;
  return `$${units.toLocaleString()}`;
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeDomain(domain: string | null | undefined) {
  if (!domain) return null;
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export function normalizeRegistryValue(value: string) {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

export function normalizeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeCountry(country: string | null | undefined) {
  if (!country) return null;
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function safeErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown error';
  return err.message.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

export function isValidDomain(domain: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

// ─── Deal stage mapping ───────────────────────────────────────────────────────

export function mapDealStage(stage: string): z.infer<typeof CrmDeal>['stage'] {
  switch (stage) {
    case 's1_lead':
      return 'new';
    case 's1_ongoing':
      return 'screening';
    case 's2_sent':
      return 'meeting';
    case 's3_technical_iteration':
      return 'proposal';
    case 's4_negotiation':
      return 'proposal';
    case 'closed_won':
      return 'closed_won';
    case 'closed_lost':
      return 'closed_lost';
    default:
      return 'new';
  }
}

// ─── Technical stack parser ───────────────────────────────────────────────────

export function parseTechnicalStack(
  value: unknown,
): Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]> {
  const parsed = z
    .array(
      z.object({
        label: z.string(),
        items: z.array(
          z.object({
            name: z.string(),
            source: z.string(),
            confidence: z.number(),
          }),
        ),
      }),
    )
    .safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function mergeTechnicalStack(
  primary: Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]>,
  fallback: Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]>,
): Array<z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]> {
  const byCategory = new Map<
    string,
    Map<string, z.infer<typeof AccountCockpitSnapshot>['technicalStack'][number]['items'][number]>
  >();
  for (const category of [...primary, ...fallback]) {
    const items = byCategory.get(category.label) ?? new Map();
    for (const item of category.items) {
      const key = item.name.toLowerCase();
      const existing = items.get(key);
      items.set(key, existing && existing.confidence > item.confidence ? existing : item);
    }
    byCategory.set(category.label, items);
  }
  return [...byCategory.entries()].map(([label, items]) => ({
    label,
    items: [...items.values()],
  }));
}

// ─── Data quality report ──────────────────────────────────────────────────────

export function buildDataQualityReport(
  snapshot: z.infer<typeof CrmDashboardSnapshot>,
): z.infer<typeof DataQualityReport> {
  const issues: z.infer<typeof DataQualityReport>['issues'] = [];
  const byDomain = new Map<string, Array<z.infer<typeof CrmCompany>>>();
  const now = Date.now();

  for (const company of snapshot.companies) {
    if (company.domain) {
      const domain = normalizeDomain(company.domain);
      if (domain) byDomain.set(domain, [...(byDomain.get(domain) ?? []), company]);
      if (domain && !isValidDomain(domain)) {
        issues.push({
          id: `invalid-domain:${company.id}`,
          kind: 'invalid_domain',
          severity: 'medium',
          title: `${company.name} has an invalid domain`,
          detail: company.domain,
          companyId: company.id,
          companyName: company.name,
          sourceAttribution: company.sourceAttribution,
        });
      }
    }

    const latestFetch = latestAttributionDate(company.sourceAttribution);
    if (latestFetch && now - latestFetch.getTime() > 90 * 24 * 60 * 60 * 1000) {
      issues.push({
        id: `stale-data:${company.id}`,
        kind: 'stale_data',
        severity: 'low',
        title: `${company.name} data is older than 90 days`,
        detail: `Last verified ${latestFetch.toISOString().slice(0, 10)}`,
        companyId: company.id,
        companyName: company.name,
        sourceAttribution: company.sourceAttribution,
      });
    }

    if (!company.logo?.url) {
      issues.push({
        id: `missing-logo:${company.id}`,
        kind: 'missing_logo',
        severity: 'low',
        title: `${company.name} is using initials fallback`,
        detail: 'No logo URL is cached for this account.',
        companyId: company.id,
        companyName: company.name,
        sourceAttribution: company.sourceAttribution,
      });
    }
  }

  for (const [domain, companies] of byDomain) {
    if (companies.length < 2) continue;
    issues.push({
      id: `duplicate-domain:${domain}`,
      kind: 'duplicate_company',
      severity: 'high',
      title: `${companies.length} companies share ${domain}`,
      detail: companies.map((company) => company.name).join(', '),
      companyId: companies[0]?.id ?? null,
      companyName: companies[0]?.name ?? null,
      sourceAttribution: [],
    });
  }

  for (const deal of snapshot.deals) {
    if (deal.ownerId) continue;
    issues.push({
      id: `missing-owner:${deal.id}`,
      kind: 'missing_owner',
      severity: 'medium',
      title: `${deal.name} has no owner`,
      detail: 'Assign an owner so reminders, audit, and forecast accountability work.',
      companyId: deal.companyId,
      companyName: deal.companyName,
      sourceAttribution: [],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: issues.reduce<Record<string, number>>((acc, issue) => {
      acc[issue.kind] = (acc[issue.kind] ?? 0) + 1;
      return acc;
    }, {}),
    issues,
  };
}
