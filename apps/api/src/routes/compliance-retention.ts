// Retention report for the caller's org: every data class, its env var, the
// effective period and how many rows are past it. Always a dry run; deletion
// only happens in the retention-sweep worker with RETENTION_MODE=enforce.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { prisma, runRetentionSweep } from '@bidstack/db';
import { RetentionReport } from '@bidstack/shared';

export const complianceRetentionRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/compliance/retention',
    {
      config: { permission: 'settings:read', rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: server.requirePermission('settings:read'),
      schema: { response: { 200: RetentionReport } },
    },
    async (req) => runRetentionSweep(prisma, { dryRun: true, orgId: req.auth.orgId }),
  );
};
