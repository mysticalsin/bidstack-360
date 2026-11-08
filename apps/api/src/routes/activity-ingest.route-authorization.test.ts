// Generated route-authorization table for the slice 9 routes: every route is
// listed once with the exact permission it needs, and the table drives both
// the deny and the allow assertions for API keys and for human users. Adding a
// route to activity-ingest.ts or sync-now.ts without a row here fails the
// "every registered route is in the table" check.

import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@bidstack/shared';

vi.mock('@bidstack/db', () => ({
  prisma: {
    userRole: { count: vi.fn() },
    company: { findFirst: vi.fn() },
  },
  ingestActivities: vi.fn(),
  getCompanyActivitySummary: vi.fn(),
  listAccountConversations: vi.fn(),
}));

vi.mock('../lib/access-scope.js', () => ({
  getAccessScope: vi.fn(async (_orgId: string, userId: string) => ({
    unrestricted: true,
    countries: [],
    userId,
    companyIds: [],
    msaIds: [],
  })),
  isApiKeyActor: (userId: string) => userId.startsWith('apikey:'),
  applyCompanyScope: (where: unknown) => where,
  applyOpportunityScope: (
    where: unknown,
    scope: { unrestricted: boolean; userId: string; countries: string[] },
  ) => {
    if (scope.unrestricted) return where;
    const variants = [...new Set(scope.countries.flatMap((c) => [c.toUpperCase(), c.toLowerCase()]))];
    return {
      AND: [
        where,
        {
          OR: [
            ...(variants.length
              ? [{ country: { in: variants } }, { territory: { countryCodes: { hasSome: variants } } }]
              : []),
            { ownerId: scope.userId },
          ],
        },
      ],
    };
  },
}));

vi.mock('../services/sync-now/index.js', () => ({
  SYNC_SOURCES: ['dust', 'hubspot'],
  startSyncRun: vi.fn(),
  getSyncRun: vi.fn(),
  getSyncOverview: vi.fn(),
}));

import { getCompanyActivitySummary, ingestActivities, listAccountConversations, prisma } from '@bidstack/db';

import { getAccessScope } from '../lib/access-scope.js';

import { clearRbacDecisionCacheForTest } from '../lib/rbac-decision-cache.js';
import { rbacPlugin } from '../plugins/rbac.js';
import { getSyncOverview, getSyncRun, startSyncRun } from '../services/sync-now/index.js';
import { activityIngestRoutes } from './activity-ingest.js';
import { syncNowRoutes } from './sync-now.js';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const COMPANY_ID = '00000000-0000-4000-8000-000000000003';

const ingestBody = {
  activities: [
    {
      externalSource: 'hubspot',
      externalId: 'call-1',
      type: 'call',
      occurredAt: '2026-11-02T14:30:00Z',
      company: { domain: 'dnb.no' },
    },
  ],
};

type Row = { method: 'GET' | 'POST'; url: string; permission: PermissionKey; body?: unknown };

const ROUTE_TABLE: Row[] = [
  {
    method: 'POST',
    url: '/api/v1/ingest/activities',
    permission: 'ingest:write',
    body: ingestBody,
  },
  {
    method: 'GET',
    url: `/api/v1/companies/${COMPANY_ID}/activity-summary`,
    permission: 'activities:read',
  },
  {
    method: 'GET',
    url: `/api/v1/companies/${COMPANY_ID}/conversations`,
    permission: 'activities:read',
  },
  { method: 'GET', url: '/api/v1/sync-now/dust', permission: 'integrations:read' },
  { method: 'POST', url: '/api/v1/sync-now/dust', permission: 'integrations:write', body: {} },
  { method: 'GET', url: '/api/v1/sync-now/dust/runs/run-1', permission: 'integrations:read' },
  { method: 'GET', url: '/api/v1/sync-now/hubspot', permission: 'integrations:read' },
  { method: 'POST', url: '/api/v1/sync-now/hubspot', permission: 'settings:write', body: {} },
  { method: 'GET', url: '/api/v1/sync-now/hubspot/runs/run-1', permission: 'integrations:read' },
];

type Actor =
  { kind: 'key'; scopes: string[]; readOnly: boolean } | { kind: 'user'; permissions: string[] };

