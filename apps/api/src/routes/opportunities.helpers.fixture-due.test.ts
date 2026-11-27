import { describe, expect, it } from 'vitest';

import { opportunityDueDateWhere } from './opportunities.helpers.js';

const NOW = new Date('2026-11-27T00:00:00.000Z');
const END = new Date('2026-12-04T00:00:00.000Z');

describe('opportunity due window and aged fixture dates', () => {
  it('includes the seeded Rush deal in the 7-day window only in demo', () => {
    // WHY: Closing this week filters in Postgres. Projecting the date after
    // the query still returns no rows once every fixture due date is past.
    expect(opportunityDueDateWhere({ dueWithinDays: 7 }, NOW, 'real')).toEqual({
      dueDate: { gte: NOW, lte: END },
    });

    const demo = opportunityDueDateWhere({ dueWithinDays: 7 }, NOW, 'demo');
    expect(demo).toEqual({
      AND: [
        {
          OR: [
            { dueDate: { gte: NOW, lte: END } },
            {
              code: 'OP-2043',
              dueDate: new Date('2026-06-30T00:00:00.000Z'),
              stage: { notIn: ['closed_won', 'closed_lost'] },
              OR: [{ pipelineStageId: null }, { pipelineStage: { isWon: false, isLost: false } }],
            },
          ],
        },
      ],
    });
  });

  it('does not call an aged open fixture deal overdue in demo', () => {
    expect(opportunityDueDateWhere({ overdue: true }, NOW, 'real')).toEqual({
      dueDate: { lt: NOW },
    });
    const demo = opportunityDueDateWhere({ overdue: true }, NOW, 'demo');
    const excluded = demo.AND?.[1];
    expect(demo.AND?.[0]).toEqual({ dueDate: { lt: NOW } });
    expect(excluded && 'NOT' in excluded ? excluded.NOT : null).toMatchObject({
      OR: expect.arrayContaining([
        expect.objectContaining({ code: 'OP-2043', dueDate: new Date('2026-06-30T00:00:00.000Z') }),
        expect.objectContaining({ code: 'OP-2044' }),
      ]),
    });
  });
});
