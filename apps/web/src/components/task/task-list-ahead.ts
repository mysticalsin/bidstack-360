import { daysUntil } from '@/lib/format';

export interface FollowUpTiming {
  title: string;
  dueDate: string | null;
  status: string;
}

export interface AheadEmptyCopy {
  titleKey: string;
  titleFallback: string;
  messageKey: string;
  messageFallback: string;
  vars: { title: string; count: number; days: number };
}

/**
 * Today and Overdue are cuts of the loaded page. A fresh demo files its
 * open follow-ups a few days out, so both chips match nothing while those
 * rows are still on All. "No tasks match this filter" reads as an empty book.
 *
 * This names the soonest open row that is still ahead. A late row is a
 * different sentence, so a book that already has one stays quiet. A finished
 * row is not ahead. Due today is not ahead.
 */
export function dateChipAheadEmpty(
  filter: string,
  visibleCount: number,
  loaded: readonly FollowUpTiming[],
): AheadEmptyCopy | null {
  if (visibleCount !== 0) return null;
  if (filter !== 'today' && filter !== 'overdue') return null;

  let soonest: { days: number; title: string } | null = null;
  let aheadCount = 0;
  let hasLate = false;
  for (const task of loaded) {
    if (task.status === 'done') continue;
    const days = daysUntil(task.dueDate);
    if (days === null) continue;
    if (days < 0) {
      hasLate = true;
      continue;
    }
    if (days === 0) continue;
    aheadCount += 1;
    if (!soonest || days < soonest.days) soonest = { days, title: task.title };
  }

  if (!soonest || hasLate || aheadCount === 0) return null;

  const next =
    soonest.days === 1
      ? {
          messageKey: 'tasks.empty.nextTomorrow',
          messageFallback: 'Next is {{title}}, tomorrow.',
        }
      : {
          messageKey: 'tasks.empty.nextDays',
          messageFallback: 'Next is {{title}}, in {{count}} days.',
        };
  const nextVars = { title: soonest.title, count: soonest.days, days: soonest.days };

  if (filter === 'today' || aheadCount === 1) {
    return {
      titleKey:
        filter === 'today' ? 'tasks.empty.todayAheadTitle' : 'tasks.empty.overdueClearTitle',
      titleFallback: filter === 'today' ? 'Nothing is due today' : 'Nothing is overdue',
      ...next,
      vars: nextVars,
    };
  }

  return {
    titleKey: 'tasks.empty.overdueClearTitle',
    titleFallback: 'Nothing is overdue',
    ...(soonest.days === 1
      ? {
          messageKey: 'tasks.empty.overdueClearManyTomorrow',
          messageFallback:
            '{{count}} open follow-ups in this list are still ahead. Next is {{title}}, tomorrow.',
        }
      : {
          messageKey: 'tasks.empty.overdueClearMany',
          messageFallback:
            '{{count}} open follow-ups in this list are still ahead. Next is {{title}}, in {{days}} days.',
        }),
    vars: { title: soonest.title, count: aheadCount, days: soonest.days },
  };
}
