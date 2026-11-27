// Due date on the demo book used the due day alone. The finished Stellantis
// handover (23 Nov) then led the open IKEA annex (28 Nov), so the next
// deadline looked already done.
import { describe, expect, it } from 'vitest';

import { sortTasksByDue, type DueSortableTask } from './task-due-order';

function row(
  title: string,
  status: DueSortableTask['status'],
  dueDate: string | null,
): DueSortableTask & { title: string } {
  return { title, status, dueDate };
}

describe('sortTasksByDue', () => {
  it('puts open demo follow-ups ahead of the finished handover, earliest day first', () => {
    const sorted = sortTasksByDue([
      row('Stellantis handover', 'done', '2026-11-23'),
      row('IKEA pricing annex', 'open', '2026-11-28'),
      row('HSBC questionnaire', 'in_progress', '2026-11-29'),
      row('Siemens technical volume', 'in_progress', '2026-11-30'),
      row('Sanofi workshop', 'open', '2026-12-02'),
    ]);

    expect(sorted.map((task) => task.title)).toEqual([
      'IKEA pricing annex',
      'HSBC questionnaire',
      'Siemens technical volume',
      'Sanofi workshop',
      'Stellantis handover',
    ]);
  });

  it('keeps a blocked row with unfinished work and a missing day after dated open rows', () => {
    const sorted = sortTasksByDue([
      row('Stellantis handover', 'done', '2026-11-23'),
      row('Undated note', 'open', null),
      row('Blocked questionnaire', 'blocked', '2026-11-29'),
      row('IKEA pricing annex', 'open', '2026-11-28'),
    ]);

    expect(sorted.map((task) => task.title)).toEqual([
      'IKEA pricing annex',
      'Blocked questionnaire',
      'Undated note',
      'Stellantis handover',
    ]);
  });

  it('keeps two open rows on the same day in the order they were loaded', () => {
    const sorted = sortTasksByDue([
      row('First same day', 'open', '2026-11-28'),
      row('Second same day', 'in_progress', '2026-11-28'),
    ]);

    expect(sorted.map((task) => task.title)).toEqual(['First same day', 'Second same day']);
  });
});
