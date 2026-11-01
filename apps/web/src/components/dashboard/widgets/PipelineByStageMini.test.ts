import { describe, expect, it } from 'vitest';

import { openPipelineStages, pipelineHeadline, stageBarShares } from './pipeline-headline';

describe('openPipelineStages', () => {
  it('keeps closed won and lost out of the open pipeline chart', () => {
    const open = openPipelineStages([
      { stage: 'screening', count: 1, valueSum: 2_700_000 },
      { stage: 'closed_won', count: 4, valueSum: 9_000_000 },
      { stage: 'closed_lost', count: 2, valueSum: 1_000_000 },
    ]);

    expect(open.map((stage) => stage.stage)).toEqual(['screening']);
  });

  it('does not fold closed outcomes into the open pipeline', () => {
    // WHY: "total pipeline" used to add won and lost value into the open book.
    const headline = pipelineHeadline([
      { stage: 'screening', count: 1, valueSum: 2_700_000 },
      { stage: 'closed_won', count: 4, valueSum: 9_000_000 },
      { stage: 'closed_lost', count: 2, valueSum: 1_000_000 },
    ]);
    expect(headline.openValue).toBe(2_700_000);
    expect(headline.openCount).toBe(1);
    expect(headline.wonValue).toBe(9_000_000);
    expect(headline.lostValue).toBe(1_000_000);
    expect(headline.winRate).toBeCloseTo(4 / 6);
  });

  it('sizes stage bars from micros when the unit numbers collapse', () => {
    // WHY: the open chart divided valueSum. These two stages became one
    // number, so the shorter stage drew a full bar.
    const smaller = (9007199254740992n * 1_000_000n).toString();
    const larger = (9007199254740993n * 1_000_000n).toString();
    const collapsed = Number(9007199254740993n);
    expect(collapsed).toBe(9007199254740992);
    const shares = stageBarShares([
      { stage: 'proposal', count: 1, valueSum: collapsed, valueSumMicros: smaller },
      { stage: 'negotiation', count: 1, valueSum: collapsed, valueSumMicros: larger },
    ]);
    expect(shares[0]).toBeLessThan(shares[1]!);
    expect(shares[1]).toBe(100);
  });

  it('totals the open book from micros when the unit numbers collapse', () => {
    // WHY: adding the unit numbers made this book 18,014,398,509,481,984.
    // The recorded stages sum to one unit more.
    const smaller = (9007199254740992n * 1_000_000n).toString();
    const larger = (9007199254740993n * 1_000_000n).toString();
    const collapsed = Number(9007199254740993n);
    const headline = pipelineHeadline([
      { stage: 'proposal', count: 1, valueSum: collapsed, valueSumMicros: smaller },
      { stage: 'negotiation', count: 1, valueSum: collapsed, valueSumMicros: larger },
    ]);
    expect(headline.openMicros).toBe((9007199254740992n + 9007199254740993n) * 1_000_000n);
    expect(collapsed + collapsed).toBe(18_014_398_509_481_984);
  });
});
