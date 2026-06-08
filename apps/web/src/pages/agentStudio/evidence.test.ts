import { describe, expect, it } from 'vitest';

import { buildCrewEvidenceInput, type CrewEvidenceSnapshot } from './evidence';

function makeSnapshot(overrides: Partial<CrewEvidenceSnapshot> = {}): CrewEvidenceSnapshot {
  return {
    opportunityId: '11111111-1111-4111-8111-111111111111',
    documents: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'City modernization RFP',
        documentType: 'rfp',
        status: 'ready',
        updatedAt: '2026-06-07T18:00:00.000Z',
      },
    ],
    requirements: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        bidDocumentId: '22222222-2222-4222-8222-222222222222',
        sourceChunkId: '44444444-4444-4444-8444-444444444444',
        text: 'The vendor must provide SOC 2 Type II evidence before contract award.',
        requirementType: 'security',
        mandatory: true,
        priority: 'critical',
        status: 'suggested',
        confidenceBps: 9300,
      },
    ],
    ...overrides,
  };
}

describe('buildCrewEvidenceInput', () => {
  it('builds a cited crew input from persisted bid-workspace evidence', () => {
    const input = buildCrewEvidenceInput(makeSnapshot(), 'City modernization');

    expect(input).toMatchObject({
      opportunityId: '11111111-1111-4111-8111-111111111111',
      documentIds: '22222222-2222-4222-8222-222222222222',
      requirementIds: '33333333-3333-4333-8333-333333333333',
      evidenceSource: 'bid_workspace',
    });
    expect(input.rfp).toContain('[DOC:22222222-2222-4222-8222-222222222222]');
    expect(input.rfp).toContain('[REQ:33333333-3333-4333-8333-333333333333]');
    expect(input.rfp).toContain('[CHUNK:44444444-4444-4444-8444-444444444444]');
    expect(input.rfp).toContain('\nInstructions for agents:\n');
    expect(input.rfp).toContain('\nExtracted requirements (1 total, 1 included):\n');
    expect(input.rfp).toContain('flag it as a blocker instead of guessing');
  });

  it('bounds document and requirement evidence sent to the crew', () => {
    const snapshot = makeSnapshot({
      documents: Array.from({ length: 12 }, (_, index) => ({
        id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
        title: `Document ${index}`,
        documentType: 'attachment',
        status: 'ready',
        updatedAt: '2026-06-07T18:00:00.000Z',
      })),
      requirements: Array.from({ length: 35 }, (_, index) => ({
        id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
        bidDocumentId: null,
        sourceChunkId: null,
        text: `Requirement ${index} ${'x'.repeat(900)}`,
        requirementType: 'general',
        mandatory: false,
        priority: 'medium',
        status: 'suggested',
        confidenceBps: 7200,
      })),
    });

    const input = buildCrewEvidenceInput(snapshot, 'Large tender');

    expect(input.documentIds.split(',')).toHaveLength(10);
    expect(input.requirementIds.split(',')).toHaveLength(30);
    expect(input.rfp).toContain('Documents (12 total, 10 included)');
    expect(input.rfp).toContain('Extracted requirements (35 total, 30 included)');
    expect(input.rfp.length).toBeLessThanOrEqual(18_003);
  });
});
