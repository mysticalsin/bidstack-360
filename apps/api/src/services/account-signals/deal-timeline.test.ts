import { describe, expect, it } from 'vitest';

import { dealTimelineMarks, type DealTimelineOpp } from './deal-timeline';

const NOW = new Date('2026-11-25T22:30:00.000Z');
const FROM = new Date('2025-11-25T22:30:00.000Z');

function deal(over: Partial<DealTimelineOpp> = {}): DealTimelineOpp {
  return {
    id: 'op-2041',
    companyId: 'c1',
    name: 'CI Financial, IT Modernization',
    stage: 's3_technical_iteration',
    valueMicros: 1_240_000_000_000n,
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
    updatedAt: new Date('2026-11-01T12:00:00.000Z'),
    closedAt: null,
    dueDate: new Date('2026-07-22T00:00:00.000Z'),
    pipelineStage: null,
    ...over,
  };
}

function titles(rows: DealTimelineOpp[]) {
  return dealTimelineMarks(rows, { from: FROM, now: NOW }).map((m) => m.title);
}

describe('deal timeline marks', () => {
  it('marks an open demo deal overdue on its due day, including one opened outside the window', () => {
    // WHY: demo bids such as CI Financial close on 22 Jul 2026 and stay open.
    // On 25 Nov 2026 the account timeline only said "Deal opened" at seed
    // time, or said nothing when that seed day was outside the last year.
    // The due day was already past, so the picture looked current or empty.
    const seeded = deal();
    const old = deal({
      id: 'op-old',
      name: 'DNB Bank, Cloud landing zone',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
      dueDate: new Date('2026-09-15T00:00:00.000Z'),
    });
    const deletedStage = deal({
      id: 'ghost',
      name: 'Deleted lost stage',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      pipelineStage: { isWon: false, isLost: true, deletedAt: new Date('2026-02-01T00:00:00.000Z') },
    });
    const marks = dealTimelineMarks([seeded, old, deletedStage], { from: FROM, now: NOW });
    const overdue = marks.filter((m) => m.id.endsWith(':overdue'));
    expect(overdue.map((m) => m.title)).toEqual([
      'Overdue: CI Financial, IT Modernization',
      'Overdue: DNB Bank, Cloud landing zone',
      'Overdue: Deleted lost stage',
    ]);
    expect(overdue.map((m) => m.at)).toEqual([
      '2026-07-22T00:00:00.000Z',
      '2026-09-15T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
    ]);
    expect(overdue.every((m) => m.category === 'deal' && m.lane === 'ours' && m.sample === false)).toBe(
      true,
    );
    expect(overdue.every((m) => m.implication === 'RISK' && m.href === `/opportunities/${m.id.split(':')[1]}`)).toBe(
      true,
    );
    expect(overdue[0]?.summary).toBe('Still open, due 2026-07-22.');
    expect(titles([seeded])).toContain('Deal opened: CI Financial, IT Modernization');
    expect(titles([old])).not.toContain('Deal opened: DNB Bank, Cloud landing zone');
  });

  it('does not mark an empty, current, future, or closed deal overdue', () => {
    // WHY: a missing close date is not late. Due today is not late. A won or
    // lost deal keeps its outcome and is not called overdue.
    const undated = deal({ id: 'undated', dueDate: null, name: 'No date' });
    const today = deal({
      id: 'today',
      dueDate: new Date('2026-11-25T00:00:00.000Z'),
      name: 'Due today',
    });
    const future = deal({
      id: 'future',
      dueDate: new Date('2026-12-01T00:00:00.000Z'),
      name: 'Still ahead',
    });
    const won = deal({
      id: 'won',
      name: 'Aritzia, Endpoint Refresh',
      stage: 'closed_won',
      dueDate: new Date('2026-04-28T00:00:00.000Z'),
      closedAt: new Date('2026-04-28T00:00:00.000Z'),
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const lostStage = deal({
      id: 'lost',
      name: 'Live lost',
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
      updatedAt: new Date('2026-06-30T00:00:00.000Z'),
    });
    const invalid = deal({ id: 'bad', dueDate: new Date(Number.NaN), name: 'Bad date' });
    const ancient = deal({
      id: 'ancient',
      name: 'Years ago',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      dueDate: new Date('2024-06-01T00:00:00.000Z'),
    });

    const marks = dealTimelineMarks([undated, today, future, won, lostStage, invalid, ancient], {
      from: FROM,
      now: NOW,
    });
    expect(marks.some((m) => m.id.endsWith(':overdue'))).toBe(false);
    expect(marks.map((m) => m.title)).toEqual([
      'Deal opened: No date',
      'Deal opened: Due today',
      'Deal opened: Still ahead',
      'Deal opened: Aritzia, Endpoint Refresh',
      'Won: Aritzia, Endpoint Refresh',
      'Deal opened: Live lost',
      'Lost: Live lost',
      'Deal opened: Bad date',
    ]);
    expect(marks.find((m) => m.id === 'op:won:close')?.summary).toBe('Closed won');
    expect(marks.find((m) => m.id === 'op:lost:close')?.summary).toBe('Closed lost');
  });
});
