/**
 * Route authorization census (secure-by-default regression guard).
 *
 * Boots the REAL server with every RBAC decision forced to DENY and request
 * validation disabled, then fires one request at every registered route as an
 * authenticated (stub) user. A route is "gated" when it consulted the RBAC
 * decision layer (requirePermission / requireRole / hasPermission) during the
 * request. Anything that answered without consulting RBAC must be listed in
 * UNGATED_ALLOWLIST with a reason (public token routes, signed webhooks,
 * self-scoped personal data, probes). A new route that forgets its gate fails
 * this suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const rbacCalls: string[] = [];
vi.mock('../lib/rbac-decision-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rbac-decision-cache.js')>();
  return {
    ...actual,
    userHasPermission: vi.fn(async (_o: string, _u: string, perm: string) => {
      rbacCalls.push(`perm:${perm}`);
      return false;
    }),
    userHasAnyRole: vi.fn(async (_o: string, _u: string, roles: string[]) => {
      rbacCalls.push(`role:${roles.join('|')}`);
      return false;
    }),
  };
});

// Accept any input so the request reaches preHandler (where gates live) even
// with a placeholder body. Handlers never run for gated routes (403 first).
vi.mock('fastify-type-provider-zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fastify-type-provider-zod')>();
  return {
    ...actual,
    validatorCompiler: () => (data: unknown) => ({ value: data }),
  };
});

type Collected = { method: string; url: string; isPublic: boolean; websocket: boolean };
const collected: Collected[] = [];
vi.mock('../server.routes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server.routes.js')>();
  return {
    ...actual,
    registerRoutes: async (server: import('fastify').FastifyInstance) => {
      server.addHook('onRoute', (opts) => {
        const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
        for (const m of methods) {
          if (m === 'HEAD' || m === 'OPTIONS') continue;
          collected.push({
            method: m,
            url: opts.url,
            isPublic: Boolean((opts.config as { public?: boolean } | undefined)?.public),
            websocket: Boolean((opts as { websocket?: boolean }).websocket),
          });
        }
      });
      await actual.registerRoutes(server);
    },
  };
});

import type { FastifyInstance } from 'fastify';
import { prisma } from '@bidstack/db';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { UNGATED_ALLOWLIST } from './route-authz-allowlist.js';

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const org = await createIsolatedOrg('authz-census');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
});

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
});

const PLACEHOLDER_ID = 'cmcensus0000000000000000';

function concretePath(url: string): string {
  // `:type` params are enums of entity kinds; use a real one so the route
  // reaches its permission check instead of rejecting the kind with a 400.
  return url.replace(/:type\b/g, 'opportunity').replace(/:[A-Za-z0-9_]+(\([^)]*\))?/g, PLACEHOLDER_ID).replace(/\*$/, 'x');
}

describe('route authorization census', () => {
  it('every authenticated route consults RBAC or is explicitly allowlisted', async () => {
    const ungated: string[] = [];
    for (const r of collected) {
      if (r.websocket) continue;
      const key = `${r.method} ${r.url}`;
      rbacCalls.length = 0;
      const res = await server.inject({
        method: r.method as 'GET',
        url: concretePath(r.url),
        ...(r.method === 'GET' || r.method === 'DELETE'
          ? {}
          : { headers: { 'content-type': 'application/json' }, payload: '{}' }),
      });
      const gated = rbacCalls.length > 0 && res.statusCode === 403;
      if (!gated && !r.isPublic && !(key in UNGATED_ALLOWLIST)) {
        ungated.push(`${key} -> ${res.statusCode}`);
      }
    }
    expect(collected.length).toBeGreaterThan(300);
    expect(ungated, `Routes reachable without an RBAC gate:\n${ungated.join('\n')}`).toEqual([]);
  }, 300_000);

  it('allowlist has no stale entries', () => {
    const live = new Set(collected.map((r) => `${r.method} ${r.url}`));
    const stale = Object.keys(UNGATED_ALLOWLIST).filter((k) => !live.has(k));
    expect(stale).toEqual([]);
  });
});
