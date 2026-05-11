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
    where: { orgId: org.id, role: 'admin' },
    orderBy: { createdAt: 'asc' },
  });
  if (!user) {
    throw req.server.httpErrors.serviceUnavailable(
      'Stub auth: no admin seed user — run `pnpm db:seed`',
    );
  }
  return { orgId: org.id, userId: user.id, scopes: ['read', 'write'] };
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

    if (!clerkOrgId) {
      throw req.server.httpErrors.forbidden('No organization context in token');
    }

    const org = await prisma.org.findUnique({
      where: { clerkOrg: clerkOrgId },
    });
    if (!org) {
      throw req.server.httpErrors.notFound('Organization not registered');
    }

    const user = await prisma.user.findFirst({
      where: { orgId: org.id, clerkUser: clerkUserId },
    });
    if (!user) {
      throw req.server.httpErrors.notFound('User not registered in this organization');
    }

    return { orgId: org.id, userId: user.id, scopes: ['read', 'write'] };
  } catch (err) {
    req.log.warn({ err }, 'clerk verification failed');
    throw req.server.httpErrors.unauthorized('Invalid or expired token');
  }
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  const hasClerkKey = !!process.env.CLERK_SECRET_KEY;
  const env = process.env.NODE_ENV ?? 'development';
  // Stub auth is allowed in dev and test only — production must provide a key.
  const allowStub = env === 'development' || env === 'test';

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
      return;
    }

    req.auth = await verifyClerkAuth(req);
  });
});

export const authPlugin = plugin;
