import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

interface DefaultStage {
  key: string;
  name: string;
  orderIndex: number;
  probability: number;
  color: string;
  forecastCategory?: string;
  isWon?: boolean;
  isLost?: boolean;
}

const DEFAULT_STAGES: DefaultStage[] = [
  { key: 's1_lead', name: 'S1 Lead', orderIndex: 0, probability: 10, color: '#3b82f6' },
  { key: 's1_ongoing', name: 'S1 Ongoing', orderIndex: 1, probability: 25, color: '#6366f1' },
  { key: 's2_sent', name: 'S2 Sent', orderIndex: 2, probability: 40, color: '#06b6d4' },
  {
    key: 's3_technical_iteration',
    name: 'S3 Technical Iteration',
    orderIndex: 3,
    probability: 60,
    color: '#14b8a6',
  },
  {
    key: 's4_negotiation',
    name: 'S4 Negotiation',
    orderIndex: 4,
    probability: 80,
    color: '#f59e0b',
  },
  {
    key: 'closed_won',
    name: 'Closed Won',
    orderIndex: 5,
    probability: 100,
    color: '#10b981',
    forecastCategory: 'closed_won',
    isWon: true,
  },
  {
    key: 'closed_lost',
    name: 'Closed Lost',
    orderIndex: 6,
    probability: 0,
    color: '#ef4444',
    forecastCategory: 'closed_lost',
    isLost: true,
  },
];

const PipelineStageSettings = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  orderIndex: z.number().int(),
  probability: z.number().min(0).max(100),
  forecastCategory: z.string(),
  isWon: z.boolean(),
  isLost: z.boolean(),
  color: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

const PipelineStageSettingsPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    probability: z.number().min(0).max(100).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'At least one field is required' });

type PipelineStageRecord = {
  id: string;
  key: string;
  name: string;
  orderIndex: number;
  probability: unknown;
  forecastCategory: string;
  isWon: boolean;
  isLost: boolean;
  color: string | null;
  updatedAt: Date;
};

export const pipelineStageRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/pipeline-stages',
    {
      schema: {
        response: { 200: z.object({ items: z.array(PipelineStageSettings) }) },
      },
    },
    async (req) => {
      const pipelineId = await ensureDefaultPipeline(req.auth.orgId);
      const items = await prisma.pipelineStage.findMany({
        where: {
          orgId: req.auth.orgId,
          pipelineId,
          archived: false,
          deletedAt: null,
        },
        orderBy: { orderIndex: 'asc' },
        take: 100,
      });
      return { items: items.map(serializeStage) };
    },
  );

  server.patch(
    '/pipeline-stages/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: PipelineStageSettingsPatch,
        response: { 200: PipelineStageSettings },
      },
    },
    async (req) => {
      const existing = await prisma.pipelineStage.findFirst({
        where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
      });
      if (!existing) throw server.httpErrors.notFound('Pipeline stage not found');

      const [updated] = await prisma.$transaction([
        prisma.pipelineStage.update({
          where: { id: existing.id },
          data: {
            ...(req.body.name !== undefined ? { name: req.body.name } : {}),
            ...(req.body.probability !== undefined ? { probability: req.body.probability } : {}),
            ...(req.body.color !== undefined ? { color: req.body.color } : {}),
          },
        }),
        prisma.auditLog.create({
          data: {
            orgId: req.auth.orgId,
            userId: req.auth.userId,
            action: 'pipeline_stage.update',
            targetType: 'pipeline_stage',
            targetId: existing.id,
            diff: req.body,
          },
        }),
      ]);

      return serializeStage(updated);
    },
  );
};

async function ensureDefaultPipeline(orgId: string): Promise<string> {
  const existingDefault = await prisma.pipeline.findFirst({
    where: { orgId, isDefault: true, archived: false, deletedAt: null },
    select: { id: true },
  });

  if (existingDefault) {
    await ensureDefaultStages(orgId, existingDefault.id);
    return existingDefault.id;
  }

  const firstPipeline = await prisma.pipeline.findFirst({
    where: { orgId, archived: false, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (firstPipeline) {
    await prisma.pipeline.update({ where: { id: firstPipeline.id }, data: { isDefault: true } });
    await ensureDefaultStages(orgId, firstPipeline.id);
    return firstPipeline.id;
  }

  return prisma.$transaction(async (tx) => {
    const pipeline = await tx.pipeline.create({
      data: { orgId, name: 'Default Sales Pipeline', isDefault: true },
      select: { id: true },
    });
    await tx.pipelineStage.createMany({
      data: DEFAULT_STAGES.map((stage) => ({
        orgId,
        pipelineId: pipeline.id,
        key: stage.key,
        name: stage.name,
        orderIndex: stage.orderIndex,
        probability: stage.probability,
        color: stage.color,
        forecastCategory: stage.forecastCategory ?? 'pipeline',
        isWon: stage.isWon ?? false,
        isLost: stage.isLost ?? false,
      })),
      skipDuplicates: true,
    });
    return pipeline.id;
  });
}

async function ensureDefaultStages(orgId: string, pipelineId: string): Promise<void> {
  const existingStages = await prisma.pipelineStage.findMany({
    where: { orgId, pipelineId, deletedAt: null },
    select: { key: true },
    take: 100,
  });
  const existingKeys = new Set(existingStages.map((stage) => stage.key));
  const missingStages = DEFAULT_STAGES.filter((stage) => !existingKeys.has(stage.key));
  if (missingStages.length === 0) return;

  await prisma.pipelineStage.createMany({
    data: missingStages.map((stage) => ({
      orgId,
      pipelineId,
      key: stage.key,
      name: stage.name,
      orderIndex: stage.orderIndex,
      probability: stage.probability,
      color: stage.color,
      forecastCategory: stage.forecastCategory ?? 'pipeline',
      isWon: stage.isWon ?? false,
      isLost: stage.isLost ?? false,
    })),
    skipDuplicates: true,
  });
}

function serializeStage(stage: PipelineStageRecord): z.infer<typeof PipelineStageSettings> {
  return {
    id: stage.id,
    key: stage.key,
    name: stage.name,
    orderIndex: stage.orderIndex,
    probability: Number(stage.probability),
    forecastCategory: stage.forecastCategory,
    isWon: stage.isWon,
    isLost: stage.isLost,
    color: stage.color,
    updatedAt: stage.updatedAt.toISOString(),
  };
}
