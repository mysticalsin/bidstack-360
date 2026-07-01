// Auth plugin.
// Production: Clerk JWT verification via @clerk/fastify.
// Dev: stub mode. Mints a single-org / single-user session backed by the
// seeded fixture data so the app boots without external dependencies.
//
// Stub mode is guarded by NODE_ENV === 'development' and will refuse to run
// in production even if CLERK_SECRET_KEY is missing.

import { createHash } from 'node:crypto';

import { verifyToken } from '@clerk/backend';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { prisma } from '@bidstack/db';

import { emailDomainForTelemetry } from '../lib/email-privacy.js';
import { invalidateRbacDecisionCache } from '../lib/rbac-decision-cache.js';
import { writeAuthAudit } from './auth-audit.js';
import { ensureAdminRoleGrant, mapClerkRole } from './auth-helpers.js';
import { isDemoMode, resolveDemoAuth } from './demo-auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
  }
  // Allow per-route opt-out of auth via { config: { public: true } } on the
  // route options. Used by /health and /webhooks/dust.
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export interface AuthContext {
  orgId: string;
  userId: string;
  scopes: string[];
  role: string;
  email?: string;
}

const STUB_CLERK_ORG = 'org_seed_mantu';
const STUB_ROLE_HEADER = 'x-bidstack-e2e-role';
// Test-only seam: lets an integration test point a stub session at a throwaway
// org (clerkOrg value) instead of the shared seed org, so suites can isolate on
// per-file orgs. Same safety envelope as the role header: loopback-only (enforced
// in resolveStubAuth) AND gated behind BIDSTACK_ALLOW_STUB_ORG_HEADER. Never
// reachable in prod (stub auth itself only runs when CLERK_SECRET_KEY is absent
// and NODE_ENV is development/test).
const STUB_ORG_HEADER = 'x-bidstack-e2e-org';
export const SSO_DOMAIN_REJECTED_MESSAGE = 'Sign-in domain is not permitted for this organization.';

// --- Verified-session cache (scale fix) -------------------------------------
//
// The onRequest hook runs verifyClerkAuth on EVERY authenticated request. Its
// DB-side resolution (org lookup + 2 user lookups + a user.upsert + role-sync +
// an auth.login audit-log write) hammered the Postgres PRIMARY once per request.
// At 100k-scale every read request became 3 reads + 1-3 writes — enough to melt
// the primary.
//
// Fix mirrors lib/access-scope.ts: a short-TTL, bounded in-process cache of the
// resolved AuthContext keyed by the VERIFIED token identity. On a hit we skip
// ALL DB lookups/writes (and the JIT upsert / role-sync / auth.login audit). The
// JWT signature is still verified every request (CPU, not DB) and the SSO domain
// check still runs every request — only the DB resolution is cached.
//
// The cache key folds in sub + sid + org + role, so a Clerk Dashboard role
// change (different org_role claim) produces a different key and re-runs the
// miss path immediately; even without that, the 60s TTL bounds staleness exactly
// like access-scope. A different org/user/token can never collide because all of
// those identity components are part of the key. We hash so raw token claims
// never sit in a Map key.
const AUTH_CACHE_TTL_MS = 60_000;
// Drop the whole cache past this size instead of LRU bookkeeping — same rationale
// as access-scope.ts: a rare full rebuild is cheaper than per-entry eviction.
const MAX_AUTH_CACHE_ENTRIES = 50_000;

const authCache = new Map<string, { auth: AuthContext; expiresAt: number }>();

