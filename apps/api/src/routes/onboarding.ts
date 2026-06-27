// Onboarding routes — template installation + sample data management.
// All mutating routes require authentication (req.auth.orgId).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  listTemplates,
  installTemplate,
  deleteSampleData,
  hasSampleData,
  type TemplateName,
} from '../services/onboarding.service.js';

const TEMPLATE_NAMES = ['B2B_SAAS', 'AGENCY_CONSULTING', 'ENTERPRISE_SALES', 'INSIDE_SALES'] as const;

const TemplateKey = z.enum(TEMPLATE_NAMES);

const TemplateListItem = z.object({
  key: TemplateKey,
  name: z.string(),
  description: z.string(),
  stageCount: z.number().int(),
});

const InstallResult = z.object({
  pipelineId: z.string().uuid(),
  stagesCreated: z.number().int(),
  leadsCreated: z.number().int(),
  dealsCreated: z.number().int(),
  tasksCreated: z.number().int(),
  notesCreated: z.number().int(),
});

const DeleteResult = z.object({
  leadsDeleted: z.number().int(),
  dealsDeleted: z.number().int(),
  tasksDeleted: z.number().int(),
  notesDeleted: z.number().int(),
  pipelinesDeleted: z.number().int(),
});

const SampleDataStatus = z.object({
  hasSampleData: z.boolean(),
});

export const onboardingRoutes: FastifyPluginAsyncZod = async (server) => {
  // ── GET /onboarding/templates ──────────────────────────────────────────────
  server.get(
    '/onboarding/templates',
    {
      schema: {
        response: { 200: z.array(TemplateListItem) },
      },
    },
    async () => {
      return listTemplates();
    },
  );

  // ── GET /onboarding/sample-data/status ────────────────────────────────────
  server.get(
    '/onboarding/sample-data/status',
    {
      schema: {
        response: { 200: SampleDataStatus },
      },
    },
    async (req) => {
      const has = await hasSampleData(req.auth.orgId);
      return { hasSampleData: has };
    },
  );

  // ── POST /onboarding/templates/:template/install ───────────────────────────
  server.post(
    '/onboarding/templates/:template/install',
    {
      // Mass-creates pipelines/leads/deals/tasks — admin-grade setup write.
      preHandler: [server.requirePermission('settings:write')],
      schema: {
        params: z.object({ template: TemplateKey }),
        response: {
          200: InstallResult,
          409: z.object({ message: z.string() }),
        },
      },
    },
    async (req, reply) => {
      const { template } = req.params;
      try {
        const result = await installTemplate(req.auth.orgId, template as TemplateName);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already installed')) {
          return reply.status(409).send({ message: msg });
        }
        throw err;
      }
    },
  );

  // ── DELETE /onboarding/sample-data ────────────────────────────────────────
  server.delete(
    '/onboarding/sample-data',
    {
      // Bulk-deletes sample data — a read-only role/key must not wipe it.
      preHandler: [server.requirePermission('settings:write')],
      schema: {
        response: { 200: DeleteResult },
      },
    },
    async (req) => {
      return deleteSampleData(req.auth.orgId);
    },
  );
};
