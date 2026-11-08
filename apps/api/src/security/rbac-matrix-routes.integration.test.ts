/**
 * RBAC matrix x route authorization test (generated, deny by default).
 *
 * The census (route-authz-census.integration.test.ts) proves every route
 * consults RBAC. This suite proves the gate a route consults agrees with the
 * role grants, for every role in RBAC_MATRIX (spec) and every role the seed
 * writes for a tenant (runtime). Handlers are replaced by a sentinel so only
 * gates run: no handler side effects, and "reached the handler" is an exact
 * signal instead of a status-code guess.
 *
 * Per authenticated route it records the permission chain the route's gates
 * consult (allow-all pass), then for each role asserts: handler reached <=>
 * the role holds every permission in the chain. It also asserts that every
 * consulted permission is a known key held by at least one role, and that a
 * role with no write grant reaches no mutation handler.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  grants: null as Set<string> | null,
  calls: [] as string[],
}));

vi.mock('../lib/rbac-decision-cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rbac-decision-cache.js')>();
  return {
    ...actual,
    userHasPermission: vi.fn(async (_o: string, _u: string, perm: string) => {
      state.calls.push(`perm:${perm}`);
      return state.grants === null ? true : state.grants.has(perm);
    }),
    userHasAnyRole: vi.fn(async (_o: string, _u: string, roles: string[]) => {
      state.calls.push(`role:${roles.join('|')}`);
      return state.grants === null;
    }),
  };
});

vi.mock('fastify-type-provider-zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fastify-type-provider-zod')>();
  return {
    ...actual,
    validatorCompiler: () => (data: unknown) => ({ value: data }),
  };
});

// Thousands of probes would trip per-route limits (429) and mask decisions.
// Rate limits have their own suite (route-contract-ratchet.integration.test.ts).
vi.mock('@fastify/rate-limit', async () => {
  const { default: fp } = await import('fastify-plugin');
  return {
    default: fp(async (server: import('fastify').FastifyInstance) => {
      server.decorate('createRateLimit', () => async () => ({ isAllowed: true }));
    }),
  };
});

const REACHED = 299;
type Collected = { method: string; url: string; isPublic: boolean; websocket: boolean };
const collected: Collected[] = [];
vi.mock('../server.routes.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server.routes.js')>();
  return {
    ...actual,
    registerRoutes: async (server: import('fastify').FastifyInstance) => {
      server.addHook('onRoute', (opts) => {
        const methods = Array.isArray(opts.method) ? opts.method : [opts.method];
        const websocket = Boolean((opts as { websocket?: boolean }).websocket);
        if (!websocket) {
          opts.handler = async (_req, reply) => reply.code(REACHED).send({ reached: true });
        }
        for (const m of methods) {
          if (m === 'HEAD' || m === 'OPTIONS') continue;
          collected.push({
            method: m,
            url: opts.url,
            isPublic: Boolean((opts.config as { public?: boolean } | undefined)?.public),
            websocket,
          });
        }
      });
      await actual.registerRoutes(server);
    },
  };
});

import type { FastifyInstance } from 'fastify';
import { prisma } from '@bidstack/db';
import { RBAC_MATRIX, isPermissionKey } from '@bidstack/shared';

import { buildServer } from '../server.js';
import { createIsolatedOrg, dropIsolatedOrg, useIsolatedOrgAuth } from '../test-support/isolated-org.js';
import { UNGATED_ALLOWLIST } from './route-authz-allowlist.js';

/**
 * Mutation routes a role without any write grant may reach. Each is a read
 * expressed as POST/DELETE (render, simulate, AI draft, policy check) or acts
 * only on the caller's own row (consent revocation must stay possible).
 */
