// InfoSearch lead intel for an account — live MCP fetch, flag-gated.
// Viewing also fires the InfoSearch activity webhook (fire-and-forget),
// per the demo brief's usage-logging requirement.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  fetchInfoSearchLeads,
  infosearchConfigured,
  InfoSearchError,
  notifyInfoSearchActivity,
  sampleInfoSearchLeads,
} from '../lib/infosearch-client.js';

const InfoSearchLeadsResponse = z.object({
  enabled: z.boolean(),
  // True when items are illustrative sample data, not a live InfoSearch fetch.
  preview: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      company: z.string().nullable(),
      title: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      listName: z.string().nullable(),
    }),
  ),
});

export const infosearchRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/infosearch/leads',
    {
      // Lead intel is third-party PII; gate it behind the same read scope as
      // other account data so not every authenticated user can pull it.
      preHandler: [server.requirePermission('accounts:read')],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({ account: z.string().trim().min(1).max(255) }),
        response: { 200: InfoSearchLeadsResponse },
      },
    },
    async (req) => {
      if (!infosearchConfigured()) {
        return { enabled: false, preview: true, items: sampleInfoSearchLeads(req.query.account) };
      }
      try {
        const items = await fetchInfoSearchLeads(req.query.account);
        notifyInfoSearchActivity({ account: req.query.account, userEmail: req.auth.email ?? null });
        return { enabled: true, preview: false, items };
      } catch (err) {
        if (err instanceof InfoSearchError) {
          req.log.warn({ err }, 'infosearch fetch failed');
          throw server.httpErrors.badGateway('InfoSearch is unreachable right now');
        }
        throw err;
      }
    },
  );
};