interface VerifiedClaims {
  clerkOrgId: string;
  clerkUserId: string;
  sessionId: string | undefined;
  orgRole: string | undefined;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Stable cache key for a verified session. Folds every identity component that
 * could change the resolved AuthContext (user, session, org, role) so distinct
 * principals never collide and a role change re-keys instead of serving stale.
 */
function authCacheKey(claims: VerifiedClaims): string {
  return createHash('sha256')
    .update(
      [claims.clerkUserId, claims.sessionId ?? '', claims.clerkOrgId, claims.orgRole ?? ''].join(
        '|',
      ),
    )
    .digest('hex');
}

/** Test-only seam: clears the verified-session cache between cases. */
export function __clearAuthCacheForTests(): void {
  authCache.clear();
}

const STUB_ROLE_OVERRIDES: Record<
  string,
  { systemRole: string; legacyRole: string; email: string; name: string; clerkUser: string }
> = {
  admin: {
    systemRole: 'Admin',
    legacyRole: 'admin',
    email: 'e2e-admin@bidstack.local',
    name: 'E2E Admin',
    clerkUser: 'e2e_admin',
  },
  manager: {
    systemRole: 'Sales Manager',
    legacyRole: 'manager',
    email: 'e2e-manager@bidstack.local',
    name: 'E2E Sales Manager',
    clerkUser: 'e2e_sales_manager',
  },
  'sales-manager': {
    systemRole: 'Sales Manager',
    legacyRole: 'manager',
    email: 'e2e-manager@bidstack.local',
    name: 'E2E Sales Manager',
    clerkUser: 'e2e_sales_manager',
  },
  'read-only': {
    systemRole: 'Read-Only',
    legacyRole: 'member',
    email: 'e2e-read-only@bidstack.local',
    name: 'E2E Read Only',
    clerkUser: 'e2e_read_only',
  },
  viewer: {
    systemRole: 'Read-Only',
    legacyRole: 'member',
    email: 'e2e-viewer@bidstack.local',
    name: 'E2E Viewer',
    clerkUser: 'e2e_viewer',
  },
};

function readStubRoleOverride(req: FastifyRequest): (typeof STUB_ROLE_OVERRIDES)[string] | null {
  const raw = req.headers[STUB_ROLE_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (process.env.BIDSTACK_ALLOW_STUB_ROLE_HEADER !== 'true') {
    throw req.server.httpErrors.forbidden('Stub role override header is disabled');
  }
  const normalized = value.trim().toLowerCase();
  const override = STUB_ROLE_OVERRIDES[normalized];
  if (!override) {
    throw req.server.httpErrors.badRequest(`Unsupported stub role override: ${value}`);
  }
  return override;
}

function readStubOrgOverride(req: FastifyRequest): string | null {
  const raw = req.headers[STUB_ORG_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  if (process.env.BIDSTACK_ALLOW_STUB_ORG_HEADER !== 'true') {
    throw req.server.httpErrors.forbidden('Stub org override header is disabled');
  }
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized;
}

export function parseAllowedSsoDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

export function ssoDomainRejectionLogFields(
  email: string,
  allowedDomains: string[],
): { userDomain: string | null; allowedDomainCount: number } {
  return {
    userDomain: emailDomainForTelemetry(email),
    allowedDomainCount: allowedDomains.length,
  };
}

function isHttpStatusError(err: unknown): err is { statusCode: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number'
  );
}

async function resolveStubRoleOverride(
  req: FastifyRequest,
  orgId: string,
  override: (typeof STUB_ROLE_OVERRIDES)[string],
): Promise<AuthContext> {
  const role = await prisma.role.findFirst({
    where: { orgId, name: override.systemRole, deletedAt: null },
    select: { id: true },
  });
  if (!role) {
    throw req.server.httpErrors.serviceUnavailable(
      `Stub auth: role ${override.systemRole} missing - run pnpm db:seed`,
    );
  }

  const user = await prisma.user.upsert({
    where: { email: override.email },
    create: {
      orgId,
      clerkUser: override.clerkUser,
      email: override.email,
      name: override.name,
      role: override.legacyRole,
    },
    update: {
      orgId,
      name: override.name,
      role: override.legacyRole,
      deletedAt: null,
    },
    select: { id: true, role: true, email: true },
  });

  await prisma.$transaction([
    prisma.userRole.deleteMany({
      where: { userId: user.id, orgId, roleId: { not: role.id } },
    }),
    prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { orgId, userId: user.id, roleId: role.id },
      update: { orgId, deletedAt: null },
    }),
  ]);
  invalidateRbacDecisionCache(orgId, user.id);

  return {
    orgId,
    userId: user.id,
    scopes: ['read', 'write'],
    role: user.role,
    email: user.email ?? undefined,
  };
}

