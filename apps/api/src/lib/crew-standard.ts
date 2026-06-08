// Standard crew — the out-of-the-box role agents + a default RFP-response crew.
//
// These are the "standard agents" every org starts with (legal, finance,
// marketing, sales/architect, compliance + a bid manager). Admins can edit them
// or add their own via the API; this just guarantees a useful baseline. Seeded
// idempotently via raw SQL (crew tables aren't in the generated client — Wave 9
// Windows-DLL-lock pattern). Validated end-to-end through kickoff().

import { prisma } from '@bidstack/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StdAgent {
  key: string;
  role: string;
  goal: string;
  backstory: string;
}
interface StdTask {
  key: string;
  agentKey: string;
  description: string;
  expectedOutput: string;
  contextKeys?: string[];
}

export const STANDARD_AGENTS: StdAgent[] = [
  {
    key: 'analyst',
    role: 'Document Intelligence Engine',
    goal: 'Extract documents, deadlines, amendments, requirements and submission constraints',
    backstory:
      'A senior RFP deconstructor who turns source documents into a cited, prioritized bid taxonomy.',
  },
  {
    key: 'tender_strategy',
    role: 'Tender Strategy Analyst',
    goal: 'Classify the opportunity and produce the go/no-go decision logic',
    backstory:
      'A bid strategy operator who evaluates fit, urgency, buyer context, red flags and governance class before a team commits.',
  },
  {
    key: 'compliance',
    role: 'Compliance Officer',
    goal: 'Identify regulatory, security and certification obligations',
    backstory:
      'A compliance officer fluent in GDPR, ISO 27001, SOC 2 and public-sector procurement rules.',
  },
  {
    key: 'legal',
    role: 'Legal Counsel',
    goal: 'Flag contractual and legal risks in the requirements',
    backstory:
      'A commercial lawyer who spots liability, IP, SLA and termination risks before they bite.',
  },
  {
    key: 'finance',
    role: 'Finance Lead',
    goal: 'Review pricing, margin, cash flow, FX, tax and approval implications',
    backstory:
      'A finance leader who builds defensible P&L positions, committee-ready scenarios and commercial guardrails.',
  },
  {
    key: 'presales',
    role: 'Presales Lead',
    goal: 'Validate solution fit, delivery assumptions and technical response gaps',
    backstory:
      'A senior presales leader who stress-tests feasibility, integrations, dependencies and SME follow-ups.',
  },
  {
    key: 'marketing',
    role: 'Marketing and Competitive Strategist',
    goal: 'Craft win themes, competitive positioning and reusable proof points',
    backstory:
      'A bid marketer who turns capability, references and market context into a differentiated, evidence-backed narrative.',
  },
  {
    key: 'delivery',
    role: 'Delivery and Operations Director',
    goal: 'Validate delivery model, resource loading, governance and operational risk',
    backstory:
      'A delivery executive who tests the work breakdown structure, transition plan, dependencies and staffing realism.',
  },
  {
    key: 'red_team',
    role: 'Red Team QA Reviewer',
    goal: 'Attack the draft for weak claims, missing evidence, compliance gaps and executive risk',
    backstory:
      'An adversarial proposal reviewer who finds the issues a buyer, legal team or competitor would exploit.',
  },
  {
    key: 'bid_manager',
    role: 'Bid Manager',
    goal: 'Consolidate the specialists into a decision-ready bid plan and proposal response',
    backstory:
      'A seasoned bid manager who resolves conflicts, assigns owners, protects gates and assembles the final executive response.',
  },
];

/**
 * Stable identity for the seeded RFP crew (RFP-CREW-002). The seed matches and
 * refreshes by this key, so a user-created crew named "RFP Response Crew" can no
 * longer collide with the standard one. Persisted in crews.standard_key.
 */
export const STANDARD_CREW_KEY = 'rfp_response_crew';

