import { describe, expect, it } from 'vitest';

import { recordedOutcome } from '../account-signals/load.js';

import { capDealSample, openDealWhere, openTotalUnits, POSITIONING_DEAL_SAMPLE, referenceWinWhere, sumMicrosAsNumber } from './micros';

describe('capDealSample', () => {
  it('keeps a short account book and does not call it a sample', () => {
    const rows = Array.from({ length: POSITIONING_DEAL_SAMPLE }, (_, index) => index);
    expect(capDealSample(rows)).toEqual({ rows, capped: false });
  });

  it('stops at 500 when one more deal exists', () => {
    // WHY: an unordered or silent take of 500 was shown as the whole open pipeline.
    const rows = Array.from({ length: POSITIONING_DEAL_SAMPLE + 1 }, (_, index) => index);
    const capped = capDealSample(rows);
    expect(capped.capped).toBe(true);
    expect(capped.rows).toHaveLength(POSITIONING_DEAL_SAMPLE);
  });
});

describe('sumMicrosAsNumber', () => {
  it('adds open deal micros without rounding a safe total', () => {
    expect(sumMicrosAsNumber([1_240_000_000_000n, 806_000_000_000n, null])).toBe(
      1_240_000_000_000 + 806_000_000_000,
    );
  });

  it('refuses a total that does not fit in a JavaScript number', () => {
    // WHY: Number(sum) past 2^53 made two different books look the same.
    const half = 5_000_000_000_000_000n;
    expect(sumMicrosAsNumber([half, half])).toBeNull();
  });

  it('keeps an exact total when each float conversion would drift', () => {
    // WHY: adding Number(micros) and still returning null only past the safe integer
    // leaves this pair as 2. The integer total is 3, and 3 fits in one number.
    const hi = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    const lo = -9_007_199_254_740_990n;
    expect(sumMicrosAsNumber([hi, lo])).toBe(3);
    expect(Number(hi) + Number(lo)).toBe(2);
  });

  it('keeps a negative micros total negative', () => {
    // WHY: a sum that drops the sign would show money owed as money held.
    expect(sumMicrosAsNumber([-1_500_000n, -500_000n])).toBe(-2_000_000);
    expect(sumMicrosAsNumber([1_000_000n, -2_500_000n])).toBe(-1_500_000);
  });

  it('turns EUR 10bn of micros into units that still fit on one tile', () => {
    // WHY: the safe-integer wall is about 9.007bn. The tile was saying the
    // amount did not fit, while the brief already said EUR 10.0bn.
    const tenBn = 10_000_000_000_000_000n;
    expect(sumMicrosAsNumber([tenBn])).toBeNull();
    expect(openTotalUnits(tenBn)).toBe(10_000_000_000);
  });
});

describe('openDealWhere', () => {
  it('matches recordedOutcome for open, and drops a live loss', () => {
    // WHY: the open total is an aggregate, so the where clause has to name
    // the same deals the page already calls open.
    const where = openDealWhere();
    const stages = ['s1_lead', 's2_sent', 'closed_won', 'closed_lost'] as const;
    for (const stage of stages) {
      for (const isWon of [false, true]) {
        for (const isLost of [false, true]) {
          for (const deleted of [false, true]) {
            const row = { isWon, isLost, deletedAt: deleted ? new Date('2026-02-01T00:00:00.000Z') : null };
            const deal = { stage, pipelineStage: row };
            expect(matchesWhere(where, deal)).toBe(recordedOutcome(deal) === 'open');
          }
        }
      }
      expect(matchesWhere(where, { stage, pipelineStage: null })).toBe(recordedOutcome({ stage, pipelineStage: null }) === 'open');
    }
  });
});

type StageRow = { isWon: boolean; isLost: boolean; deletedAt: Date | null } | null;

type DealShape = { stage: string; pipelineStage: StageRow };

/** The removed helper, written out so this file does not import it. */
function legacyWonOutcomeWhere() {
  return {
    NOT: {
      OR: [{ stage: 'closed_lost' }, { pipelineStage: { is: { deletedAt: null, isLost: true } } }],
    },
    OR: [
      { stage: 'closed_won' },
      { pipelineStage: { is: { deletedAt: null, isWon: true, isLost: false } } },
    ],
  };
}

function matchesWhere(where: object, deal: DealShape): boolean {
  const clause = where as Record<string, unknown>;
  const keys = Object.keys(clause);
  if (keys.length !== 1) return keys.every((key) => matchesWhere({ [key]: clause[key] }, deal));
  if (keys[0] === 'NOT') return !matchesWhere(clause.NOT as object, deal);
  if (keys[0] === 'OR' && Array.isArray(clause.OR)) return clause.OR.some((part) => matchesWhere(part as object, deal));
  if (keys[0] === 'stage') return deal.stage === clause.stage;
  if (keys[0] === 'pipelineStage') {
    const spec = (clause.pipelineStage as { is: { deletedAt: null; isLost?: boolean; isWon?: boolean } }).is;
    const row = deal.pipelineStage;
    if (!row || row.deletedAt != null) return false;
    if (spec.isLost != null && row.isLost !== spec.isLost) return false;
    if (spec.isWon != null && row.isWon !== spec.isWon) return false;
    return true;
  }
  return false;
}

describe('referenceWinWhere', () => {
  const stages = ['s1_lead', 's2_sent', 's3_technical_iteration', 's4_negotiation', 'closed_won', 'closed_lost'] as const;
  const flags = [false, true] as const;
  const shapes: DealShape[] = [];
  for (const stage of stages) {
    for (const isWon of flags) {
      for (const isLost of flags) {
        for (const deleted of flags) {
          shapes.push({
            stage,
            pipelineStage: { isWon, isLost, deletedAt: deleted ? new Date('2026-02-01T00:00:00.000Z') : null },
          });
        }
      }
    }
  }

  it('matches the old wonOutcomeWhere on 48 stage and flag shapes', () => {
    // WHY: swapping the won and lost clauses still returns a filter, and the sum tests never see it.
    expect(shapes).toHaveLength(48);
    const legacy = legacyWonOutcomeWhere();
    const current = referenceWinWhere();
    for (const shape of shapes) {
      expect(matchesWhere(current, shape)).toBe(matchesWhere(legacy, shape));
    }
    for (const isWon of flags) {
      for (const isLost of flags) {
        for (const deleted of flags) {
          const row = { isWon, isLost, deletedAt: deleted ? new Date('2026-02-01T00:00:00.000Z') : null };
          const lead = { stage: 's1_lead', pipelineStage: row };
          const ongoing = { stage: 's1_ongoing', pipelineStage: row };
          expect(matchesWhere(current, ongoing)).toBe(matchesWhere(legacy, lead));
        }
      }
    }
  });

  it('counts a live win and drops a live loss', () => {
    const current = referenceWinWhere();
    expect(matchesWhere(current, { stage: 'closed_won', pipelineStage: null })).toBe(true);
    expect(matchesWhere(current, { stage: 'closed_lost', pipelineStage: null })).toBe(false);
    expect(
      matchesWhere(current, {
        stage: 's3_technical_iteration',
        pipelineStage: { isWon: true, isLost: false, deletedAt: null },
      }),
    ).toBe(true);
    expect(
      matchesWhere(current, {
        stage: 'closed_won',
        pipelineStage: { isWon: true, isLost: true, deletedAt: null },
      }),
    ).toBe(false);
    expect(
      matchesWhere(current, {
        stage: 's3_technical_iteration',
        pipelineStage: { isWon: false, isLost: true, deletedAt: new Date('2026-02-01T00:00:00.000Z') },
      }),
    ).toBe(false);
  });
});