async function resolveStubAuth(req: FastifyRequest): Promise<AuthContext> {
  // P1 #19: restrict stub auth to loopback interfaces only — a mis-configured dev
  // environment should NOT be exploitable from another host on the same network.
  // Fastify normalises the IPv4-mapped form (::ffff:127.0.0.1) to 127.0.0.1 when
  // trustProxy is false, but we guard all three variants to be safe.
  const remoteIp = req.ip;
  const isLoopback =
    remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  if (!isLoopback) {
    throw req.server.httpErrors.forbidden(
      `Stub auth is restricted to localhost (remote: ${remoteIp})`,
    );
  }

  // Precedence: per-request header (cross-tenant cases) > per-file env default
  // (BIDSTACK_STUB_ORG_CLERK, set by an isolated suite in beforeAll) > seed org.
  // All three only reachable in stub mode, which is dev/test + loopback only.
  const clerkOrg =
    readStubOrgOverride(req) ?? process.env.BIDSTACK_STUB_ORG_CLERK ?? STUB_CLERK_ORG;
  const org = await prisma.org.findUnique({ where: { clerkOrg } });
  if (!org) {
    throw req.server.httpErrors.serviceUnavailable(
      clerkOrg === STUB_CLERK_ORG
        ? 'Stub auth: seed org missing — run `pnpm db:seed`'
        : `Stub auth: override org ${clerkOrg} not found`,
    );
  }
  const roleOverride = readStubRoleOverride(req);
  if (roleOverride) {
    return resolveStubRoleOverride(req, org.id, roleOverride);
  }

  const user = await prisma.user.findFirst({
    where: { orgId: org.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!user) {
    throw req.server.httpErrors.serviceUnavailable('Stub auth: no seed user — run `pnpm db:seed`');
  }
  return {
    orgId: org.id,
    userId: user.id,
    scopes: ['read', 'write'],
    role: user.role,
    email: user.email ?? undefined,
  };
}

// mapClerkRole and ensureAdminRoleGrant extracted to ./auth-helpers.ts (BS-R1)

/**
 * Slow path: resolve verified Clerk claims to an AuthContext via the database.
 * Runs ONLY on a cache miss (at most once per token identity per TTL window).
 *
 * Every security check that must bind a real tenant row lives here: org-not-
 * registered 404, unknown-role rejection, cross-org clerkUser/email rejection,
 * plus the JIT user.upsert, role-sync, admin-grant and auth.login audit. These
 * intentionally do NOT run on a cache hit — repeating the user.upsert and
 * auth.login write on every request is exactly what melted the primary.
 */
async function resolveClerkAuthFromDb(
  req: FastifyRequest,
  claims: VerifiedClaims,
): Promise<AuthContext> {
  const { clerkOrgId, clerkUserId, email } = claims;

  const org = await prisma.org.findUnique({
    where: { clerkOrg: clerkOrgId },
  });
  if (!org) {
    throw req.server.httpErrors.notFound('Organization not registered');
  }

  // JIT provisioning: auto-create the user on first sign-in and sync the
  // Clerk org role on every login so Dashboard changes are immediate.
  let clerkRole: string;
  try {
    clerkRole = mapClerkRole(claims.orgRole);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('UNRECOGNIZED_CLERK_ROLE:')) {
      const roleName = err.message.split(':')[1];
      req.log.warn({ role: roleName }, 'Unknown Clerk role mapping encountered');
      await writeAuthAudit(req, {
        action: 'auth.login_failed',
        orgId: org.id,
        actorUserId: null,
        diff: { reason: 'unknown_clerk_role', attemptedRole: roleName ?? null },
      });
      throw req.server.httpErrors.forbidden(`Unrecognized organization role: ${roleName}`);
    }
    throw err;
  }
  const name = `${claims.firstName} ${claims.lastName}`.trim() || null;

  const existingUser = await prisma.user.findUnique({
    where: { clerkUser: clerkUserId },
    select: { id: true, orgId: true, role: true },
  });
  if (existingUser && existingUser.orgId !== org.id) {
    req.log.warn(
      { clerkOrgId, clerkUserId, existingOrgId: existingUser.orgId, tokenOrgId: org.id },
      'clerk user attempted cross-organization auth before org-scoped identity migration',
    );
    await writeAuthAudit(req, {
      action: 'auth.login_failed',
      orgId: org.id,
      actorUserId: existingUser.id,
      targetType: 'user',
      targetId: existingUser.id,
      diff: {
        reason: 'cross_org_attempt',
        attemptedOrgId: org.id,
        existingOrgId: existingUser.orgId,
      },
    });
    throw req.server.httpErrors.forbidden('User is already registered in another organization');
  }

  if (email) {
    const existingEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true, orgId: true },
    });
    if (existingEmail && existingEmail.orgId !== org.id) {
      req.log.warn(
        { clerkOrgId, clerkUserId, existingOrgId: existingEmail.orgId, tokenOrgId: org.id },
        'email attempted cross-organization auth before org-scoped identity migration',
      );
      await writeAuthAudit(req, {
        action: 'auth.login_failed',
        orgId: org.id,
        actorUserId: null,
        targetType: 'email',
        targetId: email,
        diff: {
          reason: 'cross_org_email',
          attemptedOrgId: org.id,
          existingOrgId: existingEmail.orgId,
        },
      });
      throw req.server.httpErrors.forbidden('Email is already registered in another organization');
    }
  }

  const user = await prisma.user.upsert({
    where: { clerkUser: clerkUserId },
    create: {
      orgId: org.id,
      clerkUser: clerkUserId,
      email: email || `${clerkUserId}@placeholder.com`,
      name,
      role: clerkRole,
    },
    update: { name, role: clerkRole },
  });

  // Detect a role change against the previous-known value so we can emit
  // auth.role_change separately from auth.login. The new user case
  // (`existingUser === null`) is not a role *change* — that's covered by
  // the first auth.login entry below.
  const roleChanged = existingUser !== null && existingUser.role !== clerkRole;
  if (roleChanged) {
    await writeAuthAudit(req, {
      action: 'auth.role_change',
      orgId: org.id,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      diff: {
        source: 'clerk_jit',
        previousRole: existingUser?.role ?? null,
        newRole: clerkRole,
      },
    });
  }

  // Ensure Clerk org-admins have an explicit `Admin` UserRole grant. The
  // rbac plugin no longer falls back to the legacy `req.auth.role === 'admin'`
  // claim, so without this row a freshly-provisioned admin would be 403'd on
  // every permission gate. We only touch the row when the user is currently
  // an admin — non-admins keep whatever assignments the operator made via the
  // /api/roles endpoints.
  if (clerkRole === 'admin') {
    await ensureAdminRoleGrant(user.id, org.id, req);
  }

  // Successful sign-in. Fire-and-forget so the audit write can't slow the
  // critical path or fail the request. The diff intentionally omits PII
  // beyond email (which is already in the user row) — token claims and
  // session ids stay out of the table. Only written on the miss path, so at
  // most once per token identity per TTL window — not once per request.
  await writeAuthAudit(req, {
    action: 'auth.login',
    orgId: org.id,
    actorUserId: user.id,
    targetType: 'user',
    targetId: user.id,
    diff: {
      clerkUserId,
      role: clerkRole,
      newUser: existingUser === null,
    },
  });

  return {
    orgId: org.id,
    userId: user.id,
    scopes: ['read', 'write'],
    role: user.role,
    email: email || undefined,
  };
}

