import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { searchReferences, type RankedReference } from '../lib/reference-search.js';

import type { Tool } from './index.js';

const Section = z.enum(['executive_summary', 'scope', 'pricing', 'timeline', 'risks']);
const Tone = z.enum(['consultative', 'concise', 'technical', 'executive']);

const Input = z.object({
  oppId: z.string().uuid(),
  section: Section,
  tone: Tone.default('consultative'),
});

export const proposalDraft: Tool<typeof Input> = {
  description:
    'Drafts a grounded proposal section from CRM opportunity context, account notes, tasks, contacts, and the Mantu reference library.',
  input: Input,
  inputJsonSchema: {
    type: 'object',
    required: ['oppId', 'section'],
    properties: {
      oppId: { type: 'string', format: 'uuid' },
      section: { type: 'string', enum: Section.options },
      tone: { type: 'string', enum: Tone.options, default: 'consultative' },
    },
    additionalProperties: false,
  },
  handler: async (args, ctx) => {
    const opp = await prisma.opportunity.findFirst({
      where: { id: args.oppId, orgId: ctx.orgId, deletedAt: null },
    });
    if (!opp) throw new Error('Opportunity not found');

    const sectionTitle = args.section
      .split('_')
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join(' ');

    const [references, tasks, contacts, notes] = await Promise.all([
      searchReferences(
        ctx.orgId,
        [opp.customer, opp.name, opp.industry, sectionTitle].filter(Boolean).join(' - '),
        { limit: 3 },
      )
        .then((result) => result.references)
        .catch(() => []),
      prisma.task.findMany({
        where: { orgId: ctx.orgId, oppId: opp.id, deletedAt: null },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 5,
        select: { id: true, title: true, status: true, dueDate: true },
      }),
      prisma.contact.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          OR: [{ customer: opp.customer }, ...(opp.companyId ? [{ companyId: opp.companyId }] : [])],
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          role: true,
          influence: true,
          sentiment: true,
          aiOptOut: true,
        },
      }),
      prisma.note.findMany({
        where: {
          orgId: ctx.orgId,
          deletedAt: null,
          OR: [{ accountId: opp.customer }, ...(opp.companyId ? [{ companyId: opp.companyId }] : [])],
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 3,
        select: { id: true, title: true, bodyMd: true, pinned: true, updatedAt: true },
      }),
    ]);

    return buildGroundedProposalDraft({
      opportunity: {
        id: opp.id,
        code: opp.code,
        customer: opp.customer,
        name: opp.name,
        stage: opp.stage,
        valueMicros: opp.valueMicros,
        probability: opp.probability,
        dueDate: opp.dueDate,
        industry: opp.industry,
        updatedAt: opp.updatedAt,
      },
      section: args.section,
      sectionTitle,
      tone: args.tone,
      references,
      tasks,
      contacts,
      notes,
    });
  },
};

interface DraftOpportunity {
  id: string;
  code: string;
  customer: string;
  name: string;
  stage: string;
  valueMicros: bigint | number;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  updatedAt: Date;
}

interface DraftTask {
  id: string;
  title: string;
  status: string;
  dueDate: Date | null;
}

interface DraftContact {
  id: string;
  name: string;
  role: string | null;
  influence: number | null;
  sentiment: string | null;
  aiOptOut: boolean;
}

interface DraftNote {
  id: string;
  title: string;
  bodyMd: string;
  pinned: boolean;
  updatedAt: Date;
}

interface GroundedDraftInput {
  opportunity: DraftOpportunity;
  section: z.infer<typeof Section>;
  sectionTitle: string;
  tone: z.infer<typeof Tone>;
  references: RankedReference[];
  tasks: DraftTask[];
  contacts: DraftContact[];
  notes: DraftNote[];
}

interface DraftCitation {
  docId: string;
  title: string;
  type: 'opportunity' | 'reference' | 'task' | 'contact' | 'note';
  sourceUrl?: string;
}

function formatMoneyMicros(valueMicros: bigint | number): string {
  const value = Number(valueMicros) / 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : 'not yet confirmed';
}

