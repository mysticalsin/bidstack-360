// Slice 22 sourced company figures: correct a figure with its source, or ask
// the public sources (registries, filings, Wikidata) to look again.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { CompanyFieldOverrideKey, KeyNumber } from '@bidstack/shared';

import { api } from '@/lib/api';

import { useAccountKeyNumbers } from './useAccountPositioning';

const enc = encodeURIComponent;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FigureOverrideInput {
  fieldKey: CompanyFieldOverrideKey;
  value: string | number;
  sourceUrl: string | null;
  sourceLabel: string | null;
}

/** Every view that shows a company figure re-reads after an edit or refresh. */
const FIGURE_QUERIES = new Set(['account-key-numbers', 'account-positioning', 'company-intel', 'crm-dashboard', 'company-enrichment']);

function invalidateFigures(qc: QueryClient) {
  void qc.invalidateQueries({ predicate: (q) => FIGURE_QUERIES.has(String(q.queryKey[0])) });
}

/** Save a manual value with its source. `companyKey` may be the company id or its name. */
export function useSaveFigureOverride(companyKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: FigureOverrideInput) =>
      api(`/api/crm/companies/${enc(companyKey)}/field-overrides`, {
        method: 'PUT',
        body: {
          fieldKey: input.fieldKey,
          value: input.value,
          ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
          ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
        },
      }),
    onSuccess: () => invalidateFigures(qc),
  });
}

/**
 * Queue the public lookups for one account: registry and filings through the
 * account intel worker, and the Wikidata profile through the enrich route.
 * Resolves with how many of the three were accepted.
 */
export function useRefreshPublicSources(companyId: string, companyName: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled([
        api(`/api/companies/${enc(companyId)}/intel/refresh`, { method: 'POST', body: { source: 'registry' } }),
        api(`/api/companies/${enc(companyId)}/intel/refresh`, { method: 'POST', body: { source: 'financials' } }),
        api(`/api/crm/companies/${enc(companyId)}/enrich`, { method: 'POST', body: { name: companyName } }),
      ]);
      const accepted = results.filter((r) => r.status === 'fulfilled').length;
      if (accepted === 0) throw new Error('No public source accepted the refresh. Try again later.');
      return { accepted };
    },
    onSuccess: () => invalidateFigures(qc),
  });
}

/** Revenue and employees as the key numbers resolved them, for any card on the account page. */
export function useSourcedFigures(companyId: string | undefined): { revenue: KeyNumber | null; employees: KeyNumber | null; companyName: string } {
  const q = useAccountKeyNumbers(companyId && UUID_RE.test(companyId) ? companyId : undefined);
  const items = Array.isArray(q.data?.items) ? q.data.items : [];
  return {
    revenue: items.find((i) => i.id === 'revenue') ?? null,
    employees: items.find((i) => i.id === 'employees') ?? null,
    companyName: typeof q.data?.companyName === 'string' ? q.data.companyName : '',
  };
}

/** Display text for a revenue or employees key number, or null when it has no value. */
export function figureText(n: KeyNumber | null): string | null {
  if (!n || n.value == null) return null;
  if (n.unit === 'money_micros') return fmtMoneyShort(n.value / 1_000_000, 'EUR');
  if (n.unit === 'money') return fmtMoneyShort(n.value, n.currency ?? 'EUR');
  return Math.round(n.value).toLocaleString('en-GB');
}

function fmtMoneyShort(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const [v, s] = abs >= 1e9 ? [amount / 1e9, 'B'] : abs >= 1e6 ? [amount / 1e6, 'M'] : abs >= 1e3 ? [amount / 1e3, 'k'] : [amount, ''];
  return `${currency} ${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}${s}`;
}

/** A sourced public or manual figure beats provider or sample data on the cards. */
export function beatsProvider(n: KeyNumber | null): boolean {
  const o = n?.provenance?.origin;
  return n?.value != null && (o === 'filed' || o === 'manual_sourced' || o === 'wikidata');
}

export const isCompanyId = (id: string | undefined | null): id is string => Boolean(id && UUID_RE.test(id));
