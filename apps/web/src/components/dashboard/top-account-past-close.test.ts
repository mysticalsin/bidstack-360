import { describe, expect, it } from 'vitest';

import { topAccountPastClose } from './top-account-past-close';

const NOW = Date.parse('2026-11-25T15:00:00.000Z');

describe('topAccountPastClose', () => {
  it('sums only the open value the top-account chart draws', () => {
    // WHY: the chart keeps six accounts. Logistec is past close and still open,
    // but it is seventh, so 320k must not turn 11.57m into the whole-book 11.89m.
    // NOS is lost and is not on the bars. Aritzia is won, so its 410k stays won.
    const demo = [
      { id: 'ci', customer: 'CI Financial', stage: 's3_technical_iteration', value: 1_240_000, dueDate: '2026-07-22' },
      { id: 'logistec', customer: 'Logistec Corporation', stage: 's1_ongoing', value: 320_000, dueDate: '2026-08-15' },
      { id: 'rush', customer: 'Rush University System for Health', stage: 's4_negotiation', value: 4_800_000, dueDate: '2026-06-30' },
      { id: 'mapfre', customer: 'MAPFRE', stage: 's1_ongoing', value: 680_000, dueDate: '2026-09-30' },
      { id: 'mahle', customer: 'MAHLE', stage: 's2_sent', value: 2_150_000, dueDate: '2026-08-01' },
      { id: 'aritzia', customer: 'Aritzia', stage: 'closed_won', value: 410_000, dueDate: '2026-04-28' },
      { id: 'nos', customer: 'NOS', stage: 'closed_lost', value: 1_900_000, dueDate: '2026-04-12' },
      { id: 'dnb', customer: 'DNB Bank', stage: 's1_ongoing', value: 2_700_000, dueDate: '2026-09-15' },
    ];
    const slipped = topAccountPastClose(demo, NOW);
    expect(slipped.total).toBe(11_570_000);
    expect(slipped.accounts.map((account) => account.label)).toEqual([
      'Rush University System for Health',
      'DNB Bank',
      'MAHLE',
      'CI Financial',
      'MAPFRE',
    ]);
    expect(slipped.sentence).toBe(
      'Open value on this chart includes 11.57m past its close date (Rush University System for Health, DNB Bank, MAHLE, CI Financial and MAPFRE).',
    );
  });

  it('counts only the part of an account that is already past its close day', () => {
    // WHY: a later open bid and a won bid on the same account are not late money.
    const now = Date.parse('2026-11-07T12:00:00.000Z');
    const slipped = topAccountPastClose(
      [
        { id: 'late', customer: 'Mixed', stage: 's2_sent', value: 1_000_000, dueDate: '2026-06-01' },
        { id: 'future', customer: 'Mixed', stage: 's2_sent', value: 500_000, dueDate: '2026-12-01' },
        { id: 'won', customer: 'Mixed', stage: 'closed_won', value: 200_000, dueDate: '2026-01-01' },
        { id: 'today', customer: 'Due Today', stage: 's2_sent', value: 100_000, dueDate: '2026-11-07' },
        { id: 'blank', customer: 'Unscheduled', stage: 's1_ongoing', value: 80_000, dueDate: null },
      ],
      now,
    );
    expect(slipped.total).toBe(1_000_000);
    expect(slipped.byAccount.get('Due Today')).toBeUndefined();
    expect(slipped.byAccount.get('Unscheduled')).toBeUndefined();
    expect(slipped.sentence).toBe('Open value on this chart includes 1m past its close date (Mixed).');
  });
});
