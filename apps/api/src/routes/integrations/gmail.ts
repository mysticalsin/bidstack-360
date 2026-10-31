/**
 * Gmail OAuth 2.0 routes.
 *
 * WHY: Gmail requires its own OAuth dance separate from Google Calendar
 * because the scopes differ (gmail.send + gmail.readonly vs. calendar scopes).
 * A user may have Google Calendar connected without Gmail and vice-versa.
 *
 * Flow:
 *  1. GET /integrations/gmail/oauth/start  — redirect to Google consent
 *  2. GET /integrations/gmail/oauth/callback — exchange code, store token, schedule pull
 *
 * Scopes:
 *  - https://www.googleapis.com/auth/gmail.send     — send on behalf of user
 *  - https://www.googleapis.com/auth/gmail.readonly — read inbox (incremental pull)
 *  WHY not gmail.modify: readonly + send is the least-privilege combination for
 *  send+log. We never need to write labels or delete messages.
 *
 * State parameter: sealed by lib/oauth-state.ts (org, user, nonce, expiry);
 * the callback is public and single-use.
 */

import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, IntegrationProvider } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { emailDomainForTelemetry } from '../../lib/email-privacy.js';
import { fetchWithTimeout, providerTimeoutMs } from '../../lib/fetch-timeout.js';
import {
  consumeOAuthState,
  issueOAuthState,
  OAuthStateError,
  oauthStateHttpStatus,
} from '../../lib/oauth-state.js';
import { recordSerumConnectorTestSuccess } from '../../lib/serum-connector-policy.js';

const GMAIL_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');

function clientId(): string {
  const v = process.env.GMAIL_CLIENT_ID;
  if (!v) throw new Error('GMAIL_CLIENT_ID is not set');
  return v;
}
function clientSecret(): string {
  const v = process.env.GMAIL_CLIENT_SECRET;
  if (!v) throw new Error('GMAIL_CLIENT_SECRET is not set');
  return v;
}
function redirectUri(): string {
  return (
    process.env.GMAIL_REDIRECT_URI ??
    `${process.env.PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/integrations/gmail/oauth/callback`
  );
}