let actor: Actor = { kind: 'user', permissions: [] };
const registered: string[] = [];
const openapiTags = new Map<string, string[]>();

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const m of methods) {
      if (m === 'HEAD') continue;
      registered.push(`${m} ${route.url}`);
      openapiTags.set(
        `${m} ${route.url}`,
        (route.schema as { tags?: string[] } | undefined)?.tags ?? [],
      );
    }
  });
  app.addHook('onRequest', async (req) => {
    (req as unknown as { auth: unknown }).auth =
      actor.kind === 'key'
        ? {
            orgId: ORG_ID,
            userId: 'apikey:key-1',
            role: 'api',
            scopes: actor.scopes,
            readOnly: actor.readOnly,
          }
        : { orgId: ORG_ID, userId: USER_ID, role: 'member', scopes: [] };
  });
  await app.register(sensible);
  await app.register(rbacPlugin);
  await app.register(activityIngestRoutes, { prefix: '/api/v1' });
  await app.register(syncNowRoutes, { prefix: '/api/v1' });
  return app;
}

function mockUserPermissions() {
  vi.mocked(prisma.userRole.count).mockImplementation((async (args: unknown) => {
    const key = (
      args as { where?: { role?: { permissions?: { some?: { permission?: { key?: string } } } } } }
    )?.where?.role?.permissions?.some?.permission?.key;
    return actor.kind === 'user' && key && actor.permissions.includes(key) ? 1 : 0;
  }) as never);
}

beforeEach(() => {
  vi.stubEnv('BIDSTACK_ALLOW_LEGACY_API_KEY_SCOPES', 'false');
  clearRbacDecisionCacheForTest();
  mockUserPermissions();
  vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: COMPANY_ID } as never);
  vi.mocked(ingestActivities).mockResolvedValue({
    counts: { accepted: 1, updated: 0, skipped: 0 },
    accepted: [
      { index: 0, externalSource: 'hubspot', externalId: 'call-1', activityId: COMPANY_ID },
    ],
    updated: [],
    skipped: [],
  } as never);
  vi.mocked(getCompanyActivitySummary).mockResolvedValue({
    companyId: COMPANY_ID,
    timezone: 'UTC',
    from: '2026-08-17T00:00:00.000Z',
    to: '2026-11-06T00:00:00.000Z',
    total: 0,
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      call: 0,
      email: 0,
      meeting: 0,
      note: 0,
      stage_change: 0,
    })),
    weekly: [],
    overdue: { count: 0, oldestDueAt: null },
  } as never);
  vi.mocked(listAccountConversations).mockResolvedValue({
    companyId: COMPANY_ID,
    items: [],
    nextCursor: null,
    openOpportunities: [],
  });
  const run = {
    runId: 'run-1',
    source: 'dust',
    state: 'queued',
    progress: 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    reasons: [],
  };
  vi.mocked(startSyncRun).mockResolvedValue(run as never);
  vi.mocked(getSyncRun).mockResolvedValue(run as never);
  vi.mocked(getSyncOverview).mockResolvedValue({
    source: 'dust',
    lastSyncedAt: null,
    lastRun: null,
  } as never);
});

