// The RFP crew — the role-based agents that work a bid through the pipeline.
//
// Each member maps to a pipeline stage (where they "work") or to `oversight`
// (the Bid Director master + Executive Sponsor, who supervise every stage).
// The RfpCrewBoard renders these as cards that flow stage→stage as the live
// orchestration advances, and the user can drag a member to another stage.
//
// WHY a single source of truth: the board, the per-agent detail panel, and any
// future server-side seeding all read the same roster so roles, skills, and
// instructions never drift between the visual layer and execution.

import type { PipelineStage } from '@/stores/rfpPipeline';

/** Pipeline stages a crew member can be stationed at (the working stages). */
export const CREW_STAGES = [
  'extracting',
  'story_matching',
  'section_drafting',
  'compliance_fill',
  'legal_scan',
  'qa_review',
] as const satisfies readonly PipelineStage[];

export type CrewStage = (typeof CREW_STAGES)[number];

/** Where a member is stationed: a working stage, or supervising all of them. */
export type CrewStation = CrewStage | 'oversight';

export interface RfpCrewMember {
  /** Stable id used as the drag key + React key. */
  key: string;
  /** Display role, e.g. "Legal Counsel". */
  role: string;
  /** Short department tag shown on the chip, e.g. "Legal". */
  department: string;
  /** Icon name from the shared Icon set. */
  icon: string;
  /** Default station. `oversight` members watch every stage. */
  station: CrewStation;
  /** The master supervisor — pinned, reviews everything, never auto-moves. */
  isMaster?: boolean;
  /** One-line mission statement. */
  goal: string;
  /** Explicit, ordered responsibilities — the agent's "clear instructions". */
  instructions: readonly string[];
  /** Skill tags surfaced on the detail panel. */
  skills: readonly string[];
}

