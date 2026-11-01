import { formatMicrosAmount } from '@bidstack/shared';

interface BriefStage {
  isWon: boolean;
  isLost: boolean;
  deletedAt: Date | null;
}

interface BriefOpportunity {
  code: string;
  customer: string;
  name: string;
  stage: string;
  pipelineStageName: string | null;
  /** Live flags close the deal. A deleted stage does not. */
  pipelineStage?: BriefStage | null;
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
  return `${formatMicrosAmount(valueMicros)} unspecified`;
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
    contact.influence !== null ? `influence ${contact.influence}/5` : '',
    contact.sentiment ? `sentiment ${contact.sentiment}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Blank probability is stored as 0. That is not a measured win chance. */
function probabilityPhrase(probability: number): string {
  if (probability === 0) return 'no probability is recorded';
  return `a stored probability of ${probability}%`;
}

function probabilityLabel(probability: number): string {
  return probability === 0 ? 'not recorded' : `${probability}%`;
}

/** Lost wins when the enum and a live stage flag disagree. A deleted stage does not close the deal. */
function briefOutcome(opportunity: BriefOpportunity): 'open' | 'won' | 'lost' {
  const stage =
    opportunity.pipelineStage && opportunity.pipelineStage.deletedAt == null
      ? opportunity.pipelineStage
      : null;
  if (opportunity.stage === 'closed_lost' || stage?.isLost === true) return 'lost';
  if (opportunity.stage === 'closed_won' || stage?.isWon === true) return 'won';
  return 'open';
}

function riskLine(input: OpportunityBriefInput): string {
  const { opportunity, tasks, contacts } = input;
  const risks: string[] = [];
  const outcome = briefOutcome(opportunity);
  if (outcome === 'lost') {
    risks.push('the deal is recorded as lost, so do not draft it as an open pursuit');
  } else if (outcome === 'won') {
    risks.push('the deal is recorded as won, so do not draft it as an open pursuit');
  }
  if (opportunity.probability === 0) {
    risks.push('no probability is recorded');
  } else if (opportunity.probability < 40) {
    risks.push('stored probability is below 40, so challenge bid/no-bid before drafting');
  }
  if (!opportunity.dueDate) risks.push('no due date is recorded');
  if (tasks.some((task) => task.status === 'blocked')) risks.push('blocked pursuit tasks need escalation');
  if (contacts.length === 0) risks.push('stakeholder map is incomplete');
  if (risks.length === 0) return 'No immediate CRM risk signal is blocking the pursuit, but keep review gates active.';
  return risks.join('; ') + '.';
}

export function estimateBriefTokens(brief: string): number {
  return Math.ceil(brief.length / 4);
}

/** A configured stage name wins. Otherwise the stored key is shown as words. */
export function stageWords(name: string | null | undefined, stage: string): string {
  const configured = name?.trim();
  if (configured) return configured;
  return stage
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildOpportunityBrief(input: OpportunityBriefInput): string {
  const { opportunity, tasks, contacts, notes } = input;
  const stageName =
    opportunity.pipelineStage?.deletedAt != null ? null : opportunity.pipelineStageName;
  const stage = stageWords(stageName, opportunity.stage);
  const outcome = briefOutcome(opportunity);
  const pursuit =
    outcome === 'lost'
      ? `${opportunity.customer} recorded ${opportunity.name} as lost.`
      : outcome === 'won'
        ? `${opportunity.customer} recorded ${opportunity.name} as won.`
        : `${opportunity.customer} is pursuing ${opportunity.name}.`;
  const activeTasks = tasks.filter((task) => task.status !== 'done');
  const latestNote = notes[0];

  const stakeholders = contacts.length
    ? contacts.map((contact) => `- ${stakeholderLine(contact)}`).join('\n')
    : '- No stakeholder records found. Confirm sponsor, economic buyer, legal, procurement, and technical owner.';

  const taskLines = activeTasks.length
    ? activeTasks
        .map((task) => `- ${task.title} (${stageWords(null, task.status)}, due ${formatDate(task.dueDate)})`)
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
    `**Stage:** ${stage} | **Value:** ${formatMoneyMicros(opportunity.valueMicros)} | **Stored probability:** ${probabilityLabel(opportunity.probability)} | **Due:** ${formatDate(opportunity.dueDate)}`,
    opportunity.industry
      ? `**Industry:** ${stageWords(null, opportunity.industry)}`
      : '**Industry:** not set',
    '',
    '## Current Read',
    `${pursuit} The CRM signal shows ${stage} maturity, ${probabilityPhrase(opportunity.probability)}, and ${formatMoneyMicros(opportunity.valueMicros)} in potential value. ${latestNote ? `Most recent account signal: "${latestNote.title}" - ${compactMarkdown(latestNote.bodyMd)}.` : 'There is no recent account note, so discovery assumptions need confirmation.'}`,
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
