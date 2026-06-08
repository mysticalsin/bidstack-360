// Crew agent (role persona) infrastructure routes — Wave 10.
//
// RBAC (the whole point): admins CREATE / EDIT / DELETE agents; any authenticated
// member may LIST them (to compose or understand a crew run). Regular users never
// mutate the infrastructure. Org-scoped parameterized raw SQL — the crew tables
// are not in the generated Prisma client yet (Windows DLL lock; Wave 9 pattern).

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';

interface AgentRow {
  id: string;
  agent_key: string;
  role: string;
  goal: string;
  backstory: string;
  tools: unknown;
  is_standard: boolean;
  created_at: Date;
  updated_at: Date;
}

function serializeAgent(r: AgentRow) {
  return {
    id: r.id,
    agentKey: r.agent_key,
    role: r.role,
    goal: r.goal,
    backstory: r.backstory,
    tools: Array.isArray(r.tools) ? (r.tools as string[]) : [],
    isStandard: r.is_standard,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const AgentKey = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9_-]+$/, 'lowercase letters, digits, - and _ only');

const AgentFields = z.object({
  role: z.string().min(1).max(200),
  goal: z.string().min(1).max(2000),
  backstory: z.string().min(1).max(4000),
  tools: z.array(z.string().max(100)).max(20).default([]),
});
const AgentCreate = AgentFields.extend({ agentKey: AgentKey });

const AgentResponse = z.object({
  id: z.string().uuid(),
  agentKey: z.string(),
  role: z.string(),
  goal: z.string(),
  backstory: z.string(),
  tools: z.array(z.string()),
  isStandard: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const crewAgentRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /crew-agents — list active agents (any authenticated member).
  app.get(
    '/crew-agents',
    { schema: { response: { 200: z.object({ items: z.array(AgentResponse) }) } } },
    async (req) => {
    const rows = await prisma.$queryRaw<AgentRow[]>`
      SELECT id, agent_key, role, goal, backstory, tools, is_standard, created_at, updated_at
      FROM crew_agents
      WHERE org_id = ${req.auth.orgId}::uuid AND deleted_at IS NULL
      ORDER BY is_standard DESC, agent_key ASC
    `;
    return { items: rows.map(serializeAgent) };
  });

  // POST /crew-agents — create (admin only).
  app.post(
    '/crew-agents',
    {
      preHandler: server.requireRole('admin'),
      schema: { body: AgentCreate, response: { 201: AgentResponse } },
    },
    async (req, reply) => {
      const { orgId, userId } = req.auth;
      const b = req.body;

      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM crew_agents
        WHERE org_id = ${orgId}::uuid AND agent_key = ${b.agentKey} AND deleted_at IS NULL
        LIMIT 1
      `;
      if (existing.length > 0) {
        throw server.httpErrors.conflict(`Agent key "${b.agentKey}" already exists`);
      }

      const rows = await prisma.$queryRaw<AgentRow[]>`
        INSERT INTO crew_agents
          (id, org_id, agent_key, role, goal, backstory, tools, is_standard, created_by_user_id, created_at, updated_at)
        VALUES
          (gen_random_uuid(), ${orgId}::uuid, ${b.agentKey}, ${b.role}, ${b.goal}, ${b.backstory},
           ${JSON.stringify(b.tools)}::jsonb, false, ${userId}::uuid, now(), now())
        RETURNING id, agent_key, role, goal, backstory, tools, is_standard, created_at, updated_at
      `;
      const created = rows[0];
      if (!created) throw server.httpErrors.internalServerError('Agent insert returned no row');
      reply.status(201);
      return serializeAgent(created);
    },
  );

  // PATCH /crew-agents/:id — update role/goal/backstory/tools (admin only).
  // agentKey is immutable (it is the stable reference used by crew tasks).
  app.patch(
    '/crew-agents/:id',
    {
      preHandler: server.requireRole('admin'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: AgentFields,
        response: { 200: AgentResponse },
      },
    },
    async (req) => {
      const { orgId } = req.auth;
      const b = req.body;
      const rows = await prisma.$queryRaw<AgentRow[]>`
        UPDATE crew_agents SET
          role = ${b.role}, goal = ${b.goal}, backstory = ${b.backstory},
          tools = ${JSON.stringify(b.tools)}::jsonb, updated_at = now()
        WHERE id = ${req.params.id}::uuid AND org_id = ${orgId}::uuid AND deleted_at IS NULL
        RETURNING id, agent_key, role, goal, backstory, tools, is_standard, created_at, updated_at
      `;
      const updated = rows[0];
      if (!updated) throw server.httpErrors.notFound('Agent not found');
      return serializeAgent(updated);
    },
  );

  // DELETE /crew-agents/:id — soft-delete (admin only).
  app.delete(
    '/crew-agents/:id',
    {
      preHandler: server.requireRole('admin'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      const { orgId } = req.auth;
      const affected = await prisma.$executeRaw`
        UPDATE crew_agents SET deleted_at = now()
        WHERE id = ${req.params.id}::uuid AND org_id = ${orgId}::uuid AND deleted_at IS NULL
      `;
      if (affected === 0) throw server.httpErrors.notFound('Agent not found');
      reply.status(204);
      return null;
    },
  );
};
