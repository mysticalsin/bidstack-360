import { beforeEach, describe, expect, it, vi } from 'vitest';

import { capPage } from './crm-tools.helpers.js';
import { buildGroundedProposalDraft, proposalDraft } from './proposal-draft.js';

const { findFirst, taskFindMany, contactFindMany, noteFindMany, searchReferences } = vi.hoisted(
  () => ({
    findFirst: vi.fn(),
    taskFindMany: vi.fn(),
    contactFindMany: vi.fn(),
    noteFindMany: vi.fn(),
    searchReferences: vi.fn(),
  }),
);

vi.mock('@bidstack/db', () => ({
  prisma: {
    opportunity: { findFirst },
    task: { findMany: taskFindMany },
    contact: { findMany: contactFindMany },
    note: { findMany: noteFindMany },
  },
}));

vi.mock('../lib/reference-search.js', () => ({
  searchReferences,
}));

function completePage<T>(items: T[]) {
  return { items, limit: 3, truncated: false };
}

function taskPage<T>(items: T[], truncated = false) {
  return { items, limit: 5, truncated };
}

function contactPage<T>(items: T[], truncated = false) {
  return { items, limit: 5, truncated };
}

function notePage<T>(items: T[], truncated = false) {
  return { items, limit: 3, truncated };
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
      tasks: taskPage([
        {
          id: 'task-1',
          title: 'Confirm legal assumptions',
          status: 'open',
          dueDate: new Date('2026-06-10T00:00:00.000Z'),
        },
      ]),
      contacts: contactPage([
        {
          id: 'contact-1',
          name: 'Pat Sponsor',
          role: 'CIO',
          influence: 5,
          sentiment: 'warm',
          aiOptOut: false,
        },
      ]),
      notes: notePage([
        {
          id: 'note-1',
          title: 'Discovery call',
          bodyMd: 'Client wants a low-risk modernization path.',
          pinned: true,
          updatedAt: new Date('2026-06-05T12:00:00.000Z'),
        },
      ]),
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
      tasks: taskPage([]),
      contacts: contactPage([
        {
          id: 'contact-private',
          name: 'Private Person',
          role: 'General Counsel',
          influence: 70,
          sentiment: 'neutral',
          aiOptOut: true,
        },
      ]),
      notes: notePage([]),
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
      tasks: taskPage([]),
      contacts: contactPage([]),
      notes: notePage([]),
    });

    expect(result.markdown).toContain(
      'No probability is recorded. Do not treat that as a measured chance below 40%',
    );
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
      tasks: taskPage([]),
      contacts: contactPage([]),
      notes: notePage([]),
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
      tasks: taskPage([]),
      contacts: contactPage([]),
      notes: notePage([]),
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
      tasks: taskPage([]),
      contacts: contactPage([]),
      notes: notePage([]),
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
        tasks: taskPage([]),
        contacts: contactPage([]),
        notes: notePage([]),
      }),
    ).toThrow(/page of items, not a bare array/);
  });

  it('says a truncated task, contact, or note page is not the whole set and does not cite the probe', () => {
    // WHY: take 5, take 5, and take 3 used to read as every pursuit task, contact,
    // and note. The extra row is only a probe. A full page and a shorter list
    // keep the old sentence.
    const taskProbe = {
      id: 'task-6',
      title: 'Probe task that is not on the page',
      status: 'open',
      dueDate: null,
    };
    const contactProbe = {
      id: 'contact-6',
      name: 'Probe Contact',
      role: 'Buyer',
      influence: 1,
      sentiment: 'cold',
      aiOptOut: false,
    };
    const noteProbe = {
      id: 'note-4',
      title: 'Probe note that is not on the page',
      bodyMd: 'Do not cite this note.',
      pinned: false,
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const openTask = (n: number) => ({
      id: `task-${n}`,
      title: `Task ${n}`,
      status: 'open',
      dueDate: null as Date | null,
    });
    const buyer = (n: number) => ({
      id: `contact-${n}`,
      name: `Contact ${n}`,
      role: 'Buyer',
      influence: 5,
      sentiment: 'warm',
      aiOptOut: false,
    });
    const accountNote = (n: number) => ({
      id: `note-${n}`,
      title: `Note ${n}`,
      bodyMd: `Body ${n}`,
      pinned: n === 1,
      updatedAt: new Date('2026-06-05T12:00:00.000Z'),
    });
    const tasks = capPage([...[1, 2, 3, 4, 5].map(openTask), taskProbe], 5);
    const contacts = capPage([...[1, 2, 3, 4, 5].map(buyer), contactProbe], 5);
    const notes = capPage([...[1, 2, 3].map(accountNote), noteProbe], 3);
    expect(tasks).toEqual({
      items: [1, 2, 3, 4, 5].map((n) => expect.objectContaining({ id: `task-${n}` })),
      limit: 5,
      truncated: true,
    });
    expect(contacts).toMatchObject({ limit: 5, truncated: true });
    expect(contacts.items).toHaveLength(5);
    expect(notes).toMatchObject({ limit: 3, truncated: true });
    expect(notes.items).toHaveLength(3);

    const opportunity = {
      id: 'opp-pursuit',
      code: 'OP-2049',
      customer: 'Acme Bank',
      name: 'Payments Modernization',
      stage: 's2_sent',
      valueMicros: 2_500_000_000_000n,
      probability: 55,
      dueDate: new Date('2026-07-01T00:00:00.000Z'),
      industry: 'Financial Services',
      updatedAt: new Date('2026-06-06T12:00:00.000Z'),
    };
    const result = buildGroundedProposalDraft({
      opportunity,
      section: 'scope',
      sectionTitle: 'Scope',
      tone: 'consultative',
      references: completePage([]),
      tasks,
      contacts,
      notes,
    });
    const taskSentence =
      '- Pursuit tasks: Task 1 (Open); Task 2 (Open); Task 3 (Open); Task 4 (Open); Task 5 (Open).';
    const contactSentence =
      '- Stakeholders: Contact 1 (Buyer) influence 5/5 sentiment warm; Contact 2 (Buyer) influence 5/5 sentiment warm; Contact 3 (Buyer) influence 5/5 sentiment warm; Contact 4 (Buyer) influence 5/5 sentiment warm; Contact 5 (Buyer) influence 5/5 sentiment warm.';
    const noteSentence = 'Recent account note to account for: "Note 1" - Body 1';

    expect(result.markdown).toContain(`${taskSentence} This page is not every task.`);
    expect(result.markdown).toContain(`${contactSentence} This page is not every contact.`);
    expect(result.markdown).toContain(`${noteSentence}. This page is not every note.`);
    expect(result.markdown).not.toContain(taskProbe.title);
    expect(result.markdown).not.toContain(contactProbe.name);
    expect(result.markdown).not.toContain(noteProbe.title);
    expect(
      result.citations
        .filter((citation) => citation.type === 'task')
        .map((citation) => citation.docId),
    ).toEqual(['task-1', 'task-2', 'task-3', 'task-4', 'task-5']);
    expect(
      result.citations
        .filter((citation) => citation.type === 'contact')
        .map((citation) => citation.docId),
    ).toEqual(['contact-1', 'contact-2', 'contact-3', 'contact-4', 'contact-5']);
    expect(
      result.citations
        .filter((citation) => citation.type === 'note')
        .map((citation) => citation.docId),
    ).toEqual(['note-1', 'note-2', 'note-3']);

    const timeline = buildGroundedProposalDraft({
      opportunity,
      section: 'timeline',
      sectionTitle: 'Timeline',
      tone: 'consultative',
      references: completePage([]),
      tasks,
      contacts,
      notes,
    });
    expect(timeline.markdown).toContain(
      'Current open work items that should appear in the timeline: Task 1; Task 2; Task 3; Task 4; Task 5. This page is not every task.',
    );
    expect(timeline.markdown).not.toContain(taskProbe.title);

    const full = buildGroundedProposalDraft({
      opportunity,
      section: 'scope',
      sectionTitle: 'Scope',
      tone: 'consultative',
      references: completePage([]),
      tasks: capPage([1, 2, 3, 4, 5].map(openTask), 5),
      contacts: capPage([1, 2, 3, 4, 5].map(buyer), 5),
      notes: capPage([1, 2, 3].map(accountNote), 3),
    });
    expect(full.markdown).toContain(taskSentence);
    expect(full.markdown).toContain(contactSentence);
    expect(full.markdown).toContain(noteSentence);
    expect(full.markdown).not.toContain('not every task');
    expect(full.markdown).not.toContain('not every contact');
    expect(full.markdown).not.toContain('not every note');

    const short = buildGroundedProposalDraft({
      opportunity,
      section: 'scope',
      sectionTitle: 'Scope',
      tone: 'consultative',
      references: completePage([]),
      tasks: capPage([openTask(1)], 5),
      contacts: capPage([buyer(1)], 5),
      notes: capPage([accountNote(1)], 3),
    });
    expect(short.markdown).toContain('- Pursuit tasks: Task 1 (Open).');
    expect(short.markdown).toContain(
      '- Stakeholders: Contact 1 (Buyer) influence 5/5 sentiment warm.',
    );
    expect(short.markdown).toContain(noteSentence);
    expect(short.markdown).not.toContain('not every task');
    expect(short.markdown).not.toContain('not every contact');
    expect(short.markdown).not.toContain('not every note');
  });
});