async function verifyClerkAuth(req: FastifyRequest): Promise<AuthContext> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw req.server.httpErrors.serviceUnavailable('CLERK_SECRET_KEY not configured');
  }

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    throw req.server.httpErrors.unauthorized('Missing Authorization header');
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (process.env.NODE_ENV === 'production' && (!publicBaseUrl || publicBaseUrl.trim() === '')) {
    throw req.server.httpErrors.serviceUnavailable('PUBLIC_BASE_URL is required in production');
  }
  const authorizedParties = publicBaseUrl ? [publicBaseUrl] : [];

  let claims: VerifiedClaims;
  try {
    // Always verify the JWT signature (CPU, not DB) — we never trust raw token
    // bytes, including as a cache key. The DB-side resolution is what we cache.
    const payload = await verifyToken(token, {
      secretKey,
      authorizedParties,
    });

    const clerkOrgId = payload.org_id as string | undefined;
    if (!clerkOrgId) {
      throw req.server.httpErrors.forbidden('No organization context in token');
    }

    claims = {
      clerkOrgId,
      clerkUserId: payload.sub as string,
      sessionId: payload.sid as string | undefined,
      orgRole: payload.org_role as string | undefined,
      email: (payload.email as string | undefined) ?? '',
      firstName: (payload.first_name as string | undefined) ?? '',
      lastName: (payload.last_name as string | undefined) ?? '',
    };

    // SSO domain restriction: if SSO_ALLOWED_EMAIL_DOMAINS is set, reject
    // sign-ins from unlisted domains. This enforces corporate Microsoft Entra
    // ID boundaries even when Clerk's dashboard allows broader providers.
    // We do NOT audit-log this rejection because we don't have a verified
    // orgId yet at this point in the flow (Clerk org claim hasn't been
    // matched to a tenant row). The Pino warn line is the durable record,
    // but it must not include the full email or tenant allowlist.
    // Runs on EVERY request (CPU-only, depends on the token's email) — it must
    // never be skipped by the cache, so it sits before the cache lookup.
    const allowedDomains = parseAllowedSsoDomains(process.env.SSO_ALLOWED_EMAIL_DOMAINS);
    if (allowedDomains.length > 0) {
      const { userDomain, allowedDomainCount } = ssoDomainRejectionLogFields(
        claims.email,
        allowedDomains,
      );
      if (!userDomain || !allowedDomains.includes(userDomain)) {
        req.log.warn({ userDomain, allowedDomainCount }, 'SSO domain rejected');
        throw req.server.httpErrors.forbidden(SSO_DOMAIN_REJECTED_MESSAGE);
      }
    }
  } catch (err) {
    if (isHttpStatusError(err)) {
      throw err;
    }
    // Note: token-signature failures (no `org_id`, expired, wrong issuer)
    // cannot be safely audit-logged because we have no validated orgId to
    // attribute them to. They surface in Pino logs and Sentry.
    req.log.warn({ err }, 'clerk verification failed');
    throw req.server.httpErrors.unauthorized('Invalid or expired token');
  }

  // Cache lookup keyed on the VERIFIED identity. A hit skips every DB read/write
  // below (org/user lookups, user.upsert, role-sync, auth.login audit). The key
  // folds org + role so a role change re-keys; the TTL bounds staleness to 60s.
  const cacheKey = authCacheKey(claims);
  const hit = authCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.auth;
  }

  const auth = await resolveClerkAuthFromDb(req, claims);

  if (authCache.size >= MAX_AUTH_CACHE_ENTRIES) authCache.clear();
  authCache.set(cacheKey, { auth, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return auth;
}

async function verifyApiKey(req: FastifyRequest): Promise<AuthContext | null> {
  const apiKeyHeader = req.headers['x-api-key'];
  if (!apiKeyHeader || typeof apiKeyHeader !== 'string') return null;

  const hashedKey = createHash('sha256').update(apiKeyHeader).digest('hex');

  const apiKey = await prisma.apiKey.findFirst({
    where: {
      hashedKey,
      revokedAt: null,
      deletedAt: null,
    },
    include: { org: { select: { id: true } } },
  });

  if (!apiKey) return null;

  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  // Update lastUsedAt fire-and-forget
  void prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {
      /* silently ignore */
    });

  return {
    orgId: apiKey.orgId,
    userId: `apikey:${apiKey.id}`,
    scopes: apiKey.scopes,
    role: 'api',
  };
}