export const gmailOAuthRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /integrations/gmail/oauth/start
  // Returns an auth URL the frontend opens in the same tab (or popup).
  app.get('/integrations/gmail/oauth/start', {
    schema: {
      response: {
        200: z.object({ authUrl: z.string().url() }),
      },
    },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;

      // Sealed state (org, user, nonce, expiry); the nonce is stored below so
      // the public callback can bind it to this user and use it only once.
      const { state, nonce } = issueOAuthState('gmail', { orgId, userId });

      // Store the raw state payload so callback can verify
      await prisma.integrationToken.upsert({
        where: {
          orgId_userId_provider: { orgId, userId, provider: IntegrationProvider.gmail },
        },
        create: {
          orgId,
          userId,

          provider: IntegrationProvider.gmail,
          accessTokenEncrypted: encryptToken('pending'),
          status: 'revoked',
          deltaState: { oauthNonce: nonce },
        },
        update: {
          deltaState: { oauthNonce: nonce },
          status: 'revoked',
        },
      });

      const params = new URLSearchParams({
        client_id: clientId(),
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: GMAIL_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
      });

      return reply.send({ authUrl: `${GMAIL_AUTH_BASE}?${params.toString()}` });
    },
  });

  // GET /integrations/gmail/oauth/callback
  // Called by Google after user consents. Exchanges auth code for tokens.
  app.get('/integrations/gmail/oauth/callback', {
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
      }),
    },
    handler: async (req, reply) => {
      const { code, state, error } = req.query;

      if (error) {
        server.log.warn({ error }, 'Gmail OAuth denied by user');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings?tab=integrations&error=gmail_denied`,
        );
      }
      if (!code || !state) {
        throw server.httpErrors.badRequest('Missing code or state parameter');
      }

      let orgId: string;
      let userId: string;
      try {
        ({ orgId, userId } = await consumeOAuthState({
          provider: 'gmail',
          integrationProvider: IntegrationProvider.gmail,
          field: 'oauthNonce',
          state,
        }));
      } catch (err) {
        if (!(err instanceof OAuthStateError)) throw err;
        server.log.warn({ reason: err.reason }, 'Gmail OAuth state rejected');
        const status = oauthStateHttpStatus(err.reason);
        const message =
          err.reason === 'expired'
            ? 'OAuth state expired, please restart the connection'
            : err.reason === 'replayed'
              ? 'OAuth state already used, please restart the connection'
              : 'Invalid OAuth state';
        throw server.httpErrors.createError(status, message);
      }

      // Exchange auth code for access + refresh tokens
      const tokenRes = await fetchWithTimeout(GMAIL_TOKEN_URL, {
        provider: 'Gmail',
        operation: 'oauth.exchange',
        timeoutMs: providerTimeoutMs('OAUTH_HTTP_TIMEOUT_MS', 15_000),
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId(),
          client_secret: clientSecret(),
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        server.log.error({ status: tokenRes.status, body }, 'Gmail token exchange failed');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings?tab=integrations&error=gmail_token_failed`,
        );
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        scope?: string;
        token_type?: string;
      };

      // Fetch the user's Gmail address for display
      let externalEmail: string | undefined;
      let gmailProfileEvidence: {
        emailAddress?: string;
        messagesTotal?: number;
        threadsTotal?: number;
      } | null = null;
      try {
        const profileRes = await fetchWithTimeout(
          'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
          {
            provider: 'Gmail',
            operation: 'oauth.userinfo',
            timeoutMs: providerTimeoutMs('GMAIL_HTTP_TIMEOUT_MS', 15_000),
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          },
        );
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { email?: string };
          externalEmail = profile.email;
        }
      } catch (err) {
        server.log.warn({ err }, 'Could not fetch Gmail user profile');
      }

      try {
        const gmailProfileRes = await fetchWithTimeout(
          'https://gmail.googleapis.com/gmail/v1/users/me/profile',
          {
            provider: 'Gmail',
            operation: 'profile.get',
            timeoutMs: providerTimeoutMs('GMAIL_HTTP_TIMEOUT_MS', 15_000),
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          },
        );
        if (gmailProfileRes.ok) {
          gmailProfileEvidence = (await gmailProfileRes.json()) as {
            emailAddress?: string;
            messagesTotal?: number;
            threadsTotal?: number;
          };
          externalEmail ??= gmailProfileEvidence.emailAddress;
        }
      } catch (err) {
        server.log.warn({ err }, 'Could not fetch Gmail API profile');
      }

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined;

      await prisma.integrationToken.update({
        where: {
          orgId_userId_provider: { orgId, userId, provider: IntegrationProvider.gmail },
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

      if (gmailProfileEvidence) {
        await recordSerumConnectorTestSuccess({
          orgId,
          connectorId: 'gmail',
          operation: 'gmail.oauth.callback',
          testedByUserId: userId,
          evidence: {
            emailAddress: gmailProfileEvidence.emailAddress,
            messagesTotal: gmailProfileEvidence.messagesTotal,
            threadsTotal: gmailProfileEvidence.threadsTotal,
          },
        });
      }

      server.log.info(
        { orgId, userId, externalAccountDomain: emailDomainForTelemetry(externalEmail) },
        'Gmail connected',
      );

      return reply.redirect(
        `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings?tab=integrations&connected=gmail`,
      );
    },
  });

  // DELETE /integrations/gmail/disconnect
  app.delete('/integrations/gmail/disconnect', {
    schema: {
      response: { 204: z.null() },
    },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;
      await prisma.integrationToken.updateMany({
        where: {
          orgId,
          userId,

          provider: IntegrationProvider.gmail,
        },
        data: { status: 'revoked', deletedAt: new Date() },
      });
      return reply.status(204).send(null);
    },
  });
};
