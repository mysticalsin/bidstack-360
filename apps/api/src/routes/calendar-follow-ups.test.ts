import { describe, expect, it } from 'vitest';

import { followUpsInWindow, type FollowUpRow } from './calendar-follow-ups.js';

/**
 * WHY: a fresh demo org files open follow-ups on this week (pricing annex
 * three days out, security questionnaire four days out) and a finished
 * handover two days ago. The calendar week only reads bid and proposal due
 * dates, which sit 30 and 45 days out, so Saturday and Sunday paint empty
 * while Monday would keep a done row if every task were copied onto the lane.
 *
 * Window is the Monday-start week that contains 25 Nov 2026, exclusive end.
 */
const WEEK = { from: '2026-11-23', to: '2026-11-30' };

const IKEA = '11111111-1111-4111-8111-111111111111';
const HSBC = '22222222-2222-4222-8222-222222222222';
const DONE = '33333333-3333-4333-8333-333333333333';

function row(over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: IKEA,
    title: 'Prepare pricing annex for IKEA',
    status: 'open',
    dueDate: new Date('2026-11-28T00:00:00.000Z'),
    ...over,
  };
}

describe('followUpsInWindow', () => {
  it('puts this week open demo follow-ups on the day they are due', () => {
    const items = followUpsInWindow(
      [
        row(),
        row({
          id: HSBC,
          title: 'Security questionnaire response',
          status: 'in_progress',
          dueDate: new Date('2026-11-29T00:00:00.000Z'),
        }),
      ],
      WEEK,
    );
    expect(items).toEqual([
      {
        kind: 'follow_up',
        id: IKEA,
        name: 'Prepare pricing annex for IKEA',
        customer: null,
        code: null,
        dueDate: '2026-11-28',
      },
      {
        kind: 'follow_up',
        id: HSBC,
        name: 'Security questionnaire response',
        customer: null,
        code: null,
        dueDate: '2026-11-29',
      },
    ]);
  });

  it('leaves a finished follow-up off the lane so its day does not keep a stale chip', () => {
    const items = followUpsInWindow(
      [
        row({
          id: DONE,
          title: 'Kickoff handover to delivery',
          status: 'done',
          dueDate: new Date('2026-11-23T00:00:00.000Z'),
        }),
      ],
      WEEK,
    );
    expect(items).toEqual([]);
  });

  it('does not paint a follow-up on the day after the visible week', () => {
    const items = followUpsInWindow(
      [
        row({
          id: HSBC,
          title: 'Finalize technical volume',
          status: 'open',
          dueDate: new Date('2026-11-30T00:00:00.000Z'),
        }),
      ],
      WEEK,
    );
    expect(items).toEqual([]);
  });

  it('does not grow a blank chip when the title is empty', () => {
    const [item] = followUpsInWindow([row({ title: '   ' })], WEEK);
    expect(item?.name).toBe('Follow-up');
    expect(item?.name.trim()).not.toBe('');
  });

  it('keeps a blocked follow-up on its day', () => {
    const [item] = followUpsInWindow(
      [row({ status: 'blocked', dueDate: new Date('2026-11-25T00:00:00.000Z') })],
      WEEK,
    );
    expect(item).toMatchObject({ dueDate: '2026-11-25', name: 'Prepare pricing annex for IKEA' });
  });
});
