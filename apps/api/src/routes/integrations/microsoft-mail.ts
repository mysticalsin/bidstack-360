/**
 * Microsoft Graph Mail OAuth routes.
 *
 * WHY separate from the existing microsoft.ts: the existing file only handles
 * the legacy microsoftAccountJson blob on the User model. This module uses
 * the IntegrationToken table (same as calendar + Gmail) and requests the
 * correct mail scopes from MS Graph.
 *
 * Scopes:
 *  - Mail.Send     — send email on behalf of the user
 *  - Mail.Read     — read inbox for incremental pull (delta query)
 *  - offline_access — obtain refresh_token for long-lived access
 *  WHY not Mail.ReadWrite: least-privilege — we never need to delete or move
 *  messages. Send + read covers all send-log-pull requirements.
 *
 * Tenant: "common" — works for both personal and work accounts.
 * For orgs with strict Conditional Access, override via MICROSOFT_TENANT_ID.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { outlookHistoricalQueue } from '../../queues/email-outlook.js';
import { createSubscription, deleteSubscription, getAccessToken } from '../../services/microsoft-graph.service.js';

function tenant(): string {
  return process.env.MICROSOFT_TENANT_ID ?? 'common';
}
function clientId(): string {
  const v = process.env.MICROSOFT_GRAPH_CLIENT_ID;
  if (!v) throw new Error('MICROSOFT_GRAPH_CLIENT_ID is not set');
  return v;
}
function clientSecret(): string {
  const v = process.env.MICROSOFT_GRAPH_CLIENT_SECRET;
  if (!v) throw new Error('MICROSOFT_GRAPH_CLIENT_SECRET is not set');
  return v;
}
function redirectUri(): string {
  return (
    process.env.MICROSOFT_GRAPH_MAIL_REDIRECT_URI ??
    `${process.env.PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/integrations/microsoft/mail/oauth/callback`
  );
}

const MAIL_SCOPES = [
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Mail.Read',
  'offline_access',
].join(' ');

export const microsoftMailOAuthRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /integrations/microsoft/mail/oauth/start
  app.get('/integrations/microsoft/mail/oauth/start', {
    schema: {
      response: {
        200: z.object({ authUrl: z.string().url() }),
      },
    },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;

      const nonce = randomBytes(16).toString('hex');
      const statePayload = `${orgId}:${userId}:${nonce}`;
      const state = createHash('sha256').update(statePayload).digest('base64url');

      await prisma.integrationToken.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orgId_userId_provider: { orgId, userId, provider: 'microsoft_graph' as any },
        },
        create: {
          orgId,
          userId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'microsoft_graph' as any,
          accessTokenEncrypted: encryptToken('pending'),
          status: 'revoked',
          deltaState: { mailOAuthState: statePayload },
        },
        update: {
          deltaState: { mailOAuthState: statePayload },
        },
      });

      const params = new URLSearchParams({
        client_id: clientId(),
        response_type: 'code',
        redirect_uri: redirectUri(),
        scope: MAIL_SCOPES,
        state,
        response_mode: 'query',
      });

      return reply.send({
        authUrl: `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${params.toString()}`,
      });
    },
  });

  // GET /integrations/microsoft/mail/oauth/callback
  app.get('/integrations/microsoft/mail/oauth/callback', {
    schema: {
      querystring: z.object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
      }),
    },
    handler: async (req, reply) => {
      const { code, state, error } = req.query;
      const { userId, orgId } = req.auth;

      if (error) {
        server.log.warn({ error }, 'Microsoft Mail OAuth denied');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings/integrations?error=outlook_denied`,
        );
      }
      if (!code || !state) {
        throw server.httpErrors.badRequest('Missing code or state');
      }

      const record = await prisma.integrationToken.findUnique({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orgId_userId_provider: { orgId, userId, provider: 'microsoft_graph' as any },
        },
      });
      const stored = (record?.deltaState as Record<string, string> | null)?.mailOAuthState;
      if (!stored) throw server.httpErrors.badRequest('OAuth session not found');

      const expected = createHash('sha256').update(stored).digest('base64url');
      if (state !== expected) {
        server.log.warn({ orgId, userId }, 'Microsoft Mail OAuth forged state rejected');
        throw server.httpErrors.forbidden('Invalid OAuth state');
      }

      const tokenRes = await fetch(
        `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId(),
            client_secret: clientSecret(),
            code,
            redirect_uri: redirectUri(),
            grant_type: 'authorization_code',
          }).toString(),
        },
      );

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        server.log.error({ status: tokenRes.status, body }, 'MS Graph token exchange failed');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings/integrations?error=outlook_token_failed`,
        );
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
      };

      // Get user's email from Graph /me endpoint
      let externalEmail: string | undefined;
      try {
        const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as { mail?: string; userPrincipalName?: string };
          externalEmail = me.mail ?? me.userPrincipalName;
        }
      } catch (err) {
        server.log.warn({ err }, 'Could not fetch MS Graph /me');
      }

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined;

      await prisma.integrationToken.update({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orgId_userId_provider: { orgId, userId, provider: 'microsoft_graph' as any },
        },
        data: {
          accessTokenEncrypted: encryptToken(tokens.access_token),
          refreshTokenEncrypted: tokens.refresh_token
            ? encryptToken(tokens.refresh_token)
            : undefined,
          scope: tokens.scope?.split(' ') ?? [],
          expiresAt,
          status: 'active',
          externalAccountEmail: externalEmail,
          deltaState: {},
          lastRefreshedAt: new Date(),
        },
      });

      // Fetch the saved token record to get its id for queue/subscription
      const savedToken = await prisma.integrationToken.findUnique({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orgId_userId_provider: { orgId, userId, provider: 'microsoft_graph' as any },
        },
        select: { id: true },
      });

      if (savedToken) {
        // Schedule one-shot historical backfill
        await outlookHistoricalQueue.add(
          'email.outlook.pull-historical',
          { orgId, userId, integrationTokenId: savedToken.id },
          { jobId: `historical-${savedToken.id}` },
        );

        // Create Graph webhook subscription (best-effort — incremental poll fallback if it fails)
        void createSubscription({ integrationTokenId: savedToken.id, orgId }, server.log);
      }

      server.log.info({ orgId, userId, email: externalEmail }, 'Outlook Mail connected');

      return reply.redirect(
        `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings/integrations?connected=outlook`,
      );
    },
  });

  // DELETE /integrations/microsoft/mail/disconnect
  app.delete('/integrations/microsoft/mail/disconnect', {
    schema: { response: { 204: z.null() } },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;

      // Find token record first so we can read the access token for subscription cleanup
      const token = await prisma.integrationToken.findUnique({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          orgId_userId_provider: { orgId, userId, provider: 'microsoft_graph' as any },
        },
        include: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          graphSubscriptions: { select: { subscriptionId: true } } as any,
        },
      });

      // Best-effort: delete all active Graph subscriptions before revoking
      if (token && token.status === 'active') {
        try {
          const accessToken = await getAccessToken(token, server.log);
          const subs = (token as typeof token & { graphSubscriptions?: { subscriptionId: string }[] })
            .graphSubscriptions ?? [];
          await Promise.all(
            subs.map((sub) => deleteSubscription(sub.subscriptionId, accessToken, server.log)),
          );
        } catch (err) {
          // Non-fatal — continue to revoke token even if subscription cleanup fails
          server.log.warn({ err, orgId, userId }, 'Could not clean up Graph subscriptions on disconnect');
        }
      }

      await prisma.integrationToken.updateMany({
        where: {
          orgId,
          userId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'microsoft_graph' as any,
        },
        data: { status: 'revoked', deletedAt: new Date() },
      });

      return reply.status(204).send(null);
    },
  });
};
