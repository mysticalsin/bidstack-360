// Org-level settings surfaces. First route: ABC opportunity filter rules (M6),
// adjustable in Settings without a code change. Read returns defaults when no
// OrgSettings row exists yet.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma } from '@bidstack/db';
import { OpportunityFilterRules, OpportunityFilterRulesUpdate } from '@bidstack/shared';

function parseRules(value: unknown): OpportunityFilterRules {
  const parsed = OpportunityFilterRules.safeParse(value ?? {});
  return parsed.success
    ? parsed.data
    : {
        includeExpertiseTypes: [],
        includeSolutionTypes: [],
        frameworkAgreementTypes: [],
        excludeNonFramework: false,
      };
}

export const orgSettingsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/org-settings/opportunity-filters',
    {
      preHandler: [server.requirePermission('settings:read')],
      schema: { response: { 200: OpportunityFilterRules } },
    },
    async (req) => {
      const row = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { opportunityFilterRules: true },
      });
      return parseRules(row?.opportunityFilterRules);
    },
  );

  server.put(
    '/org-settings/opportunity-filters',
    {
      preHandler: [server.requirePermission('settings:write')],
      schema: { body: OpportunityFilterRulesUpdate, response: { 200: OpportunityFilterRules } },
    },
    async (req) => {
      const existing = await prisma.orgSettings.findFirst({
        where: { orgId: req.auth.orgId, deletedAt: null },
        select: { opportunityFilterRules: true },
      });
      const merged = { ...parseRules(existing?.opportunityFilterRules), ...req.body };
      // Re-validate the merged result so partial updates can't produce an
      // invalid stored shape.
      const rules = OpportunityFilterRules.parse(merged);
      await prisma.orgSettings.upsert({
        where: { orgId: req.auth.orgId },
        create: { orgId: req.auth.orgId, opportunityFilterRules: rules },
        update: { opportunityFilterRules: rules },
      });
      await prisma.auditLog.create({
        data: {
          orgId: req.auth.orgId,
          userId: req.auth.userId,
          action: 'org_settings.opportunity_filters.update',
          targetType: 'org_settings',
          targetId: req.auth.orgId,
          diff: req.body as object,
        },
      });
      return rules;
    },
  );
};
