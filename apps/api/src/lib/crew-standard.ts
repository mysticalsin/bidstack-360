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
    role: 'Solution Architect',
    goal: 'Extract and structure the RFP requirements',
    backstory:
      'A senior solution architect who turns RFP prose into a crisp, prioritized requirement list.',
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
    goal: 'Outline the pricing and commercial approach',
    backstory: 'A pricing strategist who builds defensible, competitive commercial models.',
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
    role: 'Marketing Strategist',
    goal: 'Craft win themes and proof points',
    backstory:
      'A bid marketer who turns capability into a differentiated, evidence-backed narrative.',
  },
  {
    key: 'bid_manager',
    role: 'Bid Manager',
    goal: 'Consolidate the specialists into one coherent response',
    backstory: 'A seasoned bid manager who assembles the final, decision-ready proposal.',
  },
];

const STANDARD_CREW = {
  name: 'RFP Response Crew',
  description: 'The default multi-agent crew that drafts a bid response from an RFP.',
  process: 'hierarchical' as const,
  managerAgentKey: 'bid_manager',
  tasks: [
    {
      key: 'requirements',
      agentKey: 'analyst',
      description: 'Extract and prioritize the requirements from this RFP:\n{{rfp}}',
      expectedOutput: 'A prioritized requirement list.',
    },
    {
      key: 'compliance',
      agentKey: 'compliance',
      description: 'List the compliance, security and certification obligations the RFP implies.',
      expectedOutput: 'A compliance checklist.',
    },
    {
      key: 'legal',
      agentKey: 'legal',
      description:
        'Flag the legal and contractual risks (SLA penalties, fixed-price, IP, termination).',
      expectedOutput: 'A risk register.',
    },
    {
      key: 'pricing',
      agentKey: 'finance',
      description: 'Outline a pricing and commercial approach that fits the RFP constraints.',
      expectedOutput: 'A pricing approach.',
    },
    {
      key: 'presales_review',
      agentKey: 'presales',
      description:
        'Assess solution fit, technical gaps, delivery assumptions and SME follow-up needs.',
      expectedOutput: 'A presales feasibility review.',
    },
    {
      key: 'win_themes',
      agentKey: 'marketing',
      description: 'Propose three win themes with proof points tailored to the RFP.',
      expectedOutput: 'Three win themes with proof points.',
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

  for (const a of STANDARD_AGENTS) {
    // Small fixed set — clarity over micro-batching.
    await prisma.$executeRaw`
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

  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM crews
    WHERE org_id = ${orgId}::uuid AND name = ${STANDARD_CREW.name} AND deleted_at IS NULL
    LIMIT 1
  `;
  const existingId = existing[0]?.id;
  if (existingId) return existingId;

  const created = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO crews
      (id, org_id, name, description, process, manager_agent_key, created_by_user_id, created_at, updated_at)
    VALUES
      (gen_random_uuid(), ${orgId}::uuid, ${STANDARD_CREW.name}, ${STANDARD_CREW.description},
       ${STANDARD_CREW.process}, ${STANDARD_CREW.managerAgentKey}, ${createdBy}::uuid, now(), now())
    RETURNING id
  `;
  const crewId = created[0]?.id;
  if (!crewId) throw new Error('seedStandardCrew: crew insert returned no row');

  for (const [i, t] of STANDARD_CREW.tasks.entries()) {
    // Ordered insert preserves sort_order.
    await prisma.$executeRaw`
      INSERT INTO crew_tasks
        (id, org_id, crew_id, task_key, description, expected_output, agent_key, context_keys, sort_order, created_at, updated_at)
      VALUES
        (gen_random_uuid(), ${orgId}::uuid, ${crewId}::uuid, ${t.key}, ${t.description},
         ${t.expectedOutput}, ${t.agentKey}, ${JSON.stringify(t.contextKeys ?? [])}::jsonb, ${i}, now(), now())
    `;
  }
  return crewId;
}
