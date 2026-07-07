// Sillage buying-intent signals -- thin RBAC'd wrapper around the MCP-first/
// REST-fallback provider (providers/sillage-signals.ts). Fails open: the
// provider never throws, so a misconfigured or unreachable Sillage never
// 5xxs the caller, it just returns { signals: [], source: null, error }.
import { Trigger } from '@bidstack/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Logger as PinoLogger } from 'pino';
import { z } from 'zod';

import { fetchSillageAccountSignals } from '../providers/sillage-signals.js';

const AccountSignalsBody = z
  .object({
    companyName: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    accountId: z.string().uuid().optional(),
  })
  .refine((body) => Boolean(body.companyName || body.domain), {
    message: 'companyName or domain is required',
    path: ['companyName'],
  });

const AccountSignalsResponse = z.object({
  signals: z.array(Trigger),
  intentScore: z.number().nullable(),
  source: z.enum(['mcp', 'rest']).nullable(),
  error: z.string().optional(),
});

export const sillageSignalsRoutes: FastifyPluginAsyncZod = async (server) => {
  server.post(
    '/sillage/account-signals',
    {
      // Buying-intent signals are looked up per target account, not tied to
      // a specific activity record, but this mirrors the AI assistant's
      // meeting-prep route's read tier (activities:read) rather than
      // accounts:read -- no account record lookup happens here, the caller
      // supplies the company identity directly.
      config: { rateLimit: { max: 30, timeWindow: '1 minute' }, permission: 'activities:read' },
      preHandler: [server.requirePermission('activities:read')],
      schema: { body: AccountSignalsBody, response: { 200: AccountSignalsResponse } },
    },
    async (req) =>
      fetchSillageAccountSignals({
        companyName: req.body.companyName,
        domain: req.body.domain,
        accountId: req.body.accountId,
        logger: req.log as PinoLogger,
      }),
  );
};