describe('proposal.draft pursuit queries', () => {
  const ctx = { orgId: 'org-1', keyId: 'key-1', scopes: ['read'] } as never;
  const oppId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    findFirst.mockReset();
    taskFindMany.mockReset();
    contactFindMany.mockReset();
    noteFindMany.mockReset();
    searchReferences.mockReset();
    searchReferences.mockResolvedValue({
      references: { items: [], limit: 3, truncated: false },
    });
    findFirst.mockResolvedValue({
      id: oppId,
      code: 'OP-3001',
      customer: 'Acme Bank',
      name: 'Payments Modernization',
      stage: 's2_sent',
      pipelineStage: null,
      valueMicros: 1n,
      probability: 55,
      dueDate: new Date('2026-07-01T00:00:00.000Z'),
      industry: 'Financial Services',
      updatedAt: new Date('2026-06-06T12:00:00.000Z'),
      companyId: 'company-1',
    });
  });

  it('loads limit+1 and keeps the probe off a partial page', async () => {
    // WHY: the draft query must see one row past the page. That row sets
    // truncated and is not a citation. Fewer rows keep the old sentence.
    const tasks = [
      ...[1, 2, 3, 4, 5].map((n) => ({
        id: `task-${n}`,
        title: `Task ${n}`,
        status: 'open',
        dueDate: null,
      })),
      {
        id: 'task-6',
        title: 'Probe task that is not on the page',
        status: 'open',
        dueDate: null,
      },
    ];
    const contacts = [
      ...[1, 2, 3, 4, 5].map((n) => ({
        id: `contact-${n}`,
        name: `Contact ${n}`,
        role: 'Buyer',
        influence: 5,
        sentiment: 'warm',
        aiOptOut: false,
      })),
      {
        id: 'contact-6',
        name: 'Probe Contact',
        role: 'Buyer',
        influence: 1,
        sentiment: 'cold',
        aiOptOut: false,
      },
    ];
    const notes = [
      ...[1, 2, 3].map((n) => ({
        id: `note-${n}`,
        title: `Note ${n}`,
        bodyMd: `Body ${n}`,
        pinned: n === 1,
        updatedAt: new Date('2026-06-05T12:00:00.000Z'),
      })),
      {
        id: 'note-4',
        title: 'Probe note that is not on the page',
        bodyMd: 'Do not cite this note.',
        pinned: false,
        updatedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ];
    taskFindMany.mockImplementation(async (args: { take?: number }) =>
      tasks.slice(0, args.take ?? tasks.length),
    );
    contactFindMany.mockImplementation(async (args: { take?: number }) =>
      contacts.slice(0, args.take ?? contacts.length),
    );
    noteFindMany.mockImplementation(async (args: { take?: number }) =>
      notes.slice(0, args.take ?? notes.length),
    );

    const out = (await proposalDraft.handler(
      { oppId, section: 'scope', tone: 'consultative' },
      ctx,
    )) as { markdown: string; citations: Array<{ docId: string; type: string }> };

    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6 }));
    expect(contactFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6 }));
    expect(noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
    expect(out.markdown).toContain('This page is not every task.');
    expect(out.markdown).toContain('This page is not every contact.');
    expect(out.markdown).toContain('This page is not every note.');
    expect(out.markdown).not.toContain('Probe task that is not on the page');
    expect(out.markdown).not.toContain('Probe Contact');
    expect(out.markdown).not.toContain('Probe note that is not on the page');
    expect(out.citations.map((citation) => citation.docId)).not.toContain('task-6');
    expect(out.citations.map((citation) => citation.docId)).not.toContain('contact-6');
    expect(out.citations.map((citation) => citation.docId)).not.toContain('note-4');

    taskFindMany.mockResolvedValue([tasks[0]]);
    contactFindMany.mockResolvedValue([contacts[0]]);
    noteFindMany.mockResolvedValue([notes[0]]);
    const short = (await proposalDraft.handler(
      { oppId, section: 'scope', tone: 'consultative' },
      ctx,
    )) as { markdown: string };
    expect(taskFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 6 }));
    expect(short.markdown).toContain('- Pursuit tasks: Task 1 (Open).');
    expect(short.markdown).toContain(
      '- Stakeholders: Contact 1 (Buyer) influence 5/5 sentiment warm.',
    );
    expect(short.markdown).toContain('Recent account note to account for: "Note 1" - Body 1');
    expect(short.markdown).not.toContain('not every task');
    expect(short.markdown).not.toContain('not every contact');
    expect(short.markdown).not.toContain('not every note');
  });
});
