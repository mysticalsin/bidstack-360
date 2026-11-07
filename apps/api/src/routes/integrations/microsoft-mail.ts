/**
 * Microsoft 365 OAuth routes (Outlook mail + calendar, read-only).
 *
 * Uses the IntegrationToken `microsoft_graph` row shared by mail and calendar
 * sync. The legacy microsoft.ts only reports the old microsoftAccountJson blob.
 *
 * Scopes (WORKSPACE_READ_SCOPES.microsoft): openid, email, offline_access,
 * User.Read, Mail.Read, Calendars.Read. No Mail.Send, no ReadWrite: Polo
 * captures mail and meetings and never acts on the user's behalf.
 *
 * Tenant: "common" — works for both personal and work accounts.
 * For orgs with strict Conditional Access, override via MICROSOFT_TENANT_ID.
 */

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, IntegrationProvider } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { outlookHistoricalQueue } from '../../queues/email-outlook.js';
import { emailDomainForTelemetry } from '../../lib/email-privacy.js';
import { fetchWithTimeout, providerTimeoutMs } from '../../lib/fetch-timeout.js';
import {
  consumeOAuthState,
  OAuthStateError,
  oauthStateHttpStatus,
} from '../../lib/oauth-state.js';
import { recordSerumConnectorTestSuccess } from '../../lib/serum-connector-policy.js';
import { createSubscription } from '../../services/microsoft-graph-subscription.service.js';
import {
  NotConfigured,
  WorkspaceNotConfiguredError,
  buildConnectUrl,
  disconnectWorkspace,
  notConfiguredBody,
  microsoftRedirectUri,
  microsoftTenant,
} from '../../services/workspace-connect.service.js';

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

export const microsoftMailOAuthRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /integrations/microsoft/mail/oauth/start
  app.get('/integrations/microsoft/mail/oauth/start', {
    schema: {
      response: {
        200: z.object({ authUrl: z.string().url() }),
        503: NotConfigured,
      },
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

  // GET /integrations/microsoft/mail/oauth/callback
  app.get('/integrations/microsoft/mail/oauth/callback', {
    config: {
      // The provider redirect carries no Polo session; identity comes from the
      // sealed state (see lib/oauth-state.ts).
      public: true,
      rateLimit: { max: 20, timeWindow: '1 minute' },
    },
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

      if (error) {
        server.log.warn({ error }, 'Microsoft Mail OAuth denied');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings?tab=integrations&error=outlook_denied`,
        );
      }
      if (!code || !state) {
        throw server.httpErrors.badRequest('Missing code or state');
      }

      let orgId: string;
      let userId: string;
      try {
        ({ orgId, userId } = await consumeOAuthState({
          provider: 'microsoft_mail',
          integrationProvider: IntegrationProvider.microsoft_graph,
          field: 'mailOAuthNonce',
          state,
        }));
      } catch (err) {
        if (!(err instanceof OAuthStateError)) throw err;
        server.log.warn({ reason: err.reason }, 'Microsoft Mail OAuth state rejected');
        const status = oauthStateHttpStatus(err.reason);
        const message =
          err.reason === 'expired'
            ? 'OAuth state expired, please restart the connection'
            : err.reason === 'replayed'
              ? 'OAuth state already used, please restart the connection'
              : 'Invalid OAuth state';
        throw server.httpErrors.createError(status, message);
      }

      const tokenRes = await fetchWithTimeout(
        `https://login.microsoftonline.com/${microsoftTenant()}/oauth2/v2.0/token`,
        {
          provider: 'Microsoft Graph',
          operation: 'oauth.exchange',
          timeoutMs: providerTimeoutMs('OAUTH_HTTP_TIMEOUT_MS', 15_000),
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId(),
            client_secret: clientSecret(),
            code,
            redirect_uri: microsoftRedirectUri(),
            grant_type: 'authorization_code',
          }).toString(),
        },
      );

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        server.log.error({ status: tokenRes.status, body }, 'MS Graph token exchange failed');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings?tab=integrations&error=outlook_token_failed`,
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
      let graphMeEvidence: { mail?: string; userPrincipalName?: string } | null = null;
      try {
        const meRes = await fetchWithTimeout(
          'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
          {
            provider: 'Microsoft Graph',
            operation: 'me.get',
            timeoutMs: providerTimeoutMs('MICROSOFT_GRAPH_HTTP_TIMEOUT_MS', 15_000),
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          },
        );
        if (meRes.ok) {
          graphMeEvidence = (await meRes.json()) as { mail?: string; userPrincipalName?: string };
          externalEmail = graphMeEvidence.mail ?? graphMeEvidence.userPrincipalName;
        }
      } catch (err) {
        server.log.warn({ err }, 'Could not fetch MS Graph /me');
      }

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined;

      await prisma.integrationToken.update({
        where: {
          orgId_userId_provider: { orgId, userId, provider: IntegrationProvider.microsoft_graph },
        },
        data: {
          accessTokenEncrypted: encryptToken(tokens.access_token),
          refreshTokenEncrypted: tokens.refresh_token
            ? encryptToken(tokens.refresh_token)
            : undefined,
          scope: tokens.scope?.split(' ') ?? [],
          expiresAt,
          status: 'active',
          errorMessage: null,
          externalAccountEmail: externalEmail,
          deltaState: {},
          lastRefreshedAt: new Date(),
        },
      });

      if (graphMeEvidence) {
        await recordSerumConnectorTestSuccess({
          orgId,
          connectorId: 'microsoft_graph',
          operation: 'microsoft.mail.oauth.callback',
          testedByUserId: userId,
          evidence: {
            mail: graphMeEvidence.mail,
            userPrincipalName: graphMeEvidence.userPrincipalName,
          },
        });
      }

      // Fetch the saved token record to get its id for queue/subscription
      const savedToken = await prisma.integrationToken.findUnique({
        where: {
          orgId_userId_provider: { orgId, userId, provider: IntegrationProvider.microsoft_graph },
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
        void createSubscription({ integrationTokenId: savedToken.id, orgId }, server.log).catch(
          (err) => server.log.warn({ err }, 'Failed to create subscription in background'),
        );
      }

      server.log.info(
        { orgId, userId, externalAccountDomain: emailDomainForTelemetry(externalEmail) },
        'Outlook Mail connected',
      );

      return reply.redirect(
        `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings?tab=integrations&connected=outlook`,
      );
    },
  });

  // DELETE /integrations/microsoft/mail/disconnect
  app.delete('/integrations/microsoft/mail/disconnect', {
    schema: { response: { 204: z.null() } },
    handler: async (req, reply) => {
      await disconnectWorkspace('microsoft', req.auth.orgId, req.auth.userId, req.log);
      return reply.status(204).send(null);
    },
  });
};
