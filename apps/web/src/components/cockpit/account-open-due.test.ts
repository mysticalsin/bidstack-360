// The account header's "open deals" line is the first number a bid lead reads.
// Demo bids close in April–September 2026. On a later day they are still open,
// so a plain count reads as a current book. A date-only due day is UTC midnight:
// elapsed-millisecond rounding calls that day overdue after noon. The header
// must use the UTC calendar day, ignore a decided bid, and stay quiet when
// nothing open is late.
import { describe, expect, it } from 'vitest';

import { openBookDue } from './account-open-due';

const NOW = new Date('2026-11-25T18:00:00.000Z');

describe('openBookDue', () => {
  it('counts an open demo bid whose close day is already past, in whole UTC days', () => {
    // CI Financial — IT Modernization, still in technical iteration, due 2026-07-22.
    const book = openBookDue(
      [{ stage: 's3_technical_iteration', dueDate: '2026-07-22' }],
      NOW,
    );
    expect(book).toEqual({ open: 1, overdue: 1, oldestOverdueDays: 126 });
  });

  it('does not call a bid due today overdue after noon UTC', () => {
    // Elapsed rounding of UTC midnight against 18:00 is -1. The due day is today.
    const book = openBookDue([{ stage: 's2_sent', dueDate: '2026-11-25' }], NOW);
    expect(book).toEqual({ open: 1, overdue: 0, oldestOverdueDays: 0 });
  });

  it('leaves a won bid with a past due date out of the open book', () => {
    // Aritzia closed won on 2026-04-28. The clock stopped.
    const book = openBookDue(
      [
        { stage: 'closed_won', dueDate: '2026-04-28' },
        { stage: 's1_ongoing', dueDate: '2026-12-01' },
      ],
      NOW,
    );
    expect(book).toEqual({ open: 1, overdue: 0, oldestOverdueDays: 0 });
  });

  it('treats a configured won or lost stage as decided even when the legacy stage is still open', () => {
    const book = openBookDue(
      [
        {
          stage: 's4_negotiation',
          dueDate: '2026-06-30',
          pipelineStage: { isWon: false, isLost: true },
        },
      ],
      NOW,
    );
    expect(book.open).toBe(0);
    expect(book.overdue).toBe(0);
  });

  it('counts only the open rows that are late, and reports the oldest lateness', () => {
    const book = openBookDue(
      [
        { stage: 's1_ongoing', dueDate: '2026-08-15' },
        { stage: 's4_negotiation', dueDate: '2026-06-30' },
        { stage: 's2_sent', dueDate: '2026-12-20' },
        { stage: 's1_ongoing', dueDate: null },
      ],
      NOW,
    );
    expect(book.open).toBe(4);
    expect(book.overdue).toBe(2);
    // 2026-06-30 is further behind than 2026-08-15.
    expect(book.oldestOverdueDays).toBe(148);
  });
});
