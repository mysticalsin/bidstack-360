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
  if (orgRole === 'org:admin') return 'admin';
  // Future: map custom Clerk roles like 'org:bid_manager' → 'bid_manager'
  return 'member';
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

  try {
    const payload = await verifyToken(token, {
      secretKey,
      authorizedParties: [process.env.PUBLIC_BASE_URL ?? ''].filter(Boolean),
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
    const clerkRole = mapClerkRole(payload.org_role as string | undefined);
    const firstName = (payload.first_name as string | undefined) ?? '';
    const lastName = (payload.last_name as string | undefined) ?? '';
    const name = `${firstName} ${lastName}`.trim() || null;

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
