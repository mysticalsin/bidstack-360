import { describe, expect, it } from 'vitest';

import { buyingRoleSlots, classifyWorkstream, groupWorkstreams, type WorkDeal } from './accountWorkstreams';

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
      deal({ id: 'open', name: 'Core pursuit', stage: 'proposal', value: 4, owner: 'a@example.com' }),
    ]);

    expect(grouped.outcome.map((row) => row.id)).toEqual(['lost']);
    expect(grouped.pursuit.map((row) => row.id)).toEqual(['open']);
    expect(grouped.renewal).toEqual([]);
    expect(grouped.expansion).toEqual([]);
  });

  it('does not infer renewal or expansion from the opportunity name', () => {
    expect(
      classifyWorkstream(deal({ id: '1', name: 'Renewal of the expansion programme', stage: 'proposal' })),
    ).toBe('pursuit');
  });

  it('uses an explicit stage for renewal, expansion, and delivery', () => {
    expect(classifyWorkstream(deal({ id: 'r', name: 'FY plan', stage: 'renewal' }))).toBe('renewal');
    expect(classifyWorkstream(deal({ id: 'e', name: 'FY plan', stageName: 'Upsell' }))).toBe('expansion');
    expect(classifyWorkstream(deal({ id: 'd', name: 'FY plan', stage: 'customer' }))).toBe('delivery');
    expect(classifyWorkstream(deal({ id: 'w', name: 'FY plan', isWon: true, stage: 'proposal' }))).toBe(
      'outcome',
    );
  });

  it('leaves a missing buying role as an empty slot instead of inventing a person', () => {
    const slots = buyingRoleSlots([
      { id: 'p1', name: 'Ada', roleInDecision: 'buyer' },
      { id: 'p2', name: 'No role', roleInDecision: null },
    ]);
    expect(slots.find((slot) => slot.role === 'buyer')?.people.map((person) => person.name)).toEqual([
      'Ada',
    ]);
    expect(slots.find((slot) => slot.role === 'champion')?.people).toEqual([]);
    expect(slots.find((slot) => slot.role === 'champion')?.people.some((person) => person.name === 'No role')).toBe(
      false,
    );
  });
});
