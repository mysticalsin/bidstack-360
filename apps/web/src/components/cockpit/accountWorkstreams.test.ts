import { describe, expect, it } from 'vitest';

import {
  buyingRoleSlots,
  classifyWorkstream,
  groupWorkstreams,
  laneRecordedMicros,
  peopleWithoutDecisionRole,
  workstreamBarValues,
  type WorkDeal,
} from './accountWorkstreams';

function deal(overrides: Partial<WorkDeal> & Pick<WorkDeal, 'id' | 'name'>): WorkDeal {
  return {
    stage: null,
    value: 0,
    owner: null,
    ...overrides,
  };
}

describe('account workstreams stay independent', () => {
  it('keeps a lost pursuit off the live lanes so the account is not collapsed to lost', () => {
    const grouped = groupWorkstreams([
      deal({ id: 'lost', name: 'Renewable energy platform', stage: 'closed_lost', value: 10 }),
      deal({
        id: 'open',
        name: 'Core pursuit',
        stage: 'proposal',
        value: 4,
        owner: 'a@example.com',
      }),
    ]);

    expect(grouped.outcome.map((row) => row.id)).toEqual(['lost']);
    expect(grouped.pursuit.map((row) => row.id)).toEqual(['open']);
    expect(grouped.renewal).toEqual([]);
    expect(grouped.expansion).toEqual([]);
  });

  it('does not infer renewal or expansion from the opportunity name', () => {
    expect(
      classifyWorkstream(
        deal({ id: '1', name: 'Renewal of the expansion programme', stage: 'proposal' }),
      ),
    ).toBe('pursuit');
  });

  it('uses an explicit stage for renewal, expansion, and delivery', () => {
    expect(classifyWorkstream(deal({ id: 'r', name: 'FY plan', stage: 'renewal' }))).toBe(
      'renewal',
    );
    expect(classifyWorkstream(deal({ id: 'e', name: 'FY plan', stageName: 'Upsell' }))).toBe(
      'expansion',
    );
    expect(classifyWorkstream(deal({ id: 'd', name: 'FY plan', stage: 'customer' }))).toBe(
      'delivery',
    );
    expect(
      classifyWorkstream(deal({ id: 'w', name: 'FY plan', isWon: true, stage: 'proposal' })),
    ).toBe('outcome');
  });

  it('sizes lanes from integer micros when float calls the amounts equal', () => {
    // WHY: Number() collapses these two micros, so the bars used to match.
    const smaller = '9007199254740992';
    const larger = '9007199254740993';
    expect(Number(smaller) === Number(larger)).toBe(true);
    const [smallBar, largeBar, emptyBar] = workstreamBarValues([
      { value: Number(smaller), valueMicros: smaller },
      { value: Number(larger), valueMicros: larger },
      { value: 0, valueMicros: '0' },
    ]);
    expect(largeBar).toBe(100);
    expect(smallBar).toBeLessThan(100);
    expect(smallBar).toBeGreaterThan(99);
    expect(emptyBar).toBe(0);
  });

  it('adds a large micros deal to a lane that also has a unit amount', () => {
    // WHY: the lane dropped every micros string when one card had only a unit number.
    const total = laneRecordedMicros([
      deal({ id: 'big', name: 'Big', value: 0, valueMicros: '8598204328457184962' }),
      deal({ id: 'small', name: 'Small', value: 10_000 }),
    ]);
    expect(total).toBe(8_598_204_328_457_184_962n + 10_000_000_000n);
  });

  it('keeps unit shares when a lane has no micros string', () => {
    expect(
      workstreamBarValues([
        { value: 25, valueMicros: null },
        { value: 100, valueMicros: null },
        { value: 0, valueMicros: null },
      ]),
    ).toEqual([25, 100, 0]);
  });

  it('leaves a missing buying role as an empty slot instead of inventing a person', () => {
    const slots = buyingRoleSlots([
      { id: 'p1', name: 'Ada', roleInDecision: 'buyer' },
      { id: 'p2', name: 'No role', roleInDecision: null },
    ]);
    expect(
      slots.find((slot) => slot.role === 'buyer')?.people.map((person) => person.name),
    ).toEqual(['Ada']);
    expect(slots.find((slot) => slot.role === 'champion')?.people).toEqual([]);
    expect(
      slots
        .find((slot) => slot.role === 'champion')
        ?.people.some((person) => person.name === 'No role'),
    ).toBe(false);
    // WHY: hiding the person makes the account look like it has no one.
    // They stay visible, and they stay out of every role slot.
    expect(
      peopleWithoutDecisionRole([
        { id: 'p1', name: 'Ada', roleInDecision: 'buyer' },
        { id: 'p2', name: 'No role', roleInDecision: null },
      ]).map((person) => person.name),
    ).toEqual(['No role']);
  });
});
