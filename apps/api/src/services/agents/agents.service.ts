import { type z } from 'zod';
import { prisma, type Prisma } from '@bidstack/db';
import { AgentConfig, RFP_AGENT_TEMPLATES } from '@bidstack/shared';
import type { AgentCreate, AgentPatch } from '@bidstack/shared';
import {
  serializeAgent,
  serializeAgentRun,
  getDustClient,
  readAgentConfig,
  runDustAgent,
  runClaudeAgent,
} from './agents.helpers.js';

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

export async function listAgents(orgId: string, limit: number, cursor?: string) {
  const items = await prisma.agent.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  let nextCursor: string | undefined;
  if (items.length > limit) {
    nextCursor = items[limit]!.id;
    items.pop();
  }

  return { items: items.map(serializeAgent), nextCursor };
}

export async function createAgent(
  orgId: string,
  userId: string,
  body: z.infer<typeof AgentCreate>,
) {
  const a = await prisma.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: {
        orgId,
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        tools: (body.tools ?? []) as unknown as Prisma.InputJsonValue,
        status: 'idle',
        scheduleCron: body.scheduleCron,
        config: (body.config ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'agent.create',
        targetType: 'agent',
        targetId: agent.id,
        diff: { name: agent.name } as unknown as Prisma.InputJsonValue,
      },
    });
    return agent;
  });

  return serializeAgent(a);
}

export async function getAgentById(orgId: string, id: string) {
  const a = await prisma.agent.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  return a ? serializeAgent(a) : null;
}

export async function updateAgent(
  orgId: string,
  userId: string,
  id: string,
  body: z.infer<typeof AgentPatch>,
) {
  const existing = await prisma.agent.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!existing) return null;

  const data: Prisma.AgentUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.systemPrompt !== undefined) data.systemPrompt = body.systemPrompt;
  if (body.tools !== undefined) data.tools = body.tools as unknown as Prisma.InputJsonValue;
  if (body.status !== undefined) data.status = body.status;
  if (body.scheduleCron !== undefined) data.scheduleCron = body.scheduleCron;
  if (body.config !== undefined) data.config = body.config as unknown as Prisma.InputJsonValue;

  const [a] = await prisma.$transaction([
    prisma.agent.update({
      where: { id },
      data,
    }),
    prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'agent.update',
        targetType: 'agent',
        targetId: id,
        diff: body as Record<string, unknown> as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);

  return serializeAgent(a);
}

