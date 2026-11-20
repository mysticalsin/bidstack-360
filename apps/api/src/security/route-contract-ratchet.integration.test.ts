/**
 * Route contract ratchet: request validation and rate limits.
 *
 * 1. Every POST/PUT/PATCH route declares a zod body schema, or is in
 *    BODYLESS_BASELINE. The baseline may only shrink: a new route without a
 *    body schema fails, and an entry that gained a schema (or was removed)
 *    fails until it is deleted from the list.
 * 2. Every public (unauthenticated) route declares a per-route rate limit, or
 *    is in PUBLIC_GLOBAL_LIMIT_ONLY with a reason. The global per-IP limiter
 *    in server.ts still applies to those.
 * 3. Token-bearing public routes actually answer 429 once their limit is hit.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type Collected = {
  method: string;
  url: string;
  isPublic: boolean;
  hasBody: boolean;
  rateLimitMax: number | null;
  websocket: boolean;
};
const collected: Collected[] = [];
vi.mock('../server.routes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server.routes.js')>();
  return {
    ...actual,
    registerRoutes: async (server: import('fastify').FastifyInstance) => {
      server.addHook('onRoute', (opts) => {
        const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
        const config = (opts.config ?? {}) as {
          public?: boolean;
          rateLimit?: { max?: number };
        };
        for (const m of methods) {
          if (m === 'HEAD' || m === 'OPTIONS') continue;
          collected.push({
            method: m,
            url: opts.url,
            isPublic: Boolean(config.public),
            hasBody: Boolean((opts.schema as { body?: unknown } | undefined)?.body),
            rateLimitMax: typeof config.rateLimit?.max === 'number' ? config.rateLimit.max : null,
            websocket: Boolean((opts as { websocket?: boolean }).websocket),
          });
        }
      });
      await actual.registerRoutes(server);
    },
  };
});

import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';

/**
 * Mutation routes with no body schema. Id-only actions (approve, retry, test,
 * mark read) take no body; the three public ones verify a raw body by hand.
 * Shrink this list; never grow it.
 */
const BODYLESS_BASELINE = new Set<string>([
  'POST /api/v1/opportunities/:id/brief',
  'POST /api/v1/reports/:id/duplicate',
  'POST /api/v1/sales-toolkits/store/import-sharepoint',
  'POST /api/v1/msa/:id/versions/:versionId/reextract',
  'POST /api/v1/meeting-intel/flags/:id/dismiss',
  'POST /api/v1/meeting-intel/sources/abc/sync',
  'POST /api/v1/mars/sync',
  'POST /api/v1/mars/webhook',
  'PATCH /api/v1/project-references/:id/validate',
  'POST /api/v1/kam/sessions/:id/pull-transcript',
  'POST /api/v1/kam/drafts/:id/approve',
  'POST /api/v1/kam/drafts/:id/reject',
  'POST /api/v1/kam/handoffs/:id/export',
  'POST /api/v1/crm/companies/:companyKey/technical-stack/suggestions/:suggestionId/accept',
  'POST /api/v1/crm/companies/:companyKey/technical-stack/suggestions/:suggestionId/dismiss',
  'POST /api/v1/crm/provider-health/test',
  'PUT /api/v1/files/local-upload',
  'POST /api/v1/integrations/dust/push-deal/:id',
  'POST /api/v1/integrations/dust/resync',
  'POST /api/v1/integrations/agent-providers/credentials/:provider/test',
  'POST /api/v1/integrations/data-providers/credentials/:provider/test',
  'POST /api/v1/mentions/:id/read',
  'PATCH /api/v1/notifications/:id/read',
  'POST /api/v1/notifications/read-all',
  'POST /api/v1/email-templates/:id/track-use',
  'POST /api/v1/leads/:id/recovery-suggest',
  'POST /api/v1/webhook-subscriptions/:id/test',
  'POST /api/v1/references/:id/use',
  'POST /api/v1/bid-scores/:opportunityId/ai-calibrate',
  'POST /api/v1/bid-scores/:id/defend',
  'POST /api/v1/proposals/:id/submit',
  'POST /api/v1/proposals/:id/revise',
  'POST /api/v1/crews/seed-standard',
  'POST /api/v1/crew-runs/:id/cancel',
  'POST /api/v1/crew-runs/:id/retry',
  'POST /api/v1/signatures/webhook/docusign',
  'POST /api/v1/onboarding/templates/:template/install',
  'POST /api/v1/integrations/twilio/test',
  'POST /api/v1/calls/:id/extract-insights',
  'POST /api/v1/accounts/:id/churn-signals/:signalId/acknowledge',
  'POST /api/v1/public/nps/:token',
  'POST /api/v1/bid-workspaces/:workspaceId/rfp/:orchestrationId/approve-drafting',
  'POST /api/v1/orgs/:orgId/export',
]);

