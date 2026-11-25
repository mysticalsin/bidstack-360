import { accountBars, fmtCompact, stageKey, type OppRow } from '@/components/viz/viz-data';

/**
 * Open value drawn on the top-account bars whose close day is already over.
 *
 * The chart caps at six accounts and leaves lost bids off. A bid due today
 * stays open: the due date is a UTC calendar day, and the deal board still
 * says "Due today" after midnight. A blank date is unscheduled, not late.
 * Won value stays won.
 */
export interface TopAccountPastClose {
  /** Chart order. Only accounts whose open value on the bars is past close. */
  accounts: Array<{ label: string; pastClose: number }>;
  total: number;
  sentence: string | null;
  byAccount: ReadonlyMap<string, number>;
}

function utcDay(iso: string): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isPastCloseDay(dueDate: string | null | undefined, now: number): boolean {
  if (!dueDate) return false;
  const due = utcDay(dueDate);
  if (due === null) return false;
  const today = new Date(now);
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return due < todayDay;
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  const last = names[names.length - 1] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

export function topAccountPastClose(rows: OppRow[], now = Date.now()): TopAccountPastClose {
  const bars = accountBars(rows);
  const shown = new Set(bars.map((bar) => bar.label));
  const byAccount = new Map<string, number>();
  for (const row of rows) {
    const name = row.customer;
    if (!name || !shown.has(name)) continue;
    const stage = stageKey(row.stage);
    if (stage === 'closed_won' || stage === 'closed_lost') continue;
    if (!isPastCloseDay(row.dueDate, now)) continue;
    byAccount.set(name, (byAccount.get(name) ?? 0) + (row.value ?? 0));
  }
  const accounts = bars
    .map((bar) => ({ label: bar.label, pastClose: byAccount.get(bar.label) ?? 0 }))
    .filter((bar) => bar.pastClose > 0);
  const total = accounts.reduce((sum, account) => sum + account.pastClose, 0);
  const sentence =
    total > 0
      ? `Open value on this chart includes ${fmtCompact(total)} past its close date (${nameList(accounts.map((account) => account.label))}).`
      : null;
  return { accounts, total, sentence, byAccount };
}
