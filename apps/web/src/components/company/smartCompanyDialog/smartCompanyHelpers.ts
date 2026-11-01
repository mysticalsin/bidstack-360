/**
 * smartCompanyDialog/smartCompanyHelpers.ts — pure helpers for SmartCompanyDialog.
 *
 * WHY separate: stateless helpers account for 60+ lines in the dialog file.
 * Moving them here keeps the component under the 400-line cap and makes each
 * function independently testable without a React context.
 */
import type { CompanyLookupResponse, CrmCompany } from '@bidstack/shared';

export function statusLabel(match: CompanyLookupResponse['match'] | undefined): string {
  if (match === 'exact_domain') return 'Exact domain match';
  if (match === 'registry_id') return 'Registry match';
  if (match === 'exact_name') return 'Exact name match';
  if (match === 'fuzzy_name') return 'Related accounts found';
  return 'Ready to enrich';
}

export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    ?.toLowerCase();
  if (!cleaned || !cleaned.includes('.') || cleaned.includes(' ')) return null;
  return cleaned;
}

export function titleFromDomain(domain: string): string {
  const [name] = domain.split('.');
  if (!name) return domain;
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function httpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function slugFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
  );
}

export { recordedConfidencePercent } from '@/lib/recorded-confidence';

/** A field is either recorded or absent. Partial percents would invent progress. */
export function recordedFill(recorded: boolean): number {
  return recorded ? 100 : 0;
}

export interface CompanyDraftSource {
  name: string;
  legalName: string | null;
  domain: string | null;
  website: string | null;
  description: string | null;
  headquarters: string | null;
  employeeCount: number | null;
  revenueLabel: string | null;
  industry: string | null;
}

/**
 * The official public name, domain, and website fill the draft.
 * A field the seller already edited stays as they left it.
 * An existing CRM company wins over a public preview so we do not
 * overwrite a saved account with a lookalike.
 */
export function resolveCompanyDraft(input: {
  typed: string;
  domainTouched: boolean;
  websiteTouched: boolean;
  domainDraft: string;
  websiteDraft: string;
  company: CompanyDraftSource | null;
  preview: CompanyDraftSource | null;
}): CompanyDraftSource & { domain: string; website: string } {
  const typedDomain = normalizeDomain(input.typed);
  const source = input.company ?? input.preview;
  const name =
    source?.name.trim() || (typedDomain ? titleFromDomain(typedDomain) : input.typed.trim());
  const domain = input.domainTouched
    ? input.domainDraft.trim()
    : (source?.domain ?? typedDomain ?? '');
  const host = normalizeDomain(domain);
  const website = input.websiteTouched
    ? input.websiteDraft.trim()
    : (source?.website ?? (host ? `https://${host}/` : ''));
  return {
    name,
    legalName: source?.legalName ?? null,
    domain: input.domainTouched ? domain : (host ?? ''),
    website,
    description: source?.description ?? null,
    headquarters: source?.headquarters ?? null,
    employeeCount: source?.employeeCount ?? null,
    revenueLabel: source?.revenueLabel ?? null,
    industry: source?.industry ?? null,
  };
}

export function sourceFromCompany(company: CrmCompany): CompanyDraftSource {
  return {
    name: company.name,
    legalName: company.legalName,
    domain: company.domain,
    website: company.website,
    description: company.publicFacts?.description ?? null,
    headquarters: company.publicFacts?.headquarters ?? null,
    employeeCount: company.employeeCount,
    revenueLabel: company.publicFacts?.revenueLabel ?? null,
    industry: company.industry,
  };
}

/** Same-origin logo proxy. Reserved domains never request a third-party mark. */
export function logoProxyPath(domain: string | null | undefined): string | null {
  const host = normalizeDomain(domain);
  if (!host || isReservedDomain(host)) return null;
  return `/api/v1/logo?domain=${encodeURIComponent(host)}`;
}

function isReservedDomain(domain: string): boolean {
  return (
    domain.endsWith('.example') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.test') ||
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net'
  );
}

export function logoSourceLabel(source: NonNullable<CrmCompany['logo']>['source']): string {
  if (source === 'logo_dev') return 'Logo.dev';
  if (source === 'official_website') return 'Official';
  if (source === 'brandfetch') return 'Brandfetch';
  if (source === 'wikimedia') return 'Wikimedia';
  if (source === 'favicon') return 'Favicon';
  if (source === 'manual') return 'Manual';
  return 'Initials';
}
