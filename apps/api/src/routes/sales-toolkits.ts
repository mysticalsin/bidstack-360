// Sales Toolkits — industry-tagged Mantu Academy (360Learning) courses.
// Live fetch (no local storage, per the brief) when configured. When NOT
// configured we return a small set of clearly-labelled SAMPLE courses
// (preview:true) so the section shows its populated shape; the UI banners it
// as sample data and offers the connect prompt. Never silently passes sample
// data off as live.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { fetchLmsCourses, lmsConfigured, LmsError, sampleLmsCourses } from '../lib/lms-360learning.js';

const SalesToolkitsResponse = z.object({
  enabled: z.boolean(),
  // True when items are illustrative sample data, not a live LMS fetch.
  preview: z.boolean(),
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
      if (!lmsConfigured()) {
        return { enabled: false, preview: true, items: sampleLmsCourses(req.query.sector) };
      }
      try {
        const items = await fetchLmsCourses(req.query.sector);
        return { enabled: true, preview: false, items };
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