const READ_LIKE_MUTATIONS: Record<string, string> = {
  'POST /api/v1/reports/run': 'Runs a saved report definition; read only.',
  'POST /api/v1/serum/runtime-policy/agents/:configKey/check': 'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/tools/:configKey/check': 'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/loops/:configKey/check': 'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/connectors/:configKey/check': 'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/model-router/:configKey/check': 'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/dust-mcp-gateway/:configKey/check':
    'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/retrieval/:configKey/check': 'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/prompt-library/:configKey/check':
    'Policy simulation; read only.',
  'POST /api/v1/serum/runtime-policy/evals-quality-gates/:configKey/check':
    'Policy simulation; read only.',
  'POST /api/v1/sillage/account-signals': 'Signal lookup for a list of accounts; read only.',
  'POST /api/v1/meeting-intel/flags/:id/dismiss':
    'Dismisses a flag addressed to the caller (recipientUserId = caller).',
  'DELETE /api/v1/meeting-intel/sources/metis':
    'Revokes the caller’s own meeting-source consent (userId = caller).',
  'POST /api/v1/mentions/:id/read': 'Marks the caller’s own mention read.',
  'PUT /api/v1/companies/:id/follow':
    'Follows or mutes an account the caller can read; writes only the caller’s own follow row.',
  'POST /api/v1/presence': 'Ephemeral presence heartbeat; no record data.',
  'POST /api/v1/email-templates/render': 'Renders a template preview; read only.',
  'POST /api/v1/email-templates/:id/track-use': 'Usage counter on send; no content change.',
  'POST /api/v1/leads/:id/recovery-suggest': 'AI suggestion; nothing persisted.',
  'POST /api/v1/bid-scores/:opportunityId/ai-calibrate': 'AI calibration preview; nothing persisted.',
  'POST /api/v1/bid-scores/:id/defend': 'AI rationale for an existing score; nothing persisted.',
  'POST /api/v1/ai-assistant/email-draft': 'AI draft returned to the caller; nothing sent.',
  'POST /api/v1/ai-assistant/deal-sentiment': 'AI analysis; nothing persisted.',
  'POST /api/v1/ai-assistant/meeting-prep': 'AI brief; nothing persisted.',
  'POST /api/v1/ai-assistant/enrich-contact': 'AI suggestion; nothing persisted.',
  'POST /api/v1/ai-assistant/account-intel': 'AI brief; nothing persisted.',
  'POST /api/v1/ai-assistant/jarvis/runs':
    'Jarvis run; tools check their own permission and writes are only staged.',
  'POST /api/v1/ai-assistant/jarvis/actions/:actionId/confirm':
    'Handler re-checks the staged tool’s write permission before it executes (jarvis.integration.test.ts).',
  'POST /api/v1/ai-assistant/jarvis/actions/:actionId/cancel':
    'Discards the caller’s own staged action; nothing executes.',
  'POST /api/v1/integrations/twilio/test': 'Connection check that sends no SMS.',
  'POST /api/v1/tags/suggest': 'Tag suggestions for a draft entity; nothing persisted.',
};

/** Routes a fully permitted caller still cannot reach, with the reason. */
const FLAG_GATED_PREFIXES: Record<string, string> = {
  '/api/v1/mars/': 'MARS_INTEGRATION_ENABLED is off by default; permitted callers get 404.',
};

/** Permissions no RBAC_MATRIX or seeded role holds, and who grants them. */
const OUT_OF_ROLE_PERMISSIONS: Record<string, string> = {};

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WRITE_SUFFIXES = [':write', ':admin', ':approve'];
const PLACEHOLDER_ID = 'cmrbacmatrix000000000000';

function concretePath(url: string): string {
  return url
    .replace(/:type\b/g, 'opportunity')
    .replace(/:[A-Za-z0-9_]+(\([^)]*\))?/g, PLACEHOLDER_ID)
    .replace(/\*$/, 'x');
}

function flagGated(key: string): boolean {
  const url = key.slice(key.indexOf(' ') + 1);
  return Object.keys(FLAG_GATED_PREFIXES).some((p) => url.startsWith(p));
}

let server: FastifyInstance;
let orgId: string | null = null;
let restoreAuth: (() => void) | null = null;

/**
 * chain: permissions consulted when everything is granted (AND chain).
 * anyOf: permissions consulted when nothing is granted. An OR gate tries
 * every alternative before denying, so more than one entry means "any of".
 */
type Probe = {
  key: string;
  route: Collected;
  chain: string[];
  anyOf: string[];
  reachedAllowAll: boolean;
};

function allowedFor(p: Probe, grants: Set<string>): boolean {
  if (p.anyOf.length > 1) return p.anyOf.some((c) => grants.has(c.slice(5)));
  return p.chain.every((c) => grants.has(c.slice(5)));
}
const probes: Probe[] = [];
const roles = new Map<string, Set<string>>();

async function hit(r: Collected): Promise<{ reached: boolean; calls: string[]; status: number }> {
  state.calls.length = 0;
  const res = await server.inject({
    method: r.method as 'GET',
    url: concretePath(r.url),
    ...(r.method === 'GET' || r.method === 'DELETE'
      ? {}
      : { headers: { 'content-type': 'application/json' }, payload: '{}' }),
  });
  return { reached: res.statusCode === REACHED, calls: [...state.calls], status: res.statusCode };
}