describe('slice 9 route authorization table', () => {
  it('lists every registered route exactly once', async () => {
    registered.length = 0;
    const app = await buildApp();
    await app.ready();
    const tableKeys = new Set(
      ROUTE_TABLE.map(
        (r) =>
          `${r.method} ${r.url
            .replace(COMPANY_ID, ':id')
            .replace(/\/(dust|hubspot)/, '/:source')
            .replace('run-1', ':runId')}`,
      ),
    );
    expect(new Set(registered)).toEqual(tableKeys);
    await app.close();
  });

  it('tags every route for the OpenAPI spec', async () => {
    const app = await buildApp();
    await app.ready();
    expect(openapiTags.get('POST /api/v1/ingest/activities')).toContain('Activities');
    expect(openapiTags.get('GET /api/v1/companies/:id/activity-summary')).toContain('Activities');
    expect(openapiTags.get('GET /api/v1/companies/:id/conversations')).toContain('Activities');
    expect(openapiTags.get('POST /api/v1/sync-now/:source')).toContain('Integrations');
    await app.close();
  });

  it('limits conversation opportunities to the viewer access scope', async () => {
    vi.mocked(getAccessScope).mockResolvedValueOnce({
      unrestricted: false,
      countries: ['NO'],
      userId: USER_ID,
      companyIds: [],
      msaIds: [],
    });
    actor = { kind: 'user', permissions: ['activities:read'] };
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/conversations`,
    });
    expect(res.statusCode).toBe(200);
    expect(listAccountConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_ID,
        viewerUserId: USER_ID,
        opportunityWhere: {
          AND: [
            { orgId: ORG_ID, companyId: COMPANY_ID, deletedAt: null },
            {
              OR: [
                { country: { in: ['NO', 'no'] } },
                { territory: { countryCodes: { hasSome: ['NO', 'no'] } } },
                { ownerId: USER_ID },
              ],
            },
          ],
        },
      }),
    );
    await app.close();
  });

  for (const row of ROUTE_TABLE) {
    describe(`${row.method} ${row.url}`, () => {
      it(`denies an API key without ${row.permission}`, async () => {
        actor = {
          kind: 'key',
          scopes: ['activities:write', 'companies:read'].filter((s) => s !== row.permission),
          readOnly: false,
        };
        const app = await buildApp();
        const res = await app.inject({
          method: row.method,
          url: row.url,
          payload: row.body as never,
        });
        expect(res.statusCode).toBe(403);
        await app.close();
      });

      it(`allows an API key holding ${row.permission}`, async () => {
        actor = { kind: 'key', scopes: [row.permission], readOnly: false };
        const app = await buildApp();
        const res = await app.inject({
          method: row.method,
          url: row.url,
          payload: row.body as never,
        });
        // Sync-now on HubSpot is a human-only action (it records the importing user).
        if (row.url.includes('/sync-now/hubspot') && row.method === 'POST') {
          expect(res.statusCode).toBe(403);
        } else {
          expect(res.statusCode).toBeLessThan(300);
        }
        await app.close();
      });

      it(`denies a user without ${row.permission} and allows one with it`, async () => {
        actor = { kind: 'user', permissions: [] };
        let app = await buildApp();
        let res = await app.inject({
          method: row.method,
          url: row.url,
          payload: row.body as never,
        });
        expect(res.statusCode).toBe(403);
        await app.close();

        clearRbacDecisionCacheForTest();
        actor = { kind: 'user', permissions: [row.permission] };
        app = await buildApp();
        res = await app.inject({ method: row.method, url: row.url, payload: row.body as never });
        expect(res.statusCode).toBeLessThan(300);
        await app.close();
      });
    });
  }

  it('a read-only key cannot ingest even with ingest:write', async () => {
    vi.mocked(ingestActivities).mockClear();
    actor = { kind: 'key', scopes: ['ingest:write'], readOnly: true };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/activities',
      payload: ingestBody,
    });
    expect(res.statusCode).toBe(403);
    expect(ingestActivities).not.toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ID }));
    await app.close();
  });

  it('ingest passes the caller org, the key actor and the rest channel to the shared service', async () => {
    vi.mocked(ingestActivities).mockClear();
    actor = { kind: 'key', scopes: ['ingest:write'], readOnly: false };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/activities',
      payload: ingestBody,
    });
    expect(res.statusCode).toBe(200);
    expect(ingestActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ORG_ID,
        channel: 'rest',
        actor: { kind: 'api_key', keyId: 'key-1' },
      }),
    );
    expect(res.json()).toMatchObject({ counts: { accepted: 1, updated: 0, skipped: 0 } });
    await app.close();
  });

  it('rejects a batch over 500 before it reaches the service', async () => {
    vi.mocked(ingestActivities).mockClear();
    actor = { kind: 'key', scopes: ['ingest:write'], readOnly: false };
    const app = await buildApp();
    const one = ingestBody.activities[0]!;
    const activities = Array.from({ length: 501 }, (_, i) => ({ ...one, externalId: `c-${i}` }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/ingest/activities',
      payload: { activities },
    });
    expect(res.statusCode).toBe(400);
    expect(ingestActivities).not.toHaveBeenCalled();
    await app.close();
  });

  it('activity summary 404s for a company outside the org or key scope', async () => {
    vi.mocked(prisma.company.findFirst).mockResolvedValueOnce(null as never);
    actor = { kind: 'key', scopes: ['activities:read'], readOnly: true };
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/activity-summary`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('activity summary rejects an unknown time zone', async () => {
    actor = { kind: 'key', scopes: ['activities:read'], readOnly: true };
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/companies/${COMPANY_ID}/activity-summary?tz=Mars%2FOlympus`,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
