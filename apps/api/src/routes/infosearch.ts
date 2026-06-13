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
} from '../lib/infosearch-client.js';

const InfoSearchLeadsResponse = z.object({
  enabled: z.boolean(),
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
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        querystring: z.object({ account: z.string().trim().min(1).max(255) }),
        response: { 200: InfoSearchLeadsResponse },
      },
    },
    async (req) => {
      if (!infosearchConfigured()) return { enabled: false, items: [] };
      try {
        const items = await fetchInfoSearchLeads(req.query.account);
        notifyInfoSearchActivity({ account: req.query.account, userEmail: req.auth.email ?? null });
        return { enabled: true, items };
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