/** Routes whose decision is fully described by a permission chain. */
function permissionGated(): Probe[] {
  return probes.filter(
    (p) =>
      p.chain.length > 0 &&
      [...p.chain, ...p.anyOf].every((c) => c.startsWith('perm:')) &&
      !flagGated(p.key),
  );
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  const org = await createIsolatedOrg('rbac-matrix');
  orgId = org.orgId;
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);

  for (const [name, perms] of Object.entries(RBAC_MATRIX)) {
    roles.set(`matrix:${name}`, new Set(perms));
  }
  const seeded = await prisma.role.findMany({
    where: { orgId: org.orgId, deletedAt: null },
    select: {
      name: true,
      permissions: { where: { deletedAt: null }, select: { permission: { select: { key: true } } } },
    },
  });
  for (const r of seeded) {
    roles.set(`seed:${r.name}`, new Set(r.permissions.map((p) => p.permission.key)));
  }

  server = await buildServer();
  await server.ready();

  for (const r of collected) {
    if (r.websocket || r.isPublic) continue;
    const key = `${r.method} ${r.url}`;
    if (key in UNGATED_ALLOWLIST) continue;
    state.grants = null;
    const allowAll = await hit(r);
    state.grants = new Set();
    const denyAll = await hit(r);
    probes.push({
      key,
      route: r,
      chain: [...new Set(allowAll.calls)],
      anyOf: [...new Set(denyAll.calls)],
      reachedAllowAll: allowAll.reached,
    });
  }
  state.grants = null;
}, 300_000);

afterAll(async () => {
  await server?.close();
  restoreAuth?.();
  if (orgId) await dropIsolatedOrg(orgId);
});

describe('RBAC matrix x routes', () => {
  it('collects the authenticated route set and both role sources', () => {
    expect(probes.length).toBeGreaterThan(300);
    expect(permissionGated().length).toBeGreaterThan(300);
    expect([...roles.keys()].filter((k) => k.startsWith('matrix:'))).toHaveLength(6);
    expect([...roles.keys()].filter((k) => k.startsWith('seed:')).length).toBeGreaterThan(6);
  });

  it('every gated route reaches its handler when every permission is granted', () => {
    const blocked = probes.filter((p) => !p.reachedAllowAll && !flagGated(p.key)).map((p) => p.key);
    expect(blocked, `Routes that deny an all-permission caller:\n${blocked.join('\n')}`).toEqual([]);
  });

  it('every consulted permission is a known key held by at least one role', () => {
    const granted = new Set([...roles.values()].flatMap((s) => [...s]));
    const problems: string[] = [];
    for (const p of probes) {
      for (const c of p.chain) {
        if (!c.startsWith('perm:')) continue;
        const perm = c.slice(5);
        if (!isPermissionKey(perm)) problems.push(`${p.key}: unknown permission ${perm}`);
        else if (!granted.has(perm) && !(perm in OUT_OF_ROLE_PERMISSIONS)) {
          problems.push(`${p.key}: ${perm} is held by no role`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('for every role, a route is reachable iff the role holds its whole permission chain', async () => {
    const mismatches: string[] = [];
    let checks = 0;
    try {
      for (const [role, grants] of roles) {
        state.grants = grants;
        for (const p of permissionGated()) {
          const expected = allowedFor(p, grants);
          const { reached, status } = await hit(p.route);
          checks += 1;
          if (reached !== expected || (!expected && status !== 403)) {
            const gate = p.anyOf.length > 1 ? `any of ${p.anyOf.join(', ')}` : p.chain.join(', ');
            mismatches.push(
              `${role} ${p.key} [${gate}]: expected ${expected ? 'allow' : 'deny'}, got ${status}`,
            );
          }
        }
      }
    } finally {
      state.grants = null;
    }
    expect(checks).toBeGreaterThan(300 * 12);
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  }, 600_000);

  it('a role with no write grant reaches no mutation handler', async () => {
    const readOnlyRoles = [...roles].filter(
      ([, grants]) => ![...grants].some((g) => WRITE_SUFFIXES.some((s) => g.endsWith(s))),
    );
    expect(readOnlyRoles.map(([name]) => name)).toEqual(
      expect.arrayContaining(['matrix:Read-Only', 'seed:Read-only']),
    );
    const reached: string[] = [];
    try {
      for (const [role, grants] of readOnlyRoles) {
        state.grants = grants;
        for (const p of permissionGated()) {
          if (!MUTATIONS.has(p.route.method) || p.key in READ_LIKE_MUTATIONS) continue;
          const res = await hit(p.route);
          if (res.reached || res.status !== 403) {
            reached.push(`${role} ${p.key} [${p.chain.join(', ')}] -> ${res.status}`);
          }
        }
      }
    } finally {
      state.grants = null;
    }
    expect(reached, `Mutation routes a read-only role can reach:\n${reached.join('\n')}`).toEqual([]);
  }, 300_000);

  it('allowlists have no stale entries', () => {
    const live = new Set(probes.map((p) => p.key));
    expect(Object.keys(READ_LIKE_MUTATIONS).filter((k) => !live.has(k))).toEqual([]);
    expect(
      Object.keys(FLAG_GATED_PREFIXES).filter((p) => ![...live].some((k) => k.includes(` ${p}`))),
    ).toEqual([]);
  });
});