function summarizeNote(note: DraftNote): string {
  const compact = note.bodyMd.replace(/[#*_`>[\]()]/g, '').replace(/\s+/g, ' ').trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function formatStakeholder(contact: DraftContact): string {
  if (contact.aiOptOut) return 'Opted-out stakeholder (PII withheld)';
  return [
    contact.name,
    contact.role ? `(${contact.role})` : '',
    contact.influence !== null ? `influence ${contact.influence}/100` : '',
    contact.sentiment ? `sentiment ${contact.sentiment}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function sectionBody(input: GroundedDraftInput): string[] {
  const { opportunity, references, tasks, contacts, notes } = input;
  const value = formatMoneyMicros(opportunity.valueMicros);
  const due = formatDate(opportunity.dueDate);
  const refLine = references[0]
    ? `The strongest reusable proof point is "${references[0].title}", which should be adapted to ${opportunity.customer}'s context.`
    : 'No reusable reference has been selected yet, so the team should validate proof points before submission.';
  const activeTasks = tasks.filter((task) => task.status !== 'done');
  const stakeholderLine = contacts.length
    ? `Known stakeholder context: ${contacts.map(formatStakeholder).join('; ')}.`
    : 'Stakeholder mapping is incomplete and should be confirmed before final submission.';

  if (input.section === 'executive_summary') {
    return [
      `${opportunity.customer} is evaluating "${opportunity.name}" at the ${opportunity.stage} stage. The current CRM value is ${value}, probability is ${opportunity.probability}%, and the response deadline is ${due}.`,
      `Mantu should lead with a concise business case: reduce delivery risk, accelerate decision-making, and give ${opportunity.customer} a governed implementation path that executives can trust.`,
      `${refLine} ${stakeholderLine}`,
      `Recommended next step: align the proposal narrative to the open pursuit tasks${
        activeTasks.length ? `, especially "${activeTasks[0]?.title}"` : ''
      }, then run legal, finance, and delivery review before approval.`,
    ];
  }

  if (input.section === 'scope') {
    return [
      `The proposed scope for ${opportunity.customer} should cover discovery, target-state design, implementation planning, delivery governance, and measurable adoption outcomes for "${opportunity.name}".`,
      'Include a kickoff workstream to confirm requirements, success metrics, dependencies, and decision owners. Follow with solution design, delivery execution, change enablement, and executive reporting.',
      `${refLine} ${
        notes[0]
          ? `Recent account note to account for: "${notes[0].title}" - ${summarizeNote(notes[0])}`
          : 'No recent account note was found, so assumptions should be explicitly listed.'
      }`,
      'Out of scope until validated: final pricing, third-party commitments, and any customer-side dependency not owned by the bid team.',
    ];
  }

  if (input.section === 'pricing') {
    return [
      `Use ${value} as the CRM commercial baseline for "${opportunity.name}" and validate it against the quote workflow before sending any binding price.`,
      `Recommended commercial structure: separate discovery, implementation, managed transition, and optional acceleration services so ${opportunity.customer} can approve a controlled core offer while preserving expansion room.`,
      'Tie discounts to clear approval gates, payment terms, scope boundaries, and customer-provided dependencies. Any variance from standard margin should be escalated to finance.',
      references.length
        ? `Benchmark against ${references.map((r) => `"${r.title}"`).join(', ')} before final sign-off.`
        : 'No pricing reference is attached yet; add at least one comparable past win or approved pricing note before submission.',
    ];
  }

  if (input.section === 'timeline') {
    return [
      `Anchor the response plan to the ${due} deadline and show a low-risk sequence from mobilization through executive acceptance.`,
      'Proposed phases: week 0 kickoff and access readiness; weeks 1-2 discovery and validation; weeks 3-5 solution design and implementation planning; weeks 6+ delivery execution with weekly steering and risk review.',
      activeTasks.length
        ? `Current open work items that should appear in the timeline: ${activeTasks.map((task) => task.title).join('; ')}.`
        : 'No open pursuit tasks were found; create owners for compliance, pricing, legal, and delivery before the timeline is considered complete.',
      'Include an explicit dependency table for customer decisions, data access, security review, and procurement approval.',
    ];
  }

  return [
    `Primary pursuit risks for ${opportunity.customer}: stage maturity (${opportunity.stage}), win probability (${opportunity.probability}%), deadline (${due}), and completeness of stakeholder/proof-point evidence.`,
    opportunity.probability < 40
      ? 'Win probability is below 40%, so the bid/no-bid decision should be challenged before major drafting effort continues.'
      : 'Win probability is workable, but assumptions must still be tested against legal, finance, delivery, and procurement gates.',
    `${stakeholderLine} ${refLine}`,
    activeTasks.some((task) => task.status === 'blocked')
      ? 'At least one task is blocked; unblock it or mark the proposal risk as high.'
      : 'No blocked task was found in the sampled pursuit tasks.',
  ];
}

export function buildGroundedProposalDraft(input: GroundedDraftInput): {
  markdown: string;
  citations: DraftCitation[];
} {
  const citations: DraftCitation[] = [
    {
      docId: input.opportunity.id,
      title: `${input.opportunity.code} - ${input.opportunity.name}`,
      type: 'opportunity',
    },
    ...input.references.map((reference) => ({
      docId: reference.id,
      title: reference.title,
      type: 'reference' as const,
      ...(reference.documentUrl ? { sourceUrl: reference.documentUrl } : {}),
    })),
    ...input.tasks.map((task) => ({ docId: task.id, title: task.title, type: 'task' as const })),
    ...input.contacts.map((contact) => ({
      docId: contact.id,
      title: contact.aiOptOut ? 'Opted-out stakeholder' : contact.name,
      type: 'contact' as const,
    })),
    ...input.notes.map((note) => ({ docId: note.id, title: note.title, type: 'note' as const })),
  ];

  const evidenceLines = [
    `- Opportunity: ${input.opportunity.code}, ${input.opportunity.stage}, ${formatMoneyMicros(
      input.opportunity.valueMicros,
    )}, ${input.opportunity.probability}% probability.`,
    input.references.length
      ? `- References: ${input.references.map((reference) => reference.title).join('; ')}.`
      : '- References: none selected yet.',
    input.tasks.length
      ? `- Pursuit tasks: ${input.tasks.map((task) => `${task.title} (${task.status})`).join('; ')}.`
      : '- Pursuit tasks: none found.',
    input.contacts.length
      ? `- Stakeholders: ${input.contacts.map(formatStakeholder).join('; ')}.`
      : '- Stakeholders: none found.',
  ];

  const markdown = [
    `## ${input.sectionTitle} - ${input.opportunity.customer}`,
    '',
    `> Tone: ${input.tone} | Source-grounded MCP draft | Updated: ${input.opportunity.updatedAt.toISOString()}`,
    '',
    ...sectionBody(input),
    '',
    '### Evidence Used',
    ...evidenceLines,
    '',
    '### Follow-up Checks',
    '- Validate all factual claims with section owner before sending.',
    '- Run legal, finance, delivery, and submission QA review for any binding response.',
    '- Replace assumptions with customer-confirmed facts where source evidence is missing.',
  ].join('\n\n');

  return { markdown, citations };
}
