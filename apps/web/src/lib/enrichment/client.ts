// Enrichment client: the live API, with Sample data whenever no provider data
// exists (provider not configured, or the account never enriched).
import type { Firmographics } from '@bidstack/shared';

import { api } from '@/lib/api';

import { fromApi, isSampleStatus, noticeFor, type ApiHiring, type ApiProjects } from './live';
import { mockEnrichment } from './mock';
import type { CompanyEnrichment } from './types';

const base = (companyId: string) => `/api/companies/${encodeURIComponent(companyId)}/enrichment`;

export async function fetchEnrichment(companyId: string, signal?: AbortSignal): Promise<CompanyEnrichment> {
  const f = await api<Firmographics>(base(companyId), { signal });
  if (isSampleStatus(f)) {
    return { ...mockEnrichment(companyId), status: f.status, notice: noticeFor(f.status) ?? noticeFor('not_configured'), stale: f.stale };
  }
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

export function fmtMoney(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const [v, s] = abs >= 1e9 ? [amount / 1e9, 'B'] : abs >= 1e6 ? [amount / 1e6, 'M'] : abs >= 1e3 ? [amount / 1e3, 'k'] : [amount, ''];
  return `${currency} ${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}${s}`;
}
