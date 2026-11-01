// Pure filter behind the bid drill-down (kept apart from the component so
// fast refresh works and the logic is unit-testable on its own).
import { closeDate, oppStatus, stageKey, type OppRow, type OppStatus } from '@/components/viz/viz-data';

export interface OppDrillFilter {
  status?: OppStatus | 'all';
  stage?: string | null;
  /** Trail label. A customer string is not the company link. */
  account?: string | null;
  /** Stored company id. A matching customer name is not this. */
  companyId?: string | null;
  /** Won within the current calendar year (hero "Won this year"). */
  thisYear?: boolean;
}

export function filterOpps(rows: OppRow[], f: OppDrillFilter, q = '', year = new Date().getUTCFullYear()): OppRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((o) => {
    if (f.status && f.status !== 'all' && oppStatus(o) !== f.status) return false;
    if (f.stage && stageKey(o.stage) !== f.stage) return false;
    if (f.companyId) {
      if (o.companyId !== f.companyId) return false;
    } else if (f.account && (o.customer ?? '').toLowerCase() !== f.account.toLowerCase()) return false;
    if (f.thisYear) {
      const d = closeDate(o);
      if (!d || new Date(d).getUTCFullYear() !== year) return false;
    }
    if (needle && !`${o.name ?? ''} ${o.customer ?? ''} ${o.code ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}
