// Deal marks on the account signals timeline. Opened and closed marks keep
// the previous window. An open deal whose due day is already past gets its
// own mark on that day, so a seeded bid does not read as current or vanish.
import type { TimelineItem } from '@bidstack/shared';

import { closedAtOf, recordedOutcome, type OppRow } from './load.js';

export type DealTimelineOpp = OppRow & { dueDate: Date | null };

export type DealTimelineMark = Omit<TimelineItem, 'upcoming'>;

function utcDay(d: Date): number | null {
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ');
}

/**
 * Timeline rows for pipeline deals. An open deal is overdue when its due day
 * is inside the window and before today (UTC). Due today, a future day, a
 * missing or invalid day, and a won or lost deal stay off that mark. A due
 * day before the window is outside this picture.
 */
export function dealTimelineMarks(
  deals: readonly DealTimelineOpp[],
  bounds: { from: Date; now: Date },
): DealTimelineMark[] {
  const fromDay = utcDay(bounds.from);
  const today = utcDay(bounds.now);
  const marks: DealTimelineMark[] = [];
  for (const o of deals) {
    const href = `/opportunities/${o.id}`;
    if (o.createdAt >= bounds.from) {
      marks.push({
        id: `op:${o.id}:open`,
        at: o.createdAt.toISOString(),
        lane: 'ours',
        category: 'deal',
        title: `Deal opened: ${o.name}`,
        summary: `Stage ${stageLabel(o.stage)}`,
        source: 'Pipeline',
        sourceUrl: null,
        href,
        importance: 45,
        implication: 'NEUTRAL',
        sample: false,
      });
    }
    const closed = closedAtOf(o);
    if (closed && closed >= bounds.from) {
      const won = recordedOutcome(o) === 'won';
      marks.push({
        id: `op:${o.id}:close`,
        at: closed.toISOString(),
        lane: 'ours',
        category: 'deal',
        title: `${won ? 'Won' : 'Lost'}: ${o.name}`,
        summary: won ? 'Closed won' : 'Closed lost',
        source: 'Pipeline',
        sourceUrl: null,
        href,
        importance: won ? 70 : 60,
        implication: won ? 'OPPORTUNITY' : 'RISK',
        sample: false,
      });
    }
    const due = o.dueDate;
    const dueDay = due ? utcDay(due) : null;
    if (
      recordedOutcome(o) === 'open' &&
      due &&
      dueDay != null &&
      fromDay != null &&
      today != null &&
      dueDay >= fromDay &&
      dueDay < today
    ) {
      marks.push({
        id: `op:${o.id}:overdue`,
        at: due.toISOString(),
        lane: 'ours',
        category: 'deal',
        title: `Overdue: ${o.name}`,
        summary: `Still open, due ${due.toISOString().slice(0, 10)}.`,
        source: 'Pipeline',
        sourceUrl: null,
        href,
        importance: 70,
        implication: 'RISK',
        sample: false,
      });
    }
  }
  return marks;
}
