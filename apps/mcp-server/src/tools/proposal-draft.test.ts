import { describe, expect, it } from 'vitest';

import { buildGroundedProposalDraft } from './proposal-draft.js';

describe('proposal.draft grounded builder', () => {
  it('returns a source-grounded section instead of a setup stub', () => {
    const result = buildGroundedProposalDraft({
      opportunity: {
        id: 'opp-1',
        code: 'OP-2042',
        customer: 'Acme Bank',
        name: 'Payments Modernization',
        stage: 's2_sent',
        valueMicros: 2_500_000_000_000n,
        probability: 55,
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        industry: 'Financial Services',
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      section: 'executive_summary',
      sectionTitle: 'Executive Summary',
      tone: 'consultative',
      references: [
        {
          id: 'ref-1',
          title: 'Core banking transformation reference',
          description: 'Reusable delivery proof point.',
          industry: 'Financial Services',
          valueEur: 1_200_000,
          usageCount: 4,
          documentUrl: 'https://example.com/reference',
          tags: ['banking'],
          scoreBps: 9000,
        },
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Confirm legal assumptions',
          status: 'open',
          dueDate: new Date('2026-06-10T00:00:00.000Z'),
        },
      ],
      contacts: [
        {
          id: 'contact-1',
          name: 'Pat Sponsor',
          role: 'CIO',
          influence: 90,
          sentiment: 'warm',
          aiOptOut: false,
        },
      ],
      notes: [
        {
          id: 'note-1',
          title: 'Discovery call',
          bodyMd: 'Client wants a low-risk modernization path.',
          pinned: true,
          updatedAt: new Date('2026-06-05T12:00:00.000Z'),
        },
      ],
    });

    expect(result.markdown).toContain('Source-grounded MCP draft');
    expect(result.markdown).toContain('Payments Modernization');
    expect(result.markdown).toContain('Core banking transformation reference');
    expect(result.markdown).toContain('Confirm legal assumptions');
    expect(result.markdown).not.toMatch(/stub|DUST_API_KEY|ANTHROPIC_API_KEY/i);
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ docId: 'opp-1', type: 'opportunity' }),
        expect.objectContaining({ docId: 'ref-1', type: 'reference' }),
        expect.objectContaining({ docId: 'task-1', type: 'task' }),
      ]),
    );
  });

  it('withholds opted-out contact names from generated text and citations', () => {
    const result = buildGroundedProposalDraft({
      opportunity: {
        id: 'opp-2',
        code: 'OP-2043',
        customer: 'Confidential Health',
        name: 'Security Program',
        stage: 's1_ongoing',
        valueMicros: 500_000_000_000n,
        probability: 35,
        dueDate: null,
        industry: 'Healthcare',
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      section: 'risks',
      sectionTitle: 'Risks',
      tone: 'executive',
      references: [],
      tasks: [],
      contacts: [
        {
          id: 'contact-private',
          name: 'Private Person',
          role: 'General Counsel',
          influence: 70,
          sentiment: 'neutral',
          aiOptOut: true,
        },
      ],
      notes: [],
    });

    expect(result.markdown).toContain('Opted-out stakeholder (PII withheld)');
    expect(result.markdown).not.toContain('Private Person');
    expect(result.markdown).not.toContain('General Counsel');
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docId: 'contact-private',
          title: 'Opted-out stakeholder',
          type: 'contact',
        }),
      ]),
    );
  });
});
