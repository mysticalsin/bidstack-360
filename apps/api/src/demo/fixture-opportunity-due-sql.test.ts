import { describe, expect, it } from 'vitest';

import { projectedOpportunityDueSql } from './fixture-opportunity-due-sql.js';

const AGED = new Date('2026-11-27T00:00:00.000Z');
const AHEAD = new Date('2026-06-28T00:00:00.000Z');

describe('projected opportunity due SQL', () => {
  it('keeps the stored column unless demo dates have aged', () => {
    // WHY: the aggregate reads due_date in Postgres. A serializer-only slide
    // would leave Closing-within-7 and the quarter buckets on the old dates.
    const real = projectedOpportunityDueSql(AGED, 'real');
    expect(real.strings.join('')).toBe('o.due_date');
    expect(real.values).toEqual([]);

    const ahead = projectedOpportunityDueSql(AHEAD, 'demo');
    expect(ahead.strings.join('')).toBe('o.due_date');

    const demo = projectedOpportunityDueSql(AGED, 'demo');
    const text = demo.strings.join('?');
    expect(text).toContain('WHEN o.code = ?');
    expect(text).toContain('CAST(? AS integer)');
    expect(text).toContain('ELSE o.due_date END');
    expect(demo.values).toContain('OP-2043');
    expect(demo.values).toContain('2026-06-30');
    expect(demo.values).not.toContain('OP-2046');
  });
});
