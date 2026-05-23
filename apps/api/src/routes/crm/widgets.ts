import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';
import { DashboardWidget } from '@bidstack/shared';

import { persistWidgets } from '../../services/crm/widget.service.js';

const WidgetsPatchBody = z.object({
  widgets: z.array(DashboardWidget).max(50),
});

const DashboardWidgetsResponse = z.object({
  widgets: z.array(DashboardWidget),
});

export const crmWidgetRoutes: FastifyPluginAsyncZod = async (server) => {
  server.patch(
    '/crm/widgets',
    {
      schema: {
        body: WidgetsPatchBody,
        response: { 200: DashboardWidgetsResponse },
      },
    },
    async (req) => {
      const widgets = await persistWidgets(req.auth.orgId, prisma, req.body.widgets);
      return { widgets };
    },
  );
};
