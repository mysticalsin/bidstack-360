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
 * State parameter: CSRF token bound to Clerk session, verified on callback.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared';

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

      // CSRF state: hash of orgId + userId + random nonce
      const nonce = randomBytes(16).toString('hex');
      const statePayload = `${orgId}:${userId}:${nonce}`;
      const state = createHash('sha256').update(statePayload).digest('base64url');

      // Store the raw state payload so callback can verify
      await prisma.integrationToken.upsert({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          integration_tokens_org_user_provider_key: { orgId, userId, provider: 'gmail' as any },
        },
        create: {
          orgId,
          userId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'gmail' as any,
          accessTokenEncrypted: encryptToken('pending'),
          status: 'revoked',
          deltaState: { oauthState: statePayload },
        },
        update: {
          deltaState: { oauthState: statePayload },
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
    schema: {
      querystring: z.object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      }),
    },
    handler: async (req, reply) => {
      const { code, state, error } = req.query;
      const { userId, orgId } = req.auth;

      if (error) {
        server.log.warn({ error }, 'Gmail OAuth denied by user');
        return reply.redirect(
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings/integrations?error=gmail_denied`,
        );
      }
      if (!code || !state) {
        throw server.httpErrors.badRequest('Missing code or state parameter');
      }

      // Verify CSRF state
      const record = await prisma.integrationToken.findUnique({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          integration_tokens_org_user_provider_key: { orgId, userId, provider: 'gmail' as any },
        },
      });
      const storedPayload = (record?.deltaState as Record<string, string> | null)?.oauthState;
      if (!storedPayload) {
        throw server.httpErrors.badRequest('OAuth session not found — restart the flow');
      }
      const expectedState = createHash('sha256').update(storedPayload).digest('base64url');
      if (state !== expectedState) {
        server.log.warn({ orgId, userId }, 'Gmail OAuth forged state parameter rejected');
        throw server.httpErrors.forbidden('Invalid OAuth state — CSRF check failed');
      }

      // Exchange auth code for access + refresh tokens
      const tokenRes = await fetch(GMAIL_TOKEN_URL, {
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
          `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings/integrations?error=gmail_token_failed`,
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
      try {
        const profileRes = await fetch(
          'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
          { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        );
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { email?: string };
          externalEmail = profile.email;
        }
      } catch (err) {
        server.log.warn({ err }, 'Could not fetch Gmail user profile');
      }

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : undefined;

      await prisma.integrationToken.update({
        where: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          integration_tokens_org_user_provider_key: { orgId, userId, provider: 'gmail' as any },
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

      server.log.info({ orgId, userId, email: externalEmail }, 'Gmail connected');

      return reply.redirect(
        `${process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173'}/settings/integrations?connected=gmail`,
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'gmail' as any,
        },
        data: { status: 'revoked', deletedAt: new Date() },
      });
      return reply.status(204).send();
    },
  });
};
