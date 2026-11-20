import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { prisma } from '@bidstack/db';

import { parseAllowedUsers } from '../lib/allowed-users.js';
import { userHasPermission } from '../lib/rbac-decision-cache.js';
import {
  demoDataActor,
  legacyAuthProvider,
  modeForOrg,
  orgDemoDataEnabled,
  providerSnapshot,
} from '../lib/runtime-request.js';
import { NOT_CONNECTED } from '@bidstack/shared';

const ProviderState = z.object({
  id: z.string(),
  status: z.union([z.literal(NOT_CONNECTED), z.literal('approved')]),
  enablePath: z.literal(false),
});

const IdentityPublic = z.object({
  dataMode: z.enum(['demo', 'real']),
  processData: z.enum(['demo', 'real']),
  auth: z.enum(['stub', 'cf-access', 'clerk']).nullable(),
  authProvider: z.enum(['stub', 'clerk', 'demo', 'cf-access']),
  deployment: z.enum(['local', 'preview', 'production']),
  demoBanner: z.boolean(),
  stubBanner: z.string().nullable(),
  cfAccessEnabled: z.boolean(),
  publicDemoDoor: z.boolean(),
  toggleActor: z.enum(['owner', 'admin', 'member', 'api-key']),
  providers: z.array(ProviderState),
});

const MeIdentity = IdentityPublic.extend({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  role: z.string(),
  roles: z.array(z.string()),
  allowlist: z
    .array(z.object({ email: z.string(), role: z.string() }))
    .optional(),
});

function publicIdentity(
  mode: ReturnType<typeof modeForOrg>,
  toggleActor: 'owner' | 'admin' | 'member' | 'api-key' = 'member',
) {
  return {
    dataMode: mode.effectiveData,
    processData: mode.processData,
    auth: mode.auth,
    authProvider: legacyAuthProvider(mode),
    deployment: mode.deployment,
    demoBanner: mode.effectiveData === 'demo',
    stubBanner: mode.stubBanner,
    cfAccessEnabled: mode.auth === 'cf-access',
    publicDemoDoor: mode.publicDemoDoor,
    toggleActor,
    providers: providerSnapshot(),
  };
}

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
    async () => publicIdentity(server.runtimeMode),
  );

  server.get(
    '/me',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { response: { 200: MeIdentity } },
    },
    async (req) => {
      const actor = await demoDataActor(req);
      const mode = modeForOrg(server.runtimeMode, await orgDemoDataEnabled(req.auth.orgId));
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
        ...publicIdentity(mode, actor),
        ...(canReadAllowlist
          ? {
              allowlist: safeAllowlist(),
            }
          : {}),
      };
    },
  );
};