export const STANDARD_CREW = {
  name: 'RFP Response Crew',
  description: 'The default multi-agent crew that drafts a bid response from an RFP.',
  process: 'hierarchical' as const,
  managerAgentKey: 'bid_manager',
  tasks: [
    {
      key: 'requirements',
      agentKey: 'analyst',
      description:
        'Phase 1 - Ingestion & Parsing. Extract every deadline, submission instruction, eligibility rule, amendment, evaluation criterion, deliverable, SLA, data/security obligation, pricing form, and explicit requirement from this RFP. Include citations or source snippets where possible:\n{{rfp}}',
      expectedOutput:
        'A cited, prioritized requirement register with deadlines, mandatory items, unknowns, and immediate blockers.',
    },
    {
      key: 'intelligence',
      agentKey: 'marketing',
      description:
        'Phase 2 - Market Intelligence. Identify buyer context, likely competitors, price-to-win implications, past-performance angles, reusable references, and differentiators. Use the requirement register as context.',
      expectedOutput:
        'A market-intelligence brief with win themes, reference candidates, competitor risks, and evidence gaps.',
      contextKeys: ['requirements'],
    },
    {
      key: 'go_no_go',
      agentKey: 'tender_strategy',
      description:
        'Phase 3 - Risk & Governance. Score bid/no-bid fit, urgency, capability match, strategic value, resource availability, risk, and profitability. Classify the required governance level from Class 0-4 and list approval owners.',
      expectedOutput:
        'A go/no-go recommendation with score, rationale, governance class, approval owners, and stop/go blockers.',
      contextKeys: ['requirements', 'intelligence'],
    },
    {
      key: 'compliance',
      agentKey: 'compliance',
      description:
        'Phase 3 - Compliance. Build the security, privacy, certification, accessibility, public-procurement, and audit obligations checklist implied by the RFP.',
      expectedOutput:
        'A compliance checklist with mandatory obligations, evidence needed, owner roles, and pass/fail risks.',
      contextKeys: ['requirements', 'go_no_go'],
    },
    {
      key: 'legal',
      agentKey: 'legal',
      description:
        'Phase 3 - Legal Review. Flag legal and contractual risks: unlimited liability, IP transfer, termination, indemnity, privacy/data residency, non-standard SLAs, penalties, fixed-price exposure, and unacceptable flow-downs.',
      expectedOutput:
        'A legal risk register with severity, recommended deviation language, approval need, and negotiation stance.',
      contextKeys: ['requirements', 'go_no_go', 'compliance'],
    },
    {
      key: 'presales_review',
      agentKey: 'presales',
      description:
        'Phase 4 - Solution Engineering. Validate solution fit, technical gaps, architecture assumptions, integration dependencies, delivery model, staffing realism, and SME follow-up needs.',
      expectedOutput:
        'A presales and delivery feasibility review with solution risks, assumptions, missing SMEs, and mitigation actions.',
      contextKeys: ['requirements', 'compliance', 'legal'],
    },
    {
      key: 'pricing',
      agentKey: 'finance',
      description:
        'Phase 5 - Commercial Modeling. Build the commercial/P&L approach: pricing strategy, margin risks, payment terms, FX/tax exposure, delivery cost drivers, partner/subcontractor assumptions, contingencies, and approval thresholds.',
      expectedOutput:
        'A P&L-ready commercial model brief with margin scenarios, cash-flow risks, approval owners, and negotiation levers.',
      contextKeys: ['requirements', 'go_no_go', 'legal', 'presales_review'],
    },
    {
      key: 'win_themes',
      agentKey: 'marketing',
      description:
        'Phase 6 - Proposal Synthesis. Propose executive win themes, proof points, case-study mapping, discriminators, and customer language that align to the evaluation criteria.',
      expectedOutput:
        'Three to five win themes with proof points, cited evidence needs, and proposal section mapping.',
      contextKeys: ['requirements', 'intelligence', 'presales_review', 'pricing'],
    },
    {
      key: 'red_team',
      agentKey: 'red_team',
      description:
        'Phase 6 - Red Team. Challenge the response plan as a skeptical buyer and competitor. Find weak claims, unsupported metrics, compliance misses, pricing exposure, and final blockers.',
      expectedOutput:
        'A red-team punch list with severity, owner, fix recommendation, and whether the bid can proceed.',
      contextKeys: ['legal', 'pricing', 'win_themes'],
    },
    {
      key: 'executive_final',
      agentKey: 'bid_manager',
      description:
        'Phase 7 - Executive Finals. Consolidate all specialist work into a one-page executive bid plan with decision, owners, risks, actions, and proposal narrative direction.',
      expectedOutput:
        'A final executive bid plan: go/no-go recommendation, governance class, owner actions, key risks, win themes, and approval checklist.',
      contextKeys: ['go_no_go', 'legal', 'pricing', 'red_team'],
    },
  ] as StdTask[],
};

