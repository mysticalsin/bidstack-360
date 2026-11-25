// Pure filter behind the bid drill-down (kept apart from the component so
// fast refresh works and the logic is unit-testable on its own).
import { closeDate, oppStatus, stageKey, type OppRow, type OppStatus } from '@/components/viz/viz-data';

export interface OppDrillFilter {
  status?: OppStatus | 'all';
  stage?: string | null;
  account?: string | null;
  /** Won within the current calendar year (hero "Won this year"). */
  thisYear?: boolean;
  /** Close month as 'YYYY-MM' (hero "Bids by close month" column). */
  closeMonth?: string | null;
  /**
   * Chart book, used when status is unset or "all".
   * forecast / accounts: won and open (a lost bid is not on those bars).
   * closed: won and lost (an open bid is not in the win rate).
   * An explicit status other than "all" replaces this.
   */
  book?: 'forecast' | 'accounts' | 'closed';
}

export function filterOpps(rows: OppRow[], f: OppDrillFilter, q = '', year = new Date().getUTCFullYear()): OppRow[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((o) => {
    const status = oppStatus(o);
    if (f.status && f.status !== 'all') {
      if (status !== f.status) return false;
    } else if (f.book === 'closed') {
      if (status === 'open') return false;
    } else if (f.book === 'forecast' || f.book === 'accounts') {
      if (status === 'lost') return false;
    }
    if (f.stage && stageKey(o.stage) !== f.stage) return false;
    if (f.account && (o.customer ?? '').toLowerCase() !== f.account.toLowerCase()) return false;
    if (f.thisYear) {
      const d = closeDate(o);
      if (!d || new Date(d).getUTCFullYear() !== year) return false;
    }
    if (f.closeMonth) {
      const d = closeDate(o);
      const t = d ? new Date(d).getTime() : Number.NaN;
      if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 7) !== f.closeMonth) return false;
    }
    if (needle && !`${o.name ?? ''} ${o.customer ?? ''} ${o.code ?? ''}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}
