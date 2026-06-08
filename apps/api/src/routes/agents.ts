import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  Agent,
  AgentCreate,
  AgentPatch,
  AgentRun,
  AgentRunCreate,
  AgentListResult,
  AgentRunListResult,
  AgentProviderStatusResult,
  RFP_RESPONSE_PHASES,
  RFP_AGENT_TEMPLATES,
  RfpAgentTemplateListResult,
  RfpAgentTemplateProvisionRequest,
} from '@bidstack/shared';

import {
  listAgents,
  createAgent,
  getAgentById,
  updateAgent,
  deleteAgent,
  provisionRfpTemplate,
  runAgent,
  listAgentRuns,
  cancelAgentRun,
  retryAgentRun,
  ActiveAgentRunError,
  AgentRunNotCancellableError,
  AgentRunNotRetryableError,
} from '../services/agents/agents.service.js';
import { getAgentProviderStatus } from '../services/agents/agents.helpers.js';

export const agentsRoutes: FastifyPluginAsyncZod = async (server) => {
  // GET /api/v1/agents
  server.get(
    '/agents',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().uuid().optional(),
        }),
        response: { 200: AgentListResult },
      },
    },
    async (req) => {
      return listAgents(req.auth.orgId, req.query.limit, req.query.cursor);
    },
  );

  // POST /api/v1/agents
  server.post(
    '/agents',
    {
      preHandler: server.requirePermission('agents:write'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        body: AgentCreate,
        response: { 201: Agent },
      },
    },
    async (req, reply) => {
      const item = await createAgent(req.auth.orgId, req.auth.userId, req.body);
      reply.status(201);
      return item;
    },
  );

  // GET /api/v1/agents/provider-status
  server.get(
    '/agents/provider-status',
    {
      preHandler: server.requirePermission('agents:read'),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        response: { 200: AgentProviderStatusResult },
      },
    },
    async (req) => getAgentProviderStatus(req.auth.orgId),
  );

  // GET /api/v1/agents/rfp-templates
  server.get(
    '/agents/rfp-templates',
    {
      schema: {
        response: { 200: RfpAgentTemplateListResult },
      },
    },
    async () => ({
      phases: RFP_RESPONSE_PHASES,
      templates: RFP_AGENT_TEMPLATES,
    }),
  );

  // POST /api/v1/agents/rfp-templates/:templateId/provision
  server.post(
    '/agents/rfp-templates/:templateId/provision',
    {
      preHandler: server.requirePermission('agents:write'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ templateId: z.string().min(1).max(100) }),
        body: RfpAgentTemplateProvisionRequest.default({}),
        response: { 201: Agent },
      },
    },
    async (req, reply) => {
      const item = await provisionRfpTemplate(
        req.auth.orgId,
        req.auth.userId,
        req.params.templateId,
        req.body,
      );
      if (!item) throw server.httpErrors.notFound('RFP agent template not found');
      reply.status(201);
      return item;
    },
  );

  // GET /api/v1/agents/:id
  server.get(
    '/agents/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: Agent },
      },
    },
    async (req) => {
      const item = await getAgentById(req.auth.orgId, req.params.id);
      if (!item) throw server.httpErrors.notFound('Agent not found');
      return item;
    },
  );

  // PATCH /api/v1/agents/:id
  server.patch(
    '/agents/:id',
    {
      preHandler: server.requirePermission('agents:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: AgentPatch,
        response: { 200: Agent },
      },
    },
    async (req) => {
      const item = await updateAgent(req.auth.orgId, req.auth.userId, req.params.id, req.body);
      if (!item) throw server.httpErrors.notFound('Agent not found');
      return item;
    },
  );

  // DELETE /api/v1/agents/:id
  server.delete(
    '/agents/:id',
    {
      preHandler: server.requirePermission('agents:write'),
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      const result = await deleteAgent(req.auth.orgId, req.auth.userId, req.params.id);
      if (!result) throw server.httpErrors.notFound('Agent not found');
      reply.status(204);
    },
  );

  // POST /api/v1/agents/:id/run
  server.post(
    '/agents/:id/run',
    {
      preHandler: server.requirePermission('agents:write'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: AgentRunCreate,
        response: { 200: AgentRun },
      },
    },
    async (req) => {
      let item;
      try {
        item = await runAgent(
          req.auth.orgId,
          req.auth.userId,
          req.params.id,
          (req.body.input ?? {}) as Record<string, unknown>,
        );
      } catch (err) {
        if (err instanceof ActiveAgentRunError) {
          throw server.httpErrors.conflict(
            `Agent already has an active ${err.status} run (${err.activeRunId})`,
          );
        }
        throw err;
      }
      if (!item) throw server.httpErrors.notFound('Agent not found');
      return item;
    },
  );

  // GET /api/v1/agents/:id/runs
  server.get(
    '/agents/:id/runs',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().uuid().optional(),
        }),
        response: { 200: AgentRunListResult },
      },
    },
    async (req) => {
      const agent = await getAgentById(req.auth.orgId, req.params.id);
      if (!agent) throw server.httpErrors.notFound('Agent not found');
      return listAgentRuns(req.auth.orgId, {
        agentId: req.params.id,
        limit: req.query.limit,
        cursor: req.query.cursor,
      });
    },
  );

  // GET /api/v1/agent-runs
  server.get(
    '/agent-runs',
    {
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          cursor: z.string().uuid().optional(),
        }),
        response: { 200: AgentRunListResult },
      },
    },
    async (req) => {
      return listAgentRuns(req.auth.orgId, {
        limit: req.query.limit,
        cursor: req.query.cursor,
      });
    },
  );

  // POST /api/v1/agent-runs/:id/cancel
  server.post(
    '/agent-runs/:id/cancel',
    {
      preHandler: server.requirePermission('agents:write'),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: AgentRun },
      },
    },
    async (req) => {
      try {
        const item = await cancelAgentRun(req.auth.orgId, req.auth.userId, req.params.id);
        if (!item) throw server.httpErrors.notFound('Agent run not found');
        return item;
      } catch (err) {
        if (err instanceof AgentRunNotCancellableError) {
          throw server.httpErrors.conflict(`Agent run cannot be cancelled from ${err.status}`);
        }
        throw err;
      }
    },
  );

  // POST /api/v1/agent-runs/:id/retry
  server.post(
    '/agent-runs/:id/retry',
    {
      preHandler: server.requirePermission('agents:write'),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: AgentRun },
      },
    },
    async (req) => {
      try {
        const item = await retryAgentRun(req.auth.orgId, req.auth.userId, req.params.id);
        if (!item) throw server.httpErrors.notFound('Agent run not found');
        return item;
      } catch (err) {
        if (err instanceof AgentRunNotRetryableError) {
          throw server.httpErrors.conflict(`Agent run cannot be retried from ${err.status}`);
        }
        if (err instanceof ActiveAgentRunError) {
          throw server.httpErrors.conflict(
            `Agent already has an active ${err.status} run (${err.activeRunId})`,
          );
        }
        throw err;
      }
    },
  );
};
