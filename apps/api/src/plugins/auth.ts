// Auth plugin.
// Production: Clerk JWT verification via @clerk/fastify.
// Dev: stub mode. Mints a single-org / single-user session backed by the
// seeded fixture data so the app boots without external dependencies.
//
// Stub mode is guarded by NODE_ENV === 'development' and will refuse to run
// in production even if CLERK_SECRET_KEY is missing.

import { verifyToken } from '@clerk/backend';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as Sentry from '@sentry/node';

import { prisma } from '@bidstack/db';

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

async function resolveStubAuth(req: FastifyRequest): Promise<AuthContext> {
  const org = await prisma.org.findUnique({ where: { clerkOrg: STUB_CLERK_ORG } });
  if (!org) {
    throw req.server.httpErrors.serviceUnavailable(
      'Stub auth: seed org missing — run `pnpm db:seed`',
    );
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

function mapClerkRole(orgRole: string | undefined): string {
  if (orgRole === undefined || orgRole === null) return 'member';
  const roleMap: Record<string, string> = {
    'org:admin': 'admin',
    'org:member': 'member',
    'org:manager': 'manager',
    'org:finance': 'finance',
  };
  const mapped = roleMap[orgRole];
  if (!mapped) {
    throw new Error(`UNRECOGNIZED_CLERK_ROLE:${orgRole}`);
  }
  return mapped;
}

/**
 * Idempotently assign the seeded `Admin` role to a user. Called on every
 * sign-in for users whose mapped Clerk role is `admin`, so the rbac plugin's
 * UserRole-based permission check always has something to find.
 *
 * If the org has no `Admin` row yet (fresh tenant that hasn't run the seed),
 * we log and skip — the operator will need to seed roles before admins can use
 * permission-gated endpoints. We do NOT auto-create the Role here because the
 * full Role row also requires its RolePermission mappings, which are managed
 * centrally in `packages/db/src/seed.ts`.
 */
async function ensureAdminRoleGrant(
  userId: string,
  orgId: string,
  req: FastifyRequest,
): Promise<void> {
  const adminRole = await prisma.role.findFirst({
    where: { orgId, name: 'Admin', isSystem: true, deletedAt: null },
    select: { id: true },
  });
  if (!adminRole) {
    req.log.warn(
      { orgId, userId },
      'JIT admin grant skipped: org has no seeded Admin role (run pnpm db:seed)',
    );
    return;
  }
  // upsert on the composite PK so concurrent sign-ins don't race
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: adminRole.id } },
    create: { userId, roleId: adminRole.id, orgId },
    update: { deletedAt: null },
  });
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

  try {
    const payload = await verifyToken(token, {
      secretKey,
      authorizedParties,
    });

    const clerkOrgId = payload.org_id as string | undefined;
    const clerkUserId = payload.sub as string;
    const email = (payload.email as string | undefined) ?? '';

    if (!clerkOrgId) {
      throw req.server.httpErrors.forbidden('No organization context in token');
    }

    // SSO domain restriction: if SSO_ALLOWED_EMAIL_DOMAINS is set, reject
    // sign-ins from unlisted domains. This enforces corporate Microsoft Entra
    // ID boundaries even when Clerk's dashboard allows broader providers.
    const allowedDomains = process.env.SSO_ALLOWED_EMAIL_DOMAINS?.split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (allowedDomains && allowedDomains.length > 0) {
      const userDomain = email.split('@')[1]?.toLowerCase() ?? '';
      if (!userDomain || !allowedDomains.includes(userDomain)) {
        req.log.warn({ email, userDomain, allowedDomains }, 'SSO domain rejected');
        throw req.server.httpErrors.forbidden(
          `Sign-in from @${userDomain} is not permitted. Allowed domains: ${allowedDomains.join(', ')}`,
        );
      }
    }

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
      clerkRole = mapClerkRole(payload.org_role as string | undefined);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('UNRECOGNIZED_CLERK_ROLE:')) {
        const roleName = err.message.split(':')[1];
        req.log.warn({ role: roleName }, 'Unknown Clerk role mapping encountered');
        throw req.server.httpErrors.forbidden(`Unrecognized organization role: ${roleName}`);
      }
      throw err;
    }
    const firstName = (payload.first_name as string | undefined) ?? '';
    const lastName = (payload.last_name as string | undefined) ?? '';
    const name = `${firstName} ${lastName}`.trim() || null;

    const existingUser = await prisma.user.findUnique({
      where: { clerkUser: clerkUserId },
      select: { id: true, orgId: true },
    });
    if (existingUser && existingUser.orgId !== org.id) {
      req.log.warn(
        { clerkOrgId, clerkUserId, existingOrgId: existingUser.orgId, tokenOrgId: org.id },
        'clerk user attempted cross-organization auth before org-scoped identity migration',
      );
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
        throw req.server.httpErrors.forbidden(
          'Email is already registered in another organization',
        );
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

    // Ensure Clerk org-admins have an explicit `Admin` UserRole grant. The
    // rbac plugin no longer falls back to the legacy `req.auth.role === 'admin'`
    // claim, so without this row a freshly-provisioned admin would be 403'd on
    // every permission gate. We only touch the row when the user is currently
    // an admin — non-admins keep whatever assignments the operator made via the
    // /api/roles endpoints.
    if (clerkRole === 'admin') {
      await ensureAdminRoleGrant(user.id, org.id, req);
    }

    return {
      orgId: org.id,
      userId: user.id,
      scopes: ['read', 'write'],
      role: user.role,
      email: email || undefined,
    };
  } catch (err) {
    req.log.warn({ err }, 'clerk verification failed');
    throw req.server.httpErrors.unauthorized('Invalid or expired token');
  }
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  const hasClerkKey = !!process.env.CLERK_SECRET_KEY;
  // Stub auth is allowed in dev and test only — production must provide a key.
  // Do NOT default to 'development' — if NODE_ENV is unset, allowStub is false.
  const allowStub = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

  if (!hasClerkKey && !allowStub) {
    server.log.error(
      'AUTH CONFIG ERROR: CLERK_SECRET_KEY is missing and NODE_ENV is not development/test. Refusing to start.',
    );
    throw new Error('CLERK_SECRET_KEY required in production');
  }

  if (!hasClerkKey) {
    server.log.warn(
      'AUTH STUB MODE — no CLERK_SECRET_KEY set; minting seed org session (dev only)',
    );
  } else {
    server.log.info('Clerk auth enabled');
  }

  server.addHook('onRequest', async (req) => {
    // Allow public endpoints to pass through without auth context.
    if (req.routeOptions?.config?.public) return;

    if (!hasClerkKey) {
      req.auth = await resolveStubAuth(req);
    } else {
      req.auth = await verifyClerkAuth(req);
    }

    Sentry.setTag('orgId', req.auth.orgId);
    Sentry.setTag('userId', req.auth.userId);
    Sentry.setUser({ id: req.auth.userId, email: req.auth.email });
  });
});

export const authPlugin = plugin;
