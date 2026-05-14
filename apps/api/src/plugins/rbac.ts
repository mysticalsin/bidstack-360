// Role-based access control helpers.
//
// Fastify's `onRequest` hook runs after auth but before the route handler,
// making it the right place to enforce role gates. We attach helpers to the
// server instance so route modules can reuse them without importing a global.

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    requireRole: (...allowed: string[]) => (req: FastifyRequest) => void;
  }
}

const plugin: FastifyPluginAsync = fp(async (server) => {
  server.decorate('requireRole', (...allowed: string[]) => async (req: FastifyRequest) => {
    if (!allowed.includes(req.auth.role)) {
      throw req.server.httpErrors.forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
  });
});

export const rbacPlugin = plugin;
