export interface TaskListCaption {
  key: string;
  fallback: string;
  count?: number;
}

/**
 * Header under Tasks. Today and Overdue are filtered on the loaded page, so
 * the sentence has to count the rows that chip is showing. On 25 Nov 2026
 * the demo follow-ups are dated May 2026: Today shows none of them, and the
 * header must not keep the loaded length ("1 active follow-ups") over that
 * empty list. A December row stays off Overdue the same way. All and the
 * status chips still use the loaded length.
 */
export function taskListCaption(
  filter: string,
  visibleCount: number,
  loadedCount: number,
): TaskListCaption {
  if (filter === 'today') {
    if (visibleCount === 0) {
      return { key: 'tasks.subtitleTodayEmpty', fallback: 'Nothing due today.' };
    }
    if (visibleCount === 1) {
      return { key: 'tasks.subtitleTodayOne', fallback: '1 due today.' };
    }
    return { key: 'tasks.subtitleToday', fallback: '{{count}} due today.', count: visibleCount };
  }
  if (filter === 'overdue') {
    if (visibleCount === 0) {
      return { key: 'tasks.subtitleOverdueEmpty', fallback: 'Nothing overdue in this list.' };
    }
    if (visibleCount === 1) {
      return { key: 'tasks.subtitleOverdueOne', fallback: '1 overdue.' };
    }
    return { key: 'tasks.subtitleOverdue', fallback: '{{count}} overdue.', count: visibleCount };
  }
  return {
    key: 'tasks.subtitle',
    fallback: '{{count}} active follow-ups.',
    count: loadedCount,
  };
}
