import { describe, expect, it } from 'vitest';

import type { Opportunity } from '@bidstack/shared';

import { countBidsInFlight } from './opportunity-flight-count';

function row(
  patch: Pick<Opportunity, 'stage' | 'pipelineStage'> & Partial<Opportunity>,
): Opportunity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    code: 'OP-0001',
    customer: 'Siemens',
    name: 'Global ERP Modernization',
    pipelineStageId: null,
    value: 1_200_000,
    probability: 60,
    dueDate: '2026-12-01',
    owner: 'owner@example.com',
    industry: 'Manufacturing',
    logo: null,
    country: 'DE',
    territoryId: null,
    territoryName: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    taskCount: 0,
    commentCount: 0,
    viewCount: 0,
    ...patch,
  } as Opportunity;
}

const wonStage = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Awarded',
  probability: 100,
  color: null,
  isWon: true,
  isLost: false,
};

describe('countBidsInFlight', () => {
  it('keeps a won or lost demo bid out of the in-flight count', () => {
    // The demo book is Siemens, IKEA, Sanofi, and HSBC, plus Stellantis
    // (closed_won) and Spotify (closed_lost). The list still shows the closed
    // rows. "Bids in flight" is the open ones. A legacy stage string is enough:
    // those rows store no pipelineStage.
    const counts = countBidsInFlight([
      row({
        stage: 's3_technical_iteration',
        pipelineStage: null,
        name: 'Global ERP Modernization',
      }),
      row({
        id: '22222222-2222-2222-2222-222222222222',
        code: 'OP-0005',
        customer: 'Stellantis',
        name: 'EV Fleet Telematics',
        stage: 'closed_won',
        pipelineStage: null,
        probability: 100,
        value: 620_000,
      }),
      row({
        id: '33333333-3333-3333-3333-333333333333',
        code: 'OP-0006',
        customer: 'Spotify',
        name: 'Data Lakehouse Build',
        stage: 'closed_lost',
        pipelineStage: null,
        probability: 0,
        value: 430_000,
      }),
    ]);
    expect(counts).toEqual({ inFlight: 1, closed: 2 });
  });

  it('lets an attached won or lost flag beat a stale stage string', () => {
    // The row renders resolvePipelineStage, which prefers pipelineStage. A
    // subtitle that only reads the legacy enum would still call this bid open.
    const counts = countBidsInFlight([
      row({
        stage: 's3_technical_iteration',
        pipelineStage: wonStage,
        pipelineStageId: wonStage.id,
      }),
    ]);
    expect(counts).toEqual({ inFlight: 0, closed: 1 });
  });

  it('counts an attached open stage as in flight even when the enum says closed', () => {
    const counts = countBidsInFlight([
      row({
        stage: 'closed_won',
        pipelineStage: {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'Negotiation',
          probability: 80,
          color: null,
          isWon: false,
          isLost: false,
        },
        pipelineStageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ]);
    expect(counts).toEqual({ inFlight: 1, closed: 0 });
  });
});
