import { describe, expect, it } from 'vitest';

import {
  accountDistributionIsEmpty,
  formatInsightAmount,
  pipelineIsEmpty,
  resolveSharedCurrency,
  shapeAccountDistribution,
  shapeCompanyRelationships,
  shapePipelineByStage,
  UNSPECIFIED_CURRENCY_LABEL,
} from './shapeInsights';
import type { Opportunity } from '@bidstack/shared';

const opportunity = (patch: Partial<Opportunity> & { currency?: string | null }): Opportunity & {
  currency?: string | null;
} => ({
  id: '11111111-1111-4111-8111-111111111111',
  code: 'OP-1001',
  customer: 'Acme',
  name: 'Rollout',
  stage: 's2_sent',
  pipelineStageId: null,
  pipelineStage: null,
  value: 120_000,
  probability: 40,
  dueDate: null,
  owner: null,
  industry: null,
  logo: null,
  country: null,
  territoryId: null,
  territoryName: null,
  updatedAt: '2026-06-03T00:00:00.000Z',
  taskCount: 0,
  commentCount: 0,
  viewCount: 0,
  ...patch,
});

describe('insight amounts stay honest about currency', () => {
  it('labels the figure unspecified when the API does not send a currency, instead of assuming EUR', () => {
    const visual = shapePipelineByStage([opportunity({})]);
    const label = formatInsightAmount(visual.stages[0]!.amount, visual.currency);

    expect(visual.currency).toBeNull();
    expect(label).toContain(UNSPECIFIED_CURRENCY_LABEL);
    expect(label).not.toMatch(/EUR|€/);
    expect(label).toContain('120,000');
  });

  it('uses a currency only when every opportunity in the total carries that same code', () => {
    const visual = shapePipelineByStage([
      opportunity({ currency: 'cad' }),
      opportunity({
        id: '22222222-2222-4222-8222-222222222222',
        code: 'OP-1002',
        value: 30,
        currency: 'CAD',
      }),
    ]);

    expect(visual.currency).toBe('CAD');
    expect(formatInsightAmount(visual.stages[0]!.amount, visual.currency)).toMatch(/CA\$|CAD/);
    expect(visual.stages[0]!.amount).toBe(120_030);
    expect(visual.stages[0]!.count).toBe(2);
  });

  it('refuses a single currency when any row omits one, so mixed books are not converted', () => {
    expect(
      resolveSharedCurrency([{ currency: 'EUR' }, { currency: null }, { currency: 'EUR' }]),
    ).toBeNull();
    expect(resolveSharedCurrency([{ currency: 'EUR' }, { currency: 'USD' }])).toBeNull();
    expect(formatInsightAmount(10, null)).toBe(`10 ${UNSPECIFIED_CURRENCY_LABEL}`);
  });
});

describe('pipeline empty state', () => {
  it('has no stages when there are no opportunities, so the chart can render empty instead of a zero funnel', () => {
    const visual = shapePipelineByStage([]);
    expect(pipelineIsEmpty(visual)).toBe(true);
    expect(visual.stages).toEqual([]);
    expect(visual.currency).toBeNull();
  });

  it('counts only stages that actually hold opportunities', () => {
    const visual = shapePipelineByStage([opportunity({ stage: 's1_lead', value: 0 })]);
    expect(visual.stages).toEqual([
      expect.objectContaining({ id: 's1_lead', count: 1, amount: 0 }),
    ]);
    expect(visual.stages.some((stage) => stage.count === 0)).toBe(false);
  });
});

describe('account distribution', () => {
  it('counts a blank industry as Unspecified so those companies are not dropped', () => {
    const slices = shapeAccountDistribution([
      { industry: 'technology' },
      { industry: null },
      { industry: '  ' },
      { industry: 'technology' },
    ]);
    expect(slices).toEqual([
      { key: 'technology', label: 'technology', count: 2 },
      { key: 'Unspecified', label: 'Unspecified', count: 2 },
    ]);
  });

  it('is empty when the company list is empty', () => {
    const slices = shapeAccountDistribution([]);
    expect(accountDistributionIsEmpty(slices)).toBe(true);
  });
});

describe('company relationship diagram', () => {
  it('draws one unweighted link per linked contact and invents no amount', () => {
    const diagram = shapeCompanyRelationships('Acme', [
      { id: 'c1', name: 'Ada Lovelace', role: 'CFO' },
      { id: 'c2', name: 'Grace Hopper', role: null },
    ]);
    expect(diagram).toEqual({
      companyName: 'Acme',
      nodes: [
        { name: 'Acme', category: 'source' },
        { name: 'Ada Lovelace', category: 'outcome' },
        { name: 'Grace Hopper', category: 'outcome' },
      ],
      links: [
        { source: 0, target: 1, value: 1, contactId: 'c1' },
        { source: 0, target: 2, value: 1, contactId: 'c2' },
      ],
    });
  });

  it('returns null when no contacts are linked, which is the empty diagram', () => {
    expect(shapeCompanyRelationships('Acme', [])).toBeNull();
  });
});
