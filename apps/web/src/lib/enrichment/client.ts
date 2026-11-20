// Enrichment client: the live API only. A missing provider result stays empty.
// Sample figures come from seeded fixture rows, never from a number invented here.
import type { Firmographics } from '@bidstack/shared';

import { api } from '@/lib/api';

import { fromApi, type ApiHiring, type ApiProjects } from './live';
import type { CompanyEnrichment } from './types';

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/enrichment`;

export async function fetchEnrichment(companyId: string, signal?: AbortSignal): Promise<CompanyEnrichment> {
  const f = await api<Firmographics>(base(companyId), { signal });
  const [h, p] = await Promise.all([
    api<ApiHiring>(`${base(companyId)}/hiring?limit=100`, { signal }).catch(() => null),
    api<ApiProjects>(`${base(companyId)}/projects?minConfidence=low`, { signal }).catch(() => null),
  ]);
  return fromApi(f, h, p);
}

export interface RefreshResult {
  queued: boolean;
  jobId: string | null;
  status: string;
  expiresAt: string | null;
}
export function refreshEnrichment(companyId: string, force = false): Promise<RefreshResult> {
  return api<RefreshResult>(`${base(companyId)}/refresh`, { method: 'POST', body: { force } });
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtAsOf = (iso: string) => dateFmt.format(new Date(iso));

function compactIsExact(amount: number, divisor: number): boolean {
  return Number((amount / divisor).toFixed(1)) * divisor === amount;
}

// The cut and the divisor are the same number. A lower cut that still divides
// by one million is a different step, and the display of 999,999 hides that
// because neither step is exact.
export function compactStep(abs: number): [number, string] | null {
  if (abs >= 1_000_000_000) return [1_000_000_000, 'B'];
  if (abs >= 1_000_000) return [1_000_000, 'M'];
  if (abs >= 1_000) return [1_000, 'k'];
  return null;
}

export function fmtMoney(amount: number, currency: string): string {
  if (!Number.isFinite(amount)) return '—';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const code = /^[A-Za-z]{3}$/.test(currency) ? `${currency.toUpperCase()} ` : '';
  const full = `${sign}${code}${abs.toLocaleString('en-GB')}`;
  if (!Number.isSafeInteger(abs)) return full;
  const step = compactStep(abs);
  if (!step || !compactIsExact(abs, step[0])) return full;
  const shown = (abs / step[0]).toLocaleString('en-GB', {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(abs / step[0]) ? 0 : 1,
  });
  return `${sign}${code}${shown}${step[1]}`;
}
