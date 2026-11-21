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
  auth: z.enum(['stub', 'cf-access', 'clerk']).nullable(),
  authProvider: z.enum(['stub', 'clerk', 'demo', 'cf-access']),
  stubBanner: z.string().nullable(),
  publicDemoDoor: z.boolean(),
});

const MeIdentity = IdentityPublic.extend({
  processData: z.enum(['demo', 'real']),
  deployment: z.enum(['local', 'preview', 'production']),
  demoBanner: z.boolean(),
  cfAccessEnabled: z.boolean(),
  toggleActor: z.enum(['owner', 'admin', 'member', 'api-key']),
  providers: z.array(ProviderState),
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  role: z.string(),
  roles: z.array(z.string()),
  allowlist: z
    .array(z.object({ email: z.string(), role: z.string() }))
    .optional(),
});

export function publicIdentityPayload(mode: ReturnType<typeof modeForOrg>) {
  return {
    dataMode: mode.effectiveData,
    auth: mode.auth,
    authProvider: legacyAuthProvider(mode),
    stubBanner: mode.stubBanner,
    publicDemoDoor: mode.publicDemoDoor,
  };
}

function signedInIdentity(
  mode: ReturnType<typeof modeForOrg>,
  toggleActor: 'owner' | 'admin' | 'member' | 'api-key',
) {
  return {
    ...publicIdentityPayload(mode),
    processData: mode.processData,
    deployment: mode.deployment,
    demoBanner: mode.effectiveData === 'demo',
    cfAccessEnabled: mode.auth === 'cf-access',
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
    async () => publicIdentityPayload(server.runtimeMode),
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
      const identity = signedInIdentity(mode, actor);
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
        ...identity,
        ...(canReadAllowlist
          ? {
              allowlist: safeAllowlist(),
            }
          : {}),
      };
    },
  );
};