const PROVIDER_WEBHOOK =
  'Signature-verified provider webhook; provider egress IPs are shared, so a tight per-IP limit would drop real traffic.';

/** Public routes that rely on the global per-IP limiter only. */
const PUBLIC_GLOBAL_LIMIT_ONLY: Record<string, string> = {
  'GET /api/v1/logo': 'Cached logo proxy; one page renders many logos from the same IP.',
  'POST /api/v1/signatures/webhook/docusign': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/slack/events': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/slack/commands': PROVIDER_WEBHOOK,
  'GET /api/v1/integrations/microsoft/webhook': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/microsoft/webhook': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/twilio/webhook/status': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/twilio/webhook/inbound': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/zoom/webhook': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/teams/webhook': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/twilio-voice/webhook': PROVIDER_WEBHOOK,
  'POST /api/v1/integrations/twilio-voice/twiml/:callSessionId': PROVIDER_WEBHOOK,
};

/** Token-bearing public routes: a guessed token must hit 429 quickly. */
const TOKEN_ROUTES = [
  'GET /api/v1/sign/:token',
  'POST /api/v1/sign/:token',
  'GET /api/v1/public/nps/:token',
  'POST /api/v1/public/nps/:token',
  'POST /api/v1/nps/surveys/:id/respond',
  'GET /api/v1/migrations/hubspot/callback',
];

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH']);
const key = (r: Collected) => `${r.method} ${r.url}`;

let server: FastifyInstance;

beforeAll(async () => {
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
});

describe('route contract ratchet', () => {
  it('collects the route set', () => {
    expect(collected.length).toBeGreaterThan(500);
  });

  it('every new mutation route declares a body schema', () => {
    const missing = collected
      .filter((r) => !r.websocket && MUTATIONS.has(r.method) && !r.hasBody)
      .map(key)
      .filter((k) => !BODYLESS_BASELINE.has(k));
    expect(missing, `Mutation routes without schema.body:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the bodyless baseline only shrinks', () => {
    const bodyless = new Set(
      collected.filter((r) => MUTATIONS.has(r.method) && !r.hasBody).map(key),
    );
    const stale = [...BODYLESS_BASELINE].filter((k) => !bodyless.has(k));
    expect(stale, `Remove from BODYLESS_BASELINE:\n${stale.join('\n')}`).toEqual([]);
  });

  it('every public route declares a per-route rate limit or a reason', () => {
    const missing = collected
      .filter((r) => r.isPublic && r.rateLimitMax === null)
      .map(key)
      .filter((k) => !(k in PUBLIC_GLOBAL_LIMIT_ONLY));
    expect(missing, `Public routes without config.rateLimit:\n${missing.join('\n')}`).toEqual([]);
    const live = new Set(collected.map(key));
    expect(Object.keys(PUBLIC_GLOBAL_LIMIT_ONLY).filter((k) => !live.has(k))).toEqual([]);
  });

  it.each(TOKEN_ROUTES)('%s answers 429 after its limit', async (routeKey) => {
    const route = collected.find((r) => key(r) === routeKey);
    expect(route?.isPublic, `${routeKey} must be registered as public`).toBe(true);
    expect(route?.rateLimitMax, `${routeKey} needs config.rateLimit`).not.toBeNull();
    const max = route!.rateLimitMax!;
    expect(max).toBeLessThanOrEqual(30);
    const url = route!.url.replace(/:[A-Za-z]+/g, 'x'.repeat(40));
    const remoteAddress = `203.0.113.${TOKEN_ROUTES.indexOf(routeKey) + 10}`;
    const statuses: number[] = [];
    for (let i = 0; i <= max; i += 1) {
      const res = await server.inject({
        method: route!.method as 'GET',
        url,
        remoteAddress,
        ...(route!.method === 'POST'
          ? { headers: { 'content-type': 'application/json' }, payload: '{}' }
          : {}),
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, max)).not.toContain(429);
    expect(statuses[max]).toBe(429);
  });
});
