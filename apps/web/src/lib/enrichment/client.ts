// Enrichment client. The API isn't wired yet (contract pending in
// /workspace/fleet/polo-enrichment-api.md), so this serves mock data.
// Swap `fetchEnrichment` to `api(...)` once the route exists. Callers already
// treat the result as possibly sample data (`sample: true` → "Sample" label).
import { mockEnrichment } from './mock';
import type { CompanyEnrichment } from './types';

export const ENRICHMENT_LIVE = false;

export async function fetchEnrichment(companyId: string): Promise<CompanyEnrichment> {
  return mockEnrichment(companyId);
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtAsOf = (iso: string) => dateFmt.format(new Date(iso));

export function fmtMoney(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  const [v, s] = abs >= 1e9 ? [amount / 1e9, 'B'] : abs >= 1e6 ? [amount / 1e6, 'M'] : abs >= 1e3 ? [amount / 1e3, 'k'] : [amount, ''];
  return `${currency} ${v.toLocaleString('en-GB', { maximumFractionDigits: 1 })}${s}`;
}
