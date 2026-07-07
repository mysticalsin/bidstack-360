// Sillage intent detection — thin RBAC'd wrapper around the MCP-first/REST-
// fallback provider (providers/sillage-intent.ts). Fails open: the provider
// never throws, so a misconfigured or unreachable Sillage never 5xxs the
// caller, it just returns { intent: null, source: null, error }.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Logger as PinoLogger } from 'pino';
import { z } from 'zod';

import { detectSillageIntent } from '../providers/sillage-intent.js';

const DetectIntentBody = z.object({
  text: z.string().trim().min(1).max(5_000),
  context: z.record(z.unknown()).optional(),
});

const DetectIntentResponse = z.object({
  intent: z.string().nullable(),
  confidence: z.number().nullable(),
  source: z.enum(['mcp', 'rest']).nullable(),
  error: z.string().optional(),
});

export const sillageIntentRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/sillage/detect-intent',
    {
      // Intent detection runs over free-text (activity notes, call/email
      // snippets), not a specific account record, so it's gated at the same
      // read tier as the AI assistant's meeting-prep route (activities:read)
      // rather than accounts:read — no account lookup happens here.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' }, permission: 'activities:read' },
      preHandler: [server.requirePermission('activities:read')],
      schema: { body: DetectIntentBody, response: { 200: DetectIntentResponse } },
    },
    async (req) =>
      detectSillageIntent({
        text: req.body.text,
        context: req.body.context,
        logger: req.log as PinoLogger,
      }),
  );
};
