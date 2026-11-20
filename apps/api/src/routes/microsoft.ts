// Microsoft 365 settings routes. Mail and calendar share one read-only Graph
// grant (the `microsoft_graph` IntegrationToken row), so connect and
// disconnect act on that grant for either service. SSO status still comes
// from the User model.

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@bidstack/db';
import { z } from 'zod';
import {
  MicrosoftConnectionStatus,
  MicrosoftConnectRequest,
  MicrosoftDisconnectRequest,
  grantsCalendarRead,
  grantsMailRead,
} from '@bidstack/shared';
import {
  NotConfigured,
  WorkspaceNotConfiguredError,
  buildConnectUrl,
  disconnectWorkspace,
  notConfiguredBody,
} from '../services/workspace-connect.service.js';

const MicrosoftConnectResponse = z.object({
  authUrl: z.string().url(),
});

export const microsoftRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /api/v1/settings/microsoft — connection status for current user
  app.get('/settings/microsoft', {
    schema: {
      response: { 200: MicrosoftConnectionStatus },
    },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { org: true },
      });

      if (!user || user.orgId !== orgId) {
        throw server.httpErrors.notFound('User not found');
      }

      const account = user.microsoftAccountJson as { email?: string } | undefined;
      const ssoConnected = Boolean(user.microsoftEmail ?? account?.email);

      const grant = await prisma.integrationToken.findFirst({
        where: { orgId, userId, provider: 'microsoft_graph' },
        select: { status: true, scope: true, lastSyncedAt: true, errorMessage: true },
      });
      const active = grant?.status === 'active';
      const lastSync = grant?.lastSyncedAt?.toISOString() ?? null;
      const error = grant && grant.status !== 'active' ? grant.errorMessage : null;

      return reply.send({
        ssoConnected,
        ssoEmail: user.microsoftEmail ?? account?.email ?? null,
        ssoMethod: (user.org.microsoftSsoMethod as 'oauth' | 'saml') ?? 'oauth',
        emailConnected: active && grantsMailRead(grant.scope),
        emailLastSync: lastSync,
        emailError: error,
        calendarConnected: active && grantsCalendarRead(grant.scope),
        calendarLastSync: lastSync,
        calendarError: error,
      });
    },
  });

  // POST /api/v1/settings/microsoft/connect — initiate connection for a service
  app.post('/settings/microsoft/connect', {
    schema: {
      body: MicrosoftConnectRequest,
      response: { 200: MicrosoftConnectResponse, 503: NotConfigured },
    },
    handler: async (req, reply) => {
      try {
        return reply.send({ authUrl: await buildConnectUrl('microsoft', req.auth.orgId, req.auth.userId) });
      } catch (err) {
        if (err instanceof WorkspaceNotConfiguredError) return reply.status(503).send(notConfiguredBody(err));
        throw err;
      }
    },
  });

  // POST /api/v1/settings/microsoft/disconnect — revoke a service connection
  app.post('/settings/microsoft/disconnect', {
    schema: {
      body: MicrosoftDisconnectRequest,
    },
    handler: async (req, reply) => {
      await disconnectWorkspace('microsoft', req.auth.orgId, req.auth.userId, req.log);
      return reply.status(204).send();
    },
  });
};
