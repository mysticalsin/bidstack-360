import { describe, expect, it } from 'vitest';

import { serializeOpportunity } from './opportunity.js';

describe('serializeOpportunity', () => {
  it('keeps value exact past the Number(bigint)/1e6 cliff', () => {
    // WHY: E4. Number(9_007_199_254_740_993n) / 1e6 rounds the BigInt first
    // and returns a different dollar amount than the stored micros.
    const micros = 9_007_199_254_740_993n;
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      code: 'OP-2041',
      customer: 'Precision Corp',
      name: 'Precision deal',
      stage: 's1_lead' as const,
      pipelineStageId: null,
      pipelineStage: null,
      valueMicros: micros,
      probability: 50,
      dueDate: null,
      industry: null,
      logoUrl: null,
      country: null,
      territoryId: null,
      updatedAt: new Date('2026-11-02T00:00:00.000Z'),
      closedAt: null,
      viewCount: 0,
      owner: null,
    };

    const naive = Number(micros) / 1_000_000;
    expect(naive).not.toBe(9_007_199_254.740993);
    expect(serializeOpportunity(row).value).toBe(9_007_199_254.740993);
  });

  it('passes the company id through so the bid can open that account', () => {
    // WHY: demo bids such as OP-2041 are filed on a company row. The list
    // payload omitted that id, so the customer name could not open the cockpit.
    const companyId = '00000000-0000-4000-8000-0000000000aa';
    const row = {
      id: '00000000-0000-4000-8000-000000000001',
      code: 'OP-2041',
      customer: 'CI Financial',
      name: 'IT Modernization',
      stage: 's3_technical_iteration' as const,
      pipelineStageId: null,
      pipelineStage: null,
      valueMicros: 1_240_000_000_000n,
      probability: 65,
      dueDate: new Date('2026-07-22T00:00:00.000Z'),
      industry: null,
      logoUrl: null,
      country: 'CA',
      territoryId: null,
      updatedAt: new Date('2026-11-02T00:00:00.000Z'),
      closedAt: null,
      viewCount: 0,
      owner: null,
      companyId,
    };

    expect(serializeOpportunity(row).companyId).toBe(companyId);
    expect(serializeOpportunity({ ...row, companyId: null }).companyId).toBeNull();
  });
});