export async function deleteAgent(orgId: string, userId: string, id: string) {
  const existing = await prisma.agent.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!existing) return null;

  await prisma.$transaction([
    prisma.agent.update({
      where: { id },
      data: { deletedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'agent.delete',
        targetType: 'agent',
        targetId: id,
        diff: {} as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
  return { ok: true };
}

// ─── RFP template provisioning ────────────────────────────────────────────────

export async function provisionRfpTemplate(
  orgId: string,
  userId: string,
  templateId: string,
  body: {
    name?: string;
    enabledTools?: string[];
    provider?: string;
    dustAgentId?: string;
    model?: string;
  },
) {
  const template = RFP_AGENT_TEMPLATES.find((item) => item.id === templateId);
  if (!template) return null;

  const enabledTools = body.enabledTools;
  const tools = enabledTools
    ? template.tools.filter((tool) => {
        const type = typeof tool.type === 'string' ? tool.type : null;
        return type !== null && enabledTools.includes(type);
      })
    : template.tools;

  const config = AgentConfig.parse({
    ...template.defaultConfig,
    templateId: template.id,
    phase: template.phase,
    provider: body.provider ?? template.defaultConfig.provider,
    dustAgentId: body.dustAgentId ?? template.defaultConfig.dustAgentId,
    model: body.model ?? template.defaultConfig.model,
  });
  const jsonConfig = JSON.parse(JSON.stringify(config)) as Prisma.InputJsonValue;

  const agent = await prisma.$transaction(async (tx) => {
    const a = await tx.agent.create({
      data: {
        orgId,
        name: body.name ?? template.name,
        description: template.description,
        systemPrompt: template.systemPrompt,
        tools: tools as unknown as Prisma.InputJsonValue,
        status: 'idle',
        scheduleCron: null,
        config: jsonConfig,
      },
    });
    await tx.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'agent.rfp_template.provision',
        targetType: 'agent',
        targetId: a.id,
        diff: {
          templateId: template.id,
          phase: template.phase,
          provider: config.provider,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return a;
  });

  return serializeAgent(agent);
}

// ─── Agent run execution ──────────────────────────────────────────────────────

export async function runAgent(
  orgId: string,
  userId: string,
  agentId: string,
  input: Record<string, unknown>,
) {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, orgId, deletedAt: null },
  });
  if (!agent) return null;

  // Create run record
  let run = await prisma.agentRun.create({
    data: {
      orgId,
      agentId: agent.id,
      status: 'queued',
      input: input as unknown as Prisma.InputJsonValue,
    },
  });

  const startedAt = new Date();

  // Update agent and run to running
  await prisma.$transaction([
    prisma.agent.update({
      where: { id: agent.id },
      data: { status: 'running', lastRunAt: startedAt },
    }),
    prisma.agentRun.update({
      where: { id: run.id },
      data: { status: 'running', startedAt },
    }),
  ]);

  run = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } });

  try {
    const config = readAgentConfig(agent.config);
    const providerResult =
      config.provider === 'claude'
        ? await runClaudeAgent(agent.systemPrompt, input, config)
        : await runDustAgent(await getDustClient(orgId), agent.systemPrompt, input, config);
    const finishedAt = new Date();
    const latencyMs = finishedAt.getTime() - startedAt.getTime();
    const output = JSON.parse(
      JSON.stringify({
        text: providerResult.text,
        provider: providerResult.provider,
        model: providerResult.model,
        dustAgentId: providerResult.dustAgentId,
        usage: providerResult.usage,
      }),
    ) as Prisma.InputJsonValue;

    const [updated] = await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          output,
          error: null,
          finishedAt,
          latencyMs,
        },
      }),
      prisma.agent.update({
        where: { id: agent.id },
        data: { status: 'idle' },
      }),
      prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'agent.run',
          targetType: 'agent',
          targetId: agent.id,
          diff: {
            runId: run.id,
            status: 'completed',
            latencyMs,
            provider: providerResult.provider,
            phase: config.phase,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    return serializeAgentRun(updated);
  } catch (err) {
    const finishedAt = new Date();
    const latencyMs = finishedAt.getTime() - startedAt.getTime();
    const errorMessage = err instanceof Error ? err.message : String(err);

    const [updated] = await prisma.$transaction([
      prisma.agentRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: errorMessage,
          finishedAt,
          latencyMs,
        },
      }),
      prisma.agent.update({
        where: { id: agent.id },
        data: { status: 'error' },
      }),
      prisma.auditLog.create({
        data: {
          orgId,
          userId,
          action: 'agent.run',
          targetType: 'agent',
          targetId: agent.id,
          diff: {
            runId: run.id,
            status: 'failed',
            error: errorMessage,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    return serializeAgentRun(updated);
  }
}

// ─── Agent run listing ────────────────────────────────────────────────────────

export async function listAgentRuns(
  orgId: string,
  options: { agentId?: string; limit: number; cursor?: string },
) {
  const where: Prisma.AgentRunWhereInput = {
    orgId,
    deletedAt: null,
    ...(options.agentId ? { agentId: options.agentId } : {}),
  };

  const items = await prisma.agentRun.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options.limit + 1,
    ...(options.cursor ? { skip: 1, cursor: { id: options.cursor } } : {}),
  });

  let nextCursor: string | undefined;
  if (items.length > options.limit) {
    nextCursor = items[options.limit]!.id;
    items.pop();
  }

  return { items: items.map(serializeAgentRun), nextCursor };
}