// Order matters: the board renders oversight first (the supervisors), then the
// working roster in pipeline order.
export const RFP_CREW: readonly RfpCrewMember[] = [
  {
    key: 'bid_director',
    role: 'Bid Director',
    department: 'Master',
    icon: 'shield',
    station: 'oversight',
    isMaster: true,
    goal: 'Own the win. Direct the crew and gate every stage on quality and completeness.',
    instructions: [
      'Supervise all agents and confirm each stage is genuinely complete before the bid advances.',
      'Reject thin, generic, or non-compliant output and send it back to the owning agent.',
      'Keep the response on-strategy, on-message, and on-deadline end to end.',
      'Escalate blockers and material risks to the Executive Sponsor.',
    ],
    skills: [
      'Bid strategy',
      'Quality gating',
      'Orchestration',
      'Risk management',
      'Deadline control',
    ],
  },
  {
    key: 'exec_sponsor',
    role: 'Executive Sponsor',
    department: 'CEO',
    icon: 'crown',
    station: 'oversight',
    goal: 'Final accountable owner — signs off only when the bid is best-in-class.',
    instructions: [
      'Review the executive summary and win themes for C-suite credibility.',
      'Confirm the commercial shape and risk posture are acceptable to the business.',
      'Give the final go / no-go before the proposal leaves the building.',
    ],
    skills: ['Executive judgement', 'Commercial sign-off', 'Win-theme review', 'Go/no-go'],
  },
  {
    key: 'requirements_analyst',
    role: 'Requirements Analyst',
    department: 'Bid Ops',
    icon: 'list',
    station: 'extracting',
    goal: 'Read the RFP cover to cover and extract every requirement, mandatory or implied.',
    instructions: [
      'Parse the uploaded document and capture each requirement with its reference and priority.',
      'Flag mandatory ("shall/must") items and ambiguous clauses needing clarification.',
      'Hand a clean, de-duplicated requirement set to the rest of the crew.',
    ],
    skills: ['Document analysis', 'Requirement extraction', 'Traceability', 'Prioritisation'],
  },
  {
    key: 'solution_strategist',
    role: 'Solution Strategist',
    department: 'Presales',
    icon: 'target',
    station: 'story_matching',
    goal: 'Match each requirement to our strongest proof — past wins, case studies, capabilities.',
    instructions: [
      'For every requirement, retrieve the best-fitting reference story and differentiators.',
      'Surface gaps where we lack evidence so the team can mitigate or partner.',
      'Shape the solution narrative that the proposal will be built around.',
    ],
    skills: ['Solutioning', 'Evidence retrieval', 'Differentiation', 'Win themes'],
  },
  {
    key: 'proposal_writer',
    role: 'Proposal Writer',
    department: 'Marketing',
    icon: 'pencil',
    station: 'section_drafting',
    goal: 'Turn strategy into a persuasive, on-brand, client-centred written response.',
    instructions: [
      'Draft each section in the client’s language, leading with outcomes and value.',
      'Weave in the win themes and reference proof from the Solution Strategist.',
      'Keep voice, tone, and formatting consistent and on-brand throughout.',
    ],
    skills: ['Persuasive writing', 'Storytelling', 'Brand voice', 'Editing'],
  },
  {
    key: 'commercial_lead',
    role: 'Commercial Lead',
    department: 'Sales',
    icon: 'receipt',
    station: 'section_drafting',
    goal: 'Make the commercials competitive, defensible, and aligned to the win strategy.',
    instructions: [
      'Build the pricing and commercial narrative to match the buyer’s value drivers.',
      'Justify investment with ROI and total-cost-of-ownership framing.',
      'Coordinate with the Bid Director on margin and discount guardrails.',
    ],
    skills: ['Pricing strategy', 'Commercial modelling', 'ROI/TCO', 'Negotiation framing'],
  },
  {
    key: 'compliance_officer',
    role: 'Compliance Officer',
    department: 'Compliance',
    icon: 'checkCircle',
    station: 'compliance_fill',
    goal: 'Guarantee every mandatory requirement is answered — no disqualifications.',
    instructions: [
      'Fill the compliance matrix and confirm each mandatory requirement is addressed.',
      'Mark Comply / Partial / Non-comply with the evidence location for each.',
      'Block submission while any mandatory item is unanswered.',
    ],
    skills: ['Compliance matrix', 'Gap analysis', 'Evidence mapping', 'Risk flagging'],
  },
  {
    key: 'legal_counsel',
    role: 'Legal Counsel',
    department: 'Legal',
    icon: 'book',
    station: 'legal_scan',
    goal: 'Protect the business — surface contractual, liability, and regulatory risk.',
    instructions: [
      'Scan terms, SLAs, liability, IP, and data-protection clauses for red flags.',
      'Propose fallback positions and required clarifications or exceptions.',
      'Sign off that the response carries no unacceptable legal exposure.',
    ],
    skills: ['Contract review', 'Risk assessment', 'Data protection', 'Clause drafting'],
  },
  {
    key: 'qa_reviewer',
    role: 'QA Reviewer',
    department: 'Quality',
    icon: 'eye',
    station: 'qa_review',
    goal: 'Hold the line on "best results" — score, polish, and verify before the gate.',
    instructions: [
      'Review the compiled proposal for accuracy, completeness, and consistency.',
      'Score it and list concrete fixes; bounce anything below the quality bar.',
      'Confirm the response is submission-ready for the Bid Director’s gate.',
    ],
    skills: ['Quality assurance', 'Proofreading', 'Scoring rubric', 'Consistency checks'],
  },
];

/** Members that supervise every stage (master + executive). */
export const OVERSIGHT_CREW = RFP_CREW.filter((m) => m.station === 'oversight');

/** Members stationed at a working stage, in pipeline order. */
export const WORKING_CREW = RFP_CREW.filter((m) => m.station !== 'oversight');

/** Lookup a member by key (used after a drag to re-station). */
export function crewMemberByKey(key: string): RfpCrewMember | undefined {
  return RFP_CREW.find((m) => m.key === key);
}