const plugin: FastifyPluginAsync = fp(
  async (server) => {
    const hasClerkKey = !!process.env.CLERK_SECRET_KEY;
    const demoMode = isDemoMode();
    // Stub auth is allowed in dev and test only — production must provide a key.
    // Do NOT default to 'development' — if NODE_ENV is unset, allowStub is false.
    const allowStub = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

    // DEMO_MODE arms a PUBLIC passwordless door — it must never co-exist with real
    // Clerk auth. Refuse to boot if both are configured.
    if (demoMode && hasClerkKey) {
      server.log.error(
        'AUTH CONFIG ERROR: DEMO_MODE=true and CLERK_SECRET_KEY are mutually exclusive.',
      );
      throw new Error('DEMO_MODE cannot run with CLERK_SECRET_KEY set');
    }

    // Real auth is required unless we're in dev/test stub mode or the explicit
    // public demo mode.
    if (!hasClerkKey && !allowStub && !demoMode) {
      server.log.error(
        'AUTH CONFIG ERROR: CLERK_SECRET_KEY is missing and NODE_ENV is not development/test. Refusing to start.',
      );
      throw new Error('CLERK_SECRET_KEY required in production');
    }

    if (demoMode) {
      server.log.warn(
        'AUTH DEMO MODE — public passwordless sign-in is ENABLED. This is NOT real authentication; use only for the public demo deployment.',
      );
    } else if (!hasClerkKey) {
      server.log.warn(
        'AUTH STUB MODE — no CLERK_SECRET_KEY set; minting seed org session (dev only)',
      );
    } else {
      server.log.info('Clerk auth enabled');
    }

    server.addHook('onRequest', async (req) => {
      // Allow public endpoints to pass through without auth context.
      if (req.routeOptions?.config?.public) return;

      // Try API key auth first (documented in OpenAPI spec)
      const apiAuth = await verifyApiKey(req);
      if (apiAuth) {
        req.auth = apiAuth;
        return;
      }

      if (hasClerkKey) {
        req.auth = await verifyClerkAuth(req);
      } else if (demoMode) {
        req.auth = await resolveDemoAuth(req);
      } else {
        req.auth = await resolveStubAuth(req);
      }
    });
  },
  { name: 'auth' },
);

export const authPlugin = plugin;
