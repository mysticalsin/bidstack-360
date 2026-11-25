// Open pipeline that is already past its close day. The headline figure is a
// sum of open bids. On the Polo seed every one of those bids closed in 2026
// before 25 Nov, so the figure is a stale book unless this split is named.
import { stageKey, type OppRow } from '@/components/viz/viz-data';

export interface OpenPipelinePastClose {
  count: number;
  value: number;
}

function utcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Open value whose UTC due day is before today.
 * The due day itself stays open. A blank or unreadable date is not past close.
 * A won or lost bid is an outcome, not open pipeline.
 */
export function openPipelinePastClose(rows: OppRow[], now = Date.now()): OpenPipelinePastClose {
  const today = utcDay(now);
  let count = 0;
  let value = 0;
  for (const row of rows) {
    const key = stageKey(row.stage);
    if (key === 'closed_won' || key === 'closed_lost') continue;
    if (!row.dueDate) continue;
    const due = new Date(row.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    if (utcDay(due.getTime()) >= today) continue;
    count += 1;
    value += row.value ?? 0;
  }
  return { count, value };
}
