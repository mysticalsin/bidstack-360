// Sales Toolkits — industry-tagged Mantu Academy (360Learning) courses.
// Always a LIVE fetch (no local storage, per the brief); when the integration
// is disabled or unconfigured the route says so and the UI shows its
// "Connect LMS" prompt instead of an empty grid.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { fetchLmsCourses, lmsConfigured, LmsError } from '../lib/lms-360learning.js';

const SalesToolkitsResponse = z.object({
  enabled: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      sectorTags: z.array(z.string()),
      url: z.string().nullable(),
    }),
  ),
});

export const salesToolkitsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/sales-toolkits',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({ sector: z.string().trim().max(120).optional() }),
        response: { 200: SalesToolkitsResponse },
      },
    },
    async (req) => {
      if (!lmsConfigured()) return { enabled: false, items: [] };
      try {
        const items = await fetchLmsCourses(req.query.sector);
        return { enabled: true, items };
      } catch (err) {
        if (err instanceof LmsError) {
          req.log.warn({ err }, 'sales-toolkits LMS fetch failed');
          throw server.httpErrors.badGateway('Mantu Academy is unreachable right now');
        }
        throw err;
      }
    },
  );
};
