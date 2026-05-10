// Auth plugin.
// Production: Clerk JWT verification (TODO — integrate @clerk/fastify when keys
// are present in env).
// Dev: stub mode. Mints a single-org / single-user session backed by the
// seeded fixture data so the app boots without external dependencies.
//
// The stub mode is the *only* mode in v0.1; Clerk wiring lands in Sprint 8.

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

const plugin: FastifyPluginAsync = fp(async (server) => {
  const useStub = !process.env.CLERK_SECRET_KEY;
  if (useStub) {
    server.log.warn('AUTH STUB MODE — no CLERK_SECRET_KEY set; minting seed org session');
  }

  server.addHook('onRequest', async (req) => {
    // Allow public endpoints to pass through without auth context.
    if (req.routeOptions?.config?.public) return;

    if (useStub) {
      req.auth = await resolveStubAuth(req);
      return;
    }
    // TODO: real Clerk verification path.
    throw server.httpErrors.notImplemented('Clerk auth not wired yet — set CLERK_SECRET_KEY=""');
  });
});

export const authPlugin = plugin;
