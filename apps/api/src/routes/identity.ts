import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { parseAllowedUsers } from '../lib/allowed-users.js';
import { userHasPermission } from '../lib/rbac-decision-cache.js';
import {
  getPoloDataMode,
  resolvePoloAuthProvider,
} from '../lib/polo-mode.js';

const IdentityPublic = z.object({
  dataMode: z.enum(['demo', 'real']),
  authProvider: z.enum(['stub', 'clerk', 'demo', 'cf-access']),
  demoBanner: z.boolean(),
  cfAccessEnabled: z.boolean(),
});

const MeIdentity = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  role: z.string(),
  roles: z.array(z.string()),
  dataMode: z.enum(['demo', 'real']),
  authProvider: z.enum(['stub', 'clerk', 'demo', 'cf-access']),
  allowlist: z
    .array(z.object({ email: z.string(), role: z.string() }))
    .optional(),
});

function safeAllowlist(): Array<{ email: string; role: string }> {
  try {
    return parseAllowedUsers(process.env.POLO_ALLOWED_USERS).map((entry) => ({
      email: entry.email,
      role: entry.role,
    }));
  } catch {
    return [];
  }
}

export const identityRoutes: FastifyPluginAsyncZod = async (server) => {
  server.get(
    '/identity',
    {
      config: { public: true, rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { response: { 200: IdentityPublic } },
    },
    async () => {
      const dataMode = getPoloDataMode();
      const authProvider = resolvePoloAuthProvider();
      return {
        dataMode,
        authProvider,
        demoBanner: dataMode === 'demo',
        cfAccessEnabled: authProvider === 'cf-access',
      };
    },
  );

  server.get(
    '/me',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { response: { 200: MeIdentity } },
    },
    async (req) => {
      const dataMode = getPoloDataMode();
      const authProvider = resolvePoloAuthProvider();
      const user = req.auth.userId.startsWith('apikey:')
        ? null
        : await prisma.user.findFirst({
            where: { id: req.auth.userId, orgId: req.auth.orgId, deletedAt: null },
            select: { id: true, email: true, name: true, role: true },
          });

      const roleRows = req.auth.userId.startsWith('apikey:')
        ? []
        : await prisma.userRole.findMany({
            where: {
              userId: req.auth.userId,
              orgId: req.auth.orgId,
              deletedAt: null,
              role: { orgId: req.auth.orgId, deletedAt: null },
            },
            select: { role: { select: { name: true } } },
            take: 100,
          });

      const canReadAllowlist =
        !req.auth.userId.startsWith('apikey:') &&
        (await userHasPermission(req.auth.orgId, req.auth.userId, 'settings:write'));

      return {
        id: user?.id ?? req.auth.userId,
        email: user?.email ?? req.auth.email ?? null,
        name: user?.name ?? null,
        role: user?.role ?? req.auth.role,
        roles: roleRows.map((row) => row.role.name).sort(),
        dataMode,
        authProvider,
        ...(canReadAllowlist
          ? {
              allowlist: safeAllowlist(),
            }
          : {}),
      };
    },
  );
};
