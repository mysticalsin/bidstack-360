import { describe, expect, it } from 'vitest';

import { opportunityListWhere, weightedOpenMicros } from './opportunities.helpers';

describe('weightedOpenMicros', () => {
  it('weights every open row and drops a zero probability, including a value past 2^53', () => {
    // WHY: the list page holds 50 rows. A filtered total that sums only that
    // page under-reports the book, and a Number() sum corrupts past 2^53.
    const pageOne = {
      valueMicros: 1_240_000_000_000n,
      probability: 65,
      stage: 's3_technical_iteration',
      pipelineStage: null,
    };
    const pageTwo = {
      valueMicros: 8_598_204_328_457_184_962n,
      probability: 100,
      stage: 's2_sent',
      pipelineStage: null,
    };
    const unscored = {
      valueMicros: 500_000_000n,
      probability: 0,
      stage: 's1_lead',
      pipelineStage: null,
    };
    const lost = {
      valueMicros: 9_000_000_000_000n,
      probability: 100,
      stage: 'Price lost',
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
    };
    expect(weightedOpenMicros([pageOne, pageTwo, unscored, lost])).toBe(
      806_000_000_000n + 8_598_204_328_457_184_962n,
    );
  });

  it('truncates a partial percent and is unchanged when pages are concatenated', () => {
    // WHY: integer micros must not round a 1% slice up, and the paged fold
    // has to equal one pass over the same rows.
    const tiny = { valueMicros: 1n, probability: 1, stage: 's1_lead', pipelineStage: null };
    const half = { valueMicros: 100n, probability: 50, stage: 's1_lead', pipelineStage: null };
    expect(weightedOpenMicros([tiny])).toBe(0n);
    expect(weightedOpenMicros([half])).toBe(50n);
    const left = [half, tiny];
    const right = [{ valueMicros: 200n, probability: 25, stage: 's2_sent', pipelineStage: null }];
    expect(weightedOpenMicros([...left, ...right])).toBe(
      weightedOpenMicros(left) + weightedOpenMicros(right),
    );
  });
});

describe('opportunityListWhere', () => {
  it('uses the same search and due-date predicate the list uses', () => {
    // WHY: the summary must not invent a second filter. A search that the
    // list applies has to be the summary's where as well.
    const due = { gte: new Date('2026-11-01T00:00:00.000Z') };
    expect(
      opportunityListWhere({
        orgId: 'org-1',
        search: 'Acme',
        dueDate: due,
        pipelineStageId: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      orgId: 'org-1',
      deletedAt: null,
      pipelineStageId: '00000000-0000-4000-8000-000000000001',
      dueDate: due,
      OR: [
        { customer: { contains: 'Acme', mode: 'insensitive' } },
        { name: { contains: 'Acme', mode: 'insensitive' } },
        { code: { contains: 'Acme', mode: 'insensitive' } },
      ],
    });
  });
});
