/**
 * Jarvis routes (sibling of ai-assistant.ts, same /ai-assistant prefix and
 * human-session gate). A run executes in the background and the panel polls
 * its view; writes are staged and only the confirm route executes them,
 * after a fresh RBAC check for the tool's write permission.
 */
import { randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Logger as PinoLogger } from 'pino';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { AGENT_TOOL_NAMES, agentTools, type AgentToolName } from '@bidstack/db/agent-tools';

import { runJarvisLoop } from '../services/jarvis/jarvis.loop.js';
import { MAX_MESSAGE_CHARS } from '../services/jarvis/jarvis.prompt.js';
import {
  consumeAction,
  loadRun,
  peekAction,
  saveRun,
  takeRateLimit,
  type PendingAction,
} from '../services/jarvis/jarvis.store.js';
import type { JarvisRunView } from '../services/jarvis/jarvis.types.js';

const Uuid = z.string().uuid();

const RunBody = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  context: z
    .object({
      accountId: Uuid.optional(),
      opportunityId: Uuid.optional(),
      proposalId: Uuid.optional(),
      rfpOpportunityId: Uuid.optional(),
    })
    .strict()
    .default({}),
});

const RunParams = z.object({ runId: Uuid });
const ActionParams = z.object({ actionId: Uuid });

function owner(req: FastifyRequest) {
  return { orgId: req.auth.orgId, userId: req.auth.userId };
}

function writeTool(name: string): AgentToolName | null {
  if (!(AGENT_TOOL_NAMES as readonly string[]).includes(name)) return null;
  const toolName = name as AgentToolName;
  return agentTools[toolName].kind === 'write' ? toolName : null;
}

async function auditAction(
  req: FastifyRequest,
  action: PendingAction,
  verb: 'confirmed' | 'cancelled' | 'denied' | 'failed',
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      orgId: req.auth.orgId,
      userId: req.auth.userId,
      action: `jarvis.action_${verb}`,
      targetType: 'jarvis_action',
      targetId: action.id,
      diff: { tool: action.tool, runId: action.runId, ...extra },
    },
  });
}

export const jarvisRoutes: FastifyPluginAsyncZod = async (server) => {
  const requireHuman = server.requireHumanActor('Jarvis requires a user session');

  server.post(
    '/ai-assistant/jarvis/runs',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [requireHuman],
      schema: { body: RunBody },
    },
    async (req, reply) => {
      const who = owner(req);
      let allowed: boolean;
      try {
        allowed = await takeRateLimit(who);
      } catch {
        throw server.httpErrors.serviceUnavailable('Jarvis is unavailable right now');
      }
      if (!allowed) throw server.httpErrors.tooManyRequests('Jarvis rate limit reached');

      const view: JarvisRunView = {
        runId: randomUUID(),
        status: 'running',
        mode: 'demo',
        steps: [],
        answer: null,
        pendingActions: [],
      };
      await saveRun(who, view);
      void runJarvisLoop(
        {
          ...who,
          runId: view.runId,
          message: req.body.message,
          context: req.body.context,
          log: req.log as unknown as PinoLogger,
        },
        view,
      );
      return reply.code(202).send({ runId: view.runId });
    },
  );

  server.get(
    '/ai-assistant/jarvis/runs/:runId',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      preHandler: [requireHuman],
      schema: { params: RunParams },
    },
    async (req) => {
      const view = await loadRun(req.params.runId, owner(req));
      if (!view) throw server.httpErrors.notFound('Jarvis run not found');
      return view;
    },
  );

  server.post(
    '/ai-assistant/jarvis/actions/:actionId/confirm',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [requireHuman],
      schema: { params: ActionParams },
    },
    async (req) => {
      const who = owner(req);
      const staged = await peekAction(req.params.actionId, who);
      const name = staged ? writeTool(staged.tool) : null;
      if (!staged || !name) throw server.httpErrors.notFound('Pending action not found');
      const tool = agentTools[name];

      try {
        await server.requirePermission(tool.permission)(req);
      } catch (err) {
        await auditAction(req, staged, 'denied', { permission: tool.permission });
        throw err;
      }

      const action = await consumeAction(staged.id, who);
      if (!action) throw server.httpErrors.notFound('Pending action not found');

      const args = tool.input.safeParse(action.args);
      if (!args.success) throw server.httpErrors.badRequest('Pending action is invalid');
      let result: unknown;
      try {
        result = await tool.handler(args.data as never, { ...who, surface: 'jarvis' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action failed';
        await auditAction(req, action, 'failed', { error: message.slice(0, 300) });
        throw server.httpErrors.unprocessableEntity(message);
      }
      await auditAction(req, action, 'confirmed');
      return { ok: true, tool: name, result, citation: action.preview.citation ?? null };
    },
  );

  server.post(
    '/ai-assistant/jarvis/actions/:actionId/cancel',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: [requireHuman],
      schema: { params: ActionParams },
    },
    async (req) => {
      const action = await consumeAction(req.params.actionId, owner(req));
      if (!action) throw server.httpErrors.notFound('Pending action not found');
      await auditAction(req, action, 'cancelled');
      return { ok: true };
    },
  );
};
