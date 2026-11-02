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

export function slugFor(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'company'
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
