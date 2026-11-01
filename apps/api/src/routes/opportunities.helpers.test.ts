import { describe, expect, it } from 'vitest';

import {
  patchedValueMicros,
  rememberCompanyName,
  stageMoveDiff,
  weightedOpenMicros,
} from './opportunities.helpers';

describe('weightedOpenMicros', () => {
  it('weights the whole open book from integer micros, including rows past the first page', () => {
    // WHY: the list page holds 50 rows. A filtered total that sums only that page
    // under-reports the book as soon as a next cursor exists.
    const pageOne = { valueMicros: 1_240_000_000_000n, probability: 65 };
    const pageTwo = { valueMicros: 8_598_204_328_457_184_962n, probability: 100 };
    const unscored = { valueMicros: 500_000_000n, probability: 0 };
    expect(weightedOpenMicros([pageOne, pageTwo, unscored])).toBe(
      806_000_000_000n + 8_598_204_328_457_184_962n,
    );
  });
});

describe('patchedValueMicros', () => {
  it('keeps an explicit micros string instead of rounding the unit number', () => {
    // WHY: Math.round(value * 1e6) cannot store this amount.
    const micros = '8598204328457184962';
    expect(patchedValueMicros({ value: 1, valueMicros: micros })).toBe(BigInt(micros));
    expect(patchedValueMicros({ value: 2 })).toBe(2_000_000n);
    expect(patchedValueMicros({ value: 54_857_000_000 })).toBe(54_857_000_000_000_000n);
    expect(patchedValueMicros({})).toBeUndefined();
  });
});

describe('stageMoveDiff', () => {
  it('records a lost move so a patch cannot drop the stage event', () => {
    expect(
      stageMoveDiff(
        { stage: 's4_negotiation', pipelineStageId: 'stage-old' },
        { stage: 'closed_lost', pipelineStageId: 'stage-lost' },
      ),
    ).toEqual({
      fromStage: 's4_negotiation',
      toStage: 'closed_lost',
      fromPipelineStageId: 'stage-old',
      toPipelineStageId: 'stage-lost',
    });
  });

  it('does not link a customer name that matches two companies', () => {
    // WHY: first-match used to attach the deal to whichever company was
    // loaded first. Two names that normalize the same are not a link.
    const index = new Map<string, string | null>();
    rememberCompanyName(index, { id: 'a', name: 'Acme Inc' });
    rememberCompanyName(index, { id: 'b', name: 'Acme, Inc.' });
    expect(index.get('acme-inc')).toBeNull();
    rememberCompanyName(index, { id: 'c', name: 'Only One' });
    expect(index.get('only-one')).toBe('c');
  });

  it('does not emit an event when the stage is unchanged', () => {
    expect(
      stageMoveDiff(
        { stage: 's2_sent', pipelineStageId: 'stage-1' },
        { stage: 's2_sent', pipelineStageId: 'stage-1' },
      ),
    ).toBeNull();
  });
});
