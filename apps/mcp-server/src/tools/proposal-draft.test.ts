import { describe, expect, it } from 'vitest';

import { capPage } from './crm-tools.helpers.js';
import { buildGroundedProposalDraft } from './proposal-draft.js';

function completePage<T>(items: T[]) {
  return { items, limit: 3, truncated: false };
}

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
      references: completePage([
        {
          id: 'ref-1',
          title: 'Core banking transformation reference',
          description: 'Reusable delivery proof point.',
          industry: 'Financial Services',
          valueMicros: '1200000000000',
          usageCount: 4,
          documentUrl: 'https://example.com/reference',
          tags: ['banking'],
          scoreBps: 9000,
        },
      ]),
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
          influence: 5,
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
    expect(result.markdown).toContain('unspecified');
    expect(result.markdown).not.toMatch(/EUR|€/);
    expect(result.markdown).toContain('Core banking transformation reference');
    expect(result.markdown).toContain('Confirm legal assumptions');
    expect(result.markdown).toContain('influence 5/5');
    expect(result.markdown).toContain('S2 Sent');
    expect(result.markdown).toContain('stored probability is 55%');
    expect(result.markdown).not.toContain('s2_sent');
    expect(result.markdown).not.toMatch(/\/100|stage probability/);
    expect(result.markdown).not.toMatch(/stub|DUST_API_KEY|ANTHROPIC_API_KEY/i);
    expect(result.markdown).not.toContain('not every match');
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
      references: completePage([]),
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

    expect(result.markdown).toContain('Stored probability is below 40%');
    expect(result.markdown).not.toMatch(/win probability/i);
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

  it('does not treat a stored zero as a measured chance below 40', () => {
    const result = buildGroundedProposalDraft({
      opportunity: {
        id: 'opp-3',
        code: 'OP-2044',
        customer: 'Northwind',
        name: 'Ledger Refresh',
        stage: 's1_lead',
        valueMicros: 2_000_000n,
        probability: 0,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      section: 'risks',
      sectionTitle: 'Risks',
      tone: 'concise',
      references: completePage([]),
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(result.markdown).toContain('No probability is recorded. Do not treat that as a measured chance below 40%');
    expect(result.markdown).not.toContain('Stored probability is below 40%');
    expect(result.markdown).not.toMatch(/0% probability|stored probability is 0%/i);
    expect(result.markdown).toContain('probability not recorded');
  });

  it('names a both-flagged live stage as lost', () => {
    const result = buildGroundedProposalDraft({
      opportunity: {
        id: 'opp-4',
        code: 'OP-2045',
        customer: 'Contoso',
        name: 'Cloud Exit',
        stage: 'Won and lost',
        stageKey: 'closed_won',
        pipelineStage: { isWon: true, isLost: true, deletedAt: null },
        valueMicros: 9_000_000n,
        probability: 80,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      section: 'executive_summary',
      sectionTitle: 'Executive Summary',
      tone: 'executive',
      references: completePage([]),
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(result.markdown).toContain('recorded "Cloud Exit" as lost');
    expect(result.markdown).not.toContain('is evaluating');
    expect(result.markdown).not.toContain('recorded "Cloud Exit" as won');
    expect(result.markdown).toContain('stored probability is 80%');
  });

  it('ignores win and loss flags on a deleted stage', () => {
    const result = buildGroundedProposalDraft({
      opportunity: {
        id: 'opp-5',
        code: 'OP-2046',
        customer: 'Fabrikam',
        name: 'Data Platform',
        stage: 'Archived Lost',
        stageKey: 's2_sent',
        pipelineStage: {
          isWon: true,
          isLost: true,
          deletedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        valueMicros: 1_000_000n,
        probability: 50,
        dueDate: new Date('2026-09-01T00:00:00.000Z'),
        industry: null,
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      section: 'executive_summary',
      sectionTitle: 'Executive Summary',
      tone: 'consultative',
      references: completePage([]),
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(result.markdown).toContain('is evaluating');
    expect(result.markdown).toContain('S2 Sent');
    expect(result.markdown).not.toContain('Archived Lost');
    expect(result.markdown).not.toContain('as lost');
    expect(result.markdown).not.toContain('as won');
  });

  it('says a truncated reference page is not every match and does not cite the probe row', () => {
    // WHY: a full page of three proof points used to read as the whole library.
    // The extra row is only a probe. Draft text and citations stay on items.
    const probe = {
      id: 'ref-probe',
      title: 'Probe reference that is not on the page',
      description: null,
      industry: null,
      valueMicros: null,
      usageCount: 0,
      documentUrl: null,
      tags: [] as string[],
      scoreBps: 1,
    };
    const page = capPage(
      [
        {
          id: 'ref-a',
          title: 'Alpha proof',
          description: null,
          industry: null,
          valueMicros: null,
          usageCount: 3,
          documentUrl: null,
          tags: [] as string[],
          scoreBps: 9000,
        },
        {
          id: 'ref-b',
          title: 'Beta proof',
          description: null,
          industry: null,
          valueMicros: null,
          usageCount: 2,
          documentUrl: null,
          tags: [] as string[],
          scoreBps: 8000,
        },
        {
          id: 'ref-c',
          title: 'Gamma proof',
          description: null,
          industry: null,
          valueMicros: null,
          usageCount: 1,
          documentUrl: null,
          tags: [] as string[],
          scoreBps: 7000,
        },
        probe,
      ],
      3,
    );
    expect(Array.isArray(page)).toBe(false);
    expect(page).toEqual({
      items: [
        expect.objectContaining({ id: 'ref-a' }),
        expect.objectContaining({ id: 'ref-b' }),
        expect.objectContaining({ id: 'ref-c' }),
      ],
      limit: 3,
      truncated: true,
    });

    const result = buildGroundedProposalDraft({
      opportunity: {
        id: 'opp-page',
        code: 'OP-2047',
        customer: 'Acme Bank',
        name: 'Payments Modernization',
        stage: 's2_sent',
        valueMicros: 2_500_000_000_000n,
        probability: 55,
        dueDate: new Date('2026-07-01T00:00:00.000Z'),
        industry: 'Financial Services',
        updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      },
      section: 'pricing',
      sectionTitle: 'Pricing',
      tone: 'consultative',
      references: page,
      tasks: [],
      contacts: [],
      notes: [],
    });

    expect(result.markdown).toContain(
      '- References: Alpha proof; Beta proof; Gamma proof. This page is not every match.',
    );
    expect(result.markdown).toContain(
      'Benchmark against "Alpha proof", "Beta proof", "Gamma proof". This page is not every match.',
    );
    expect(result.markdown).not.toContain('before final sign-off');
    expect(result.markdown).not.toContain(probe.title);
    expect(
      result.citations
        .filter((citation) => citation.type === 'reference')
        .map((citation) => citation.docId),
    ).toEqual(['ref-a', 'ref-b', 'ref-c']);
  });

  it('does not draft from a bare reference array', () => {
    // WHY: a bare array of limit+1 rows hides the probe inside the cited set.
    expect(() =>
      buildGroundedProposalDraft({
        opportunity: {
          id: 'opp-bare',
          code: 'OP-2048',
          customer: 'Acme Bank',
          name: 'Payments Modernization',
          stage: 's2_sent',
          valueMicros: 1n,
          probability: 55,
          dueDate: null,
          industry: null,
          updatedAt: new Date('2026-06-06T12:00:00.000Z'),
        },
        section: 'executive_summary',
        sectionTitle: 'Executive Summary',
        tone: 'consultative',
        references: [
          {
            id: 'ref-a',
            title: 'Alpha proof',
            description: null,
            industry: null,
            valueMicros: null,
            usageCount: 1,
            documentUrl: null,
            tags: [],
            scoreBps: 1,
          },
        ] as never,
        tasks: [],
        contacts: [],
        notes: [],
      }),
    ).toThrow(/page of items, not a bare array/);
  });
});
