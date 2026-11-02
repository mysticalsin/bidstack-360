interface BriefOpportunity {
  code: string;
  customer: string;
  name: string;
  stage: string;
  pipelineStageName: string | null;
  valueMicros: bigint | number;
  probability: number;
  dueDate: Date | null;
  industry: string | null;
  updatedAt: Date;
}

interface BriefTask {
  title: string;
  status: string;
  dueDate: Date | null;
}

interface BriefContact {
  name: string;
  role: string | null;
  influence: number | null;
  sentiment: string | null;
  aiOptOut: boolean;
}

interface BriefNote {
  title: string;
  bodyMd: string;
  pinned: boolean;
  updatedAt: Date;
}

export interface OpportunityBriefInput {
  opportunity: BriefOpportunity;
  tasks: BriefTask[];
  contacts: BriefContact[];
  notes: BriefNote[];
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
  return value ? value.toISOString().slice(0, 10) : 'not set';
}

function compactMarkdown(value: string, max = 180): string {
  const compact = value.replace(/[#*_`>[\]()]/g, '').replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function stakeholderLine(contact: BriefContact): string {
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

function riskLine(input: OpportunityBriefInput): string {
  const { opportunity, tasks, contacts } = input;
  const risks: string[] = [];
  if (opportunity.probability < 40) risks.push('low win probability requires bid/no-bid challenge');
  if (!opportunity.dueDate) risks.push('no due date is recorded');
  if (tasks.some((task) => task.status === 'blocked')) risks.push('blocked pursuit tasks need escalation');
  if (contacts.length === 0) risks.push('stakeholder map is incomplete');
  if (risks.length === 0) return 'No immediate CRM risk signal is blocking the pursuit, but keep review gates active.';
  return risks.join('; ') + '.';
}

export function estimateBriefTokens(brief: string): number {
  return Math.ceil(brief.length / 4);
}

export function buildOpportunityBrief(input: OpportunityBriefInput): string {
  const { opportunity, tasks, contacts, notes } = input;
  const stage = opportunity.pipelineStageName ?? opportunity.stage;
  const activeTasks = tasks.filter((task) => task.status !== 'done');
  const latestNote = notes[0];

  const stakeholders = contacts.length
    ? contacts.map((contact) => `- ${stakeholderLine(contact)}`).join('\n')
    : '- No stakeholder records found. Confirm sponsor, economic buyer, legal, procurement, and technical owner.';

  const taskLines = activeTasks.length
    ? activeTasks
        .map((task) => `- ${task.title} (${task.status}, due ${formatDate(task.dueDate)})`)
        .join('\n')
    : '- No open pursuit tasks found. Create owners for proposal, legal, finance, delivery, and submission QA.';

  const noteLines = notes.length
    ? notes
        .map(
          (note) =>
            `- ${note.pinned ? 'Pinned' : 'Recent'}: ${note.title} - ${compactMarkdown(note.bodyMd)} (${note.updatedAt.toISOString().slice(0, 10)})`,
        )
        .join('\n')
    : '- No account notes found. Run discovery before relying on this brief.';

  return [
    `# Exec brief - ${opportunity.customer}`,
    '',
    `> Source-grounded account brief | Updated: ${opportunity.updatedAt.toISOString()}`,
    '',
    `**Opportunity:** ${opportunity.name} (${opportunity.code})`,
    `**Stage:** ${stage} | **Value:** ${formatMoneyMicros(opportunity.valueMicros)} | **Probability:** ${opportunity.probability}% | **Due:** ${formatDate(opportunity.dueDate)}`,
    opportunity.industry ? `**Industry:** ${opportunity.industry}` : '**Industry:** not set',
    '',
    '## Current Read',
    `${opportunity.customer} is pursuing ${opportunity.name}. The CRM signal shows ${stage} maturity, ${opportunity.probability}% win probability, and ${formatMoneyMicros(opportunity.valueMicros)} in potential value. ${latestNote ? `Most recent account signal: "${latestNote.title}" - ${compactMarkdown(latestNote.bodyMd)}.` : 'There is no recent account note, so discovery assumptions need confirmation.'}`,
    '',
    '## Stakeholders',
    stakeholders,
    '',
    '## Open Work',
    taskLines,
    '',
    '## Account Signals',
    noteLines,
    '',
    '## Risk Focus',
    riskLine(input),
    '',
    '## Recommended Next Actions',
    '- Confirm decision process, economic buyer, legal/procurement path, and technical success criteria.',
    '- Validate pricing and margin assumptions with Finance before any customer-facing quote.',
    '- Ask Presales/Delivery to confirm capacity, dependencies, and credible implementation timeline.',
    '- Keep all factual claims tied to CRM notes, RFP evidence, or approved reference material before submission.',
  ].join('\n');
}
