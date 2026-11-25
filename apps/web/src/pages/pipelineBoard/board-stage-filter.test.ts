import { describe, expect, it } from 'vitest';

import { resolveBoardStageFilter } from './board-stage-filter';

const TECHNICAL_ID = '44444444-4444-4444-8444-444444444444';

describe('resolveBoardStageFilter', () => {
  it('opens the short-named column when the filter is the demo stage key', () => {
    // WHY: after a seeded bid sits in Technical Iteration, the column id is
    // the stage uuid. The opportunities list can still put s3_technical_iteration
    // in the shared filter. Matching only the column id draws no column, so
    // the board looks empty while that bid is on it.
    const resolved = resolveBoardStageFilter('s3_technical_iteration', [
      { id: TECHNICAL_ID, key: 's3_technical_iteration' },
      { id: '55555555-5555-4555-8555-555555555555', key: 's4_negotiation' },
    ]);

    expect(resolved).toEqual({ kind: 'column', id: TECHNICAL_ID });
  });

  it('keeps a column whose id is the filter when another column carries that key', () => {
    // WHY: an enum-only bid still opens a column whose id is the legacy key.
    // The short-named column carries the same key. Preferring the key would
    // hide the bid on the empty short-named column.
    const resolved = resolveBoardStageFilter('s3_technical_iteration', [
      { id: TECHNICAL_ID, key: 's3_technical_iteration' },
      { id: 's3_technical_iteration', key: null },
    ]);

    expect(resolved).toEqual({ kind: 'column', id: 's3_technical_iteration' });
  });

  it('says a filter matched no column instead of treating it as every column', () => {
    expect(
      resolveBoardStageFilter('00000000-0000-4000-8000-000000000099', [
        { id: TECHNICAL_ID, key: 's3_technical_iteration' },
      ]),
    ).toEqual({ kind: 'missing' });
    expect(resolveBoardStageFilter(null, [{ id: TECHNICAL_ID, key: 's3_technical_iteration' }])).toEqual({
      kind: 'all',
    });
  });
});
