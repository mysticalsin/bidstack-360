// Microsoft 365 integration routes.
// Reads/writes connection status from the User model. Email/Calendar
// connect/disconnect are placeholders — the actual Microsoft Graph OAuth
// flow will be wired in a future iteration.

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '@bidstack/db';
import { z } from 'zod';
import {
  MicrosoftConnectionStatus,
  MicrosoftConnectRequest,
  MicrosoftDisconnectRequest,
} from '@bidstack/shared';

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

      const account = user.microsoftAccountJson as
        | { email?: string; emailConnected?: boolean; calendarConnected?: boolean; emailLastSync?: string; calendarLastSync?: string; emailError?: string; calendarError?: string }
        | undefined;

      const ssoConnected = Boolean(user.microsoftEmail ?? account?.email);

      return reply.send({
        ssoConnected,
        ssoEmail: user.microsoftEmail ?? account?.email ?? null,
        ssoMethod: (user.org.microsoftSsoMethod as 'oauth' | 'saml') ?? 'oauth',
        emailConnected: account?.emailConnected ?? false,
        emailLastSync: account?.emailLastSync ?? null,
        emailError: account?.emailError ?? null,
        calendarConnected: account?.calendarConnected ?? false,
        calendarLastSync: account?.calendarLastSync ?? null,
        calendarError: account?.calendarError ?? null,
      });
    },
  });

  // POST /api/v1/settings/microsoft/connect — initiate connection for a service
  app.post('/settings/microsoft/connect', {
    schema: {
      body: MicrosoftConnectRequest,
      response: { 200: MicrosoftConnectResponse },
    },
    handler: async (req) => {
      const { userId, orgId } = req.auth;
      const { service } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user || user.orgId !== orgId) {
        throw server.httpErrors.notFound('User not found');
      }

      if (service === 'email') {
        throw server.httpErrors.serviceUnavailable(
          'Use the Outlook mail OAuth connector at /api/v1/integrations/microsoft/mail/oauth/start.',
        );
      }

      throw server.httpErrors.serviceUnavailable(
        'Microsoft calendar OAuth is not configured yet. Enable it before exposing this action.',
      );
    },
  });

  // POST /api/v1/settings/microsoft/disconnect — revoke a service connection
  app.post('/settings/microsoft/disconnect', {
    schema: {
      body: MicrosoftDisconnectRequest,
    },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;
      const { service } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user || user.orgId !== orgId) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const account = (user.microsoftAccountJson ?? {}) as Record<string, unknown>;
      const nextAccount = { ...account };

      if (service === 'email') {
        nextAccount.emailConnected = false;
        nextAccount.emailLastSync = null;
        nextAccount.emailError = null;
      } else {
        nextAccount.calendarConnected = false;
        nextAccount.calendarLastSync = null;
        nextAccount.calendarError = null;
      }

      await prisma.user.update({
        where: { id: userId },
        data: { microsoftAccountJson: nextAccount as unknown as Parameters<typeof prisma.user.update>[0]['data']['microsoftAccountJson'] },
      });

      return reply.status(204).send();
    },
  });
};