/**
 * Seed the standard agents + the default RFP crew for an org. Idempotent:
 * agents upsert by (org_id, agent_key); the crew is created only if an active
 * crew with the standard name doesn't already exist. Returns the crew id.
 */
export async function seedStandardCrew(
  orgId: string,
  createdByUserId: string | null | undefined,
): Promise<string> {
  const createdBy = createdByUserId && UUID_RE.test(createdByUserId) ? createdByUserId : null;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seedStandardCrew:${orgId}`}, 0))`;

  for (const a of STANDARD_AGENTS) {
    // Small fixed set — clarity over micro-batching.
    await tx.$executeRaw`
      INSERT INTO crew_agents
        (id, org_id, agent_key, role, goal, backstory, tools, is_standard, created_by_user_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${orgId}::uuid, ${a.key}, ${a.role}, ${a.goal}, ${a.backstory},
         '[]'::jsonb, true, ${createdBy}::uuid, now(), now())
      ON CONFLICT (org_id, agent_key) WHERE deleted_at IS NULL
      DO UPDATE SET role = EXCLUDED.role, goal = EXCLUDED.goal, backstory = EXCLUDED.backstory,
                    is_standard = true, updated_at = now()
    `;
  }

  // Match by stable standard_key (RFP-CREW-002), not name — a custom crew named
  // "RFP Response Crew" must not be mistaken for the seed.
  const existing = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM crews
    WHERE org_id = ${orgId}::uuid AND standard_key = ${STANDARD_CREW_KEY} AND deleted_at IS NULL
    LIMIT 1
  `;
  let crewId = existing[0]?.id;
  if (crewId) {
    await tx.$executeRaw`
      UPDATE crews
      SET name = ${STANDARD_CREW.name},
          description = ${STANDARD_CREW.description},
          process = ${STANDARD_CREW.process},
          manager_agent_key = ${STANDARD_CREW.managerAgentKey},
          standard_key = ${STANDARD_CREW_KEY},
          updated_at = now()
      WHERE id = ${crewId}::uuid AND org_id = ${orgId}::uuid
    `;
  } else {
    const created = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO crews
        (id, org_id, name, description, process, manager_agent_key, standard_key, created_by_user_id, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${orgId}::uuid, ${STANDARD_CREW.name}, ${STANDARD_CREW.description},
         ${STANDARD_CREW.process}, ${STANDARD_CREW.managerAgentKey}, ${STANDARD_CREW_KEY}, ${createdBy}::uuid, now(), now())
      RETURNING id
    `;
    crewId = created[0]?.id;
    if (!crewId) throw new Error('seedStandardCrew: crew insert returned no row');
  }

  const standardTaskKeys = new Set(STANDARD_CREW.tasks.map((task) => task.key));
  const existingTasks = await tx.$queryRaw<{ task_key: string }[]>`
    SELECT task_key FROM crew_tasks
    WHERE org_id = ${orgId}::uuid AND crew_id = ${crewId}::uuid
  `;
  for (const task of existingTasks) {
    if (!standardTaskKeys.has(task.task_key)) {
      await tx.$executeRaw`
        DELETE FROM crew_tasks
        WHERE org_id = ${orgId}::uuid AND crew_id = ${crewId}::uuid AND task_key = ${task.task_key}
      `;
    }
  }

  for (const [i, t] of STANDARD_CREW.tasks.entries()) {
    // Ordered insert preserves sort_order.
    await tx.$executeRaw`
      INSERT INTO crew_tasks
        (id, org_id, crew_id, task_key, description, expected_output, agent_key, context_keys, sort_order, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${orgId}::uuid, ${crewId}::uuid, ${t.key}, ${t.description},
         ${t.expectedOutput}, ${t.agentKey}, ${JSON.stringify(t.contextKeys ?? [])}::jsonb, ${i}, now(), now())
      ON CONFLICT (crew_id, task_key)
      DO UPDATE SET description = EXCLUDED.description,
                    expected_output = EXCLUDED.expected_output,
                    agent_key = EXCLUDED.agent_key,
                    context_keys = EXCLUDED.context_keys,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = now()
    `;
  }
  return crewId;
  });
}
