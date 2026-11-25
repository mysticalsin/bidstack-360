import { describe, expect, it } from 'vitest';

import { taskListCaption } from './task-list-caption';

// Demo follow-ups are dated May 2026. On 25 Nov 2026 Today matches none of
// them. The loaded page still holds those rows, because Today and Overdue
// are not server filters. The header has to describe the chip, not the page.
describe('taskListCaption', () => {
  it('says nothing is due today when the May demo page is hidden by Today', () => {
    expect(taskListCaption('today', 0, 7)).toEqual({
      key: 'tasks.subtitleTodayEmpty',
      fallback: 'Nothing due today.',
    });
  });

  it('counts the rows Today is showing, including one and many', () => {
    expect(taskListCaption('today', 1, 7)).toEqual({
      key: 'tasks.subtitleTodayOne',
      fallback: '1 due today.',
    });
    expect(taskListCaption('today', 3, 7)).toEqual({
      key: 'tasks.subtitleToday',
      fallback: '{{count}} due today.',
      count: 3,
    });
  });

  it('counts only the overdue rows, and says when that chip is empty', () => {
    expect(taskListCaption('overdue', 1, 2)).toEqual({
      key: 'tasks.subtitleOverdueOne',
      fallback: '1 overdue.',
    });
    expect(taskListCaption('overdue', 4, 7)).toEqual({
      key: 'tasks.subtitleOverdue',
      fallback: '{{count}} overdue.',
      count: 4,
    });
    expect(taskListCaption('overdue', 0, 1)).toEqual({
      key: 'tasks.subtitleOverdueEmpty',
      fallback: 'Nothing overdue in this list.',
    });
  });

  it('leaves All and a status chip on the loaded length', () => {
    expect(taskListCaption('all', 2, 2)).toEqual({
      key: 'tasks.subtitle',
      fallback: '{{count}} active follow-ups.',
      count: 2,
    });
    expect(taskListCaption('open', 1, 1).key).toBe('tasks.subtitle');
  });
});
