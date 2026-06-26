/**
 * Slack integration routes — OAuth v2, Events API, channel listing, disconnect.
 *
 * Scopes requested:
 *  - chat:write          — post to channels the bot is a member of
 *  - channels:read       — list public channels (channel picker)
 *  - groups:read         — list private channels (channel picker)
 *  - im:write            — open direct message channels
 *  - users:read          — resolve user details for DM routing
 *  - users:read.email    — match BidStack users to Slack users by email
 *
 * WHY groups:read over channels:read only: private channels are visible in
 * the picker so admins can route sensitive deal alerts to private channels.
 * WHY im:write: required for conversations.open before DM delivery.
 * WHY users:read.email: enables automatic SlackUserMapping on connect so
 * users receive DMs without manually linking their accounts.
 *
 * Events API:
 *  - POST /integrations/slack/events — receives member_joined_channel and
 *    channel_created events. Verifies X-Slack-Signature HMAC-SHA256 using
 *    timingSafeEqual for constant-time comparison.
 *
 * Token storage: IntegrationToken with provider=slack (bot token).
 * Workspace row: SlackWorkspace (one per org).
 * Channel list: SlackChannel rows, refreshed on each connect.
 * User mappings: SlackUserMapping — built from users.list on connect.
 *
 * Shared helpers → slack.helpers.ts
 */

import { randomBytes, createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma, IntegrationProvider } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared/token-crypto';
import { recordSerumConnectorTestSuccess } from '../../lib/serum-connector-policy.js';
import {
  SLACK_AUTH_URL,
  SLACK_TOKEN_URL,
  SLACK_SCOPES,
  clientId,
  clientSecret,
  redirectUri,
  verifySlackSignature,
  syncChannels,
  slackGet,
  buildUserMappings,
  handleChannelCreated,
  handleMemberJoinedChannel,
} from './slack.helpers.js';

// ─── Route plugin ─────────────────────────────────────────────────────────────

export const slackOAuthRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // GET /integrations/slack/oauth/start
  app.get('/integrations/slack/oauth/start', {
    schema: {
      response: { 200: z.object({ authUrl: z.string().url() }) },
    },
    handler: async (req, reply) => {
      const { userId, orgId } = req.auth;

      const nonce = randomBytes(16).toString('hex');
      const statePayload = `${orgId}:${userId}:${nonce}`;
      const state = createHash('sha256').update(statePayload).digest('base64url');

      // Persist pending state for CSRF verification
      await prisma.integrationToken.upsert({
        where: {
          orgId_userId_provider: {
            orgId,
            userId,
            provider: IntegrationProvider.slack,
          },
        },
        create: {
          orgId,
          userId,
          provider: IntegrationProvider.slack,
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
        scope: SLACK_SCOPES,
        redirect_uri: redirectUri(),
        state,
      });

      return reply.send({ authUrl: `${SLACK_AUTH_URL}?${params.toString()}` });
    },
  });

  // GET /integrations/slack/oauth/callback
  app.get('/integrations/slack/oauth/callback', {
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
      const redirectBase = process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173';

      if (error) {
        server.log.warn({ error }, 'Slack OAuth denied by user');
        return reply.redirect(`${redirectBase}/settings/integrations?error=slack_denied`);
      }
      if (!code || !state) {
        throw server.httpErrors.badRequest('Missing code or state');
      }

      // CSRF state verification
      const record = await prisma.integrationToken.findUnique({
        where: {
          orgId_userId_provider: {
            orgId,
            userId,
            provider: IntegrationProvider.slack,
          },
        },
      });
      const storedPayload = (record?.deltaState as Record<string, string> | null)?.oauthState;
      if (!storedPayload) throw server.httpErrors.badRequest('OAuth session not found');

      const expectedState = createHash('sha256').update(storedPayload).digest('base64url');
      if (state !== expectedState) {
        server.log.warn({ orgId, userId }, 'Slack OAuth forged state parameter rejected');
        throw server.httpErrors.forbidden('Invalid OAuth state');
      }

      // Exchange code for token
      const formData = new URLSearchParams({
        client_id: clientId(),
        client_secret: clientSecret(),
        code,
        redirect_uri: redirectUri(),
      });

      const tokenRes = await fetch(SLACK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      if (!tokenRes.ok) {
        server.log.error({ status: tokenRes.status }, 'Slack token exchange HTTP error');
        return reply.redirect(`${redirectBase}/settings/integrations?error=slack_token_failed`);
      }

      const tokens = (await tokenRes.json()) as {
        ok: boolean;
        access_token?: string;
        bot_user_id?: string;
        team?: { id?: string; name?: string };
        authed_user?: { id?: string };
        error?: string;
        scope?: string;
      };

      if (!tokens.ok || !tokens.access_token) {
        server.log.error({ slackError: tokens.error }, 'Slack token exchange failed');
        return reply.redirect(`${redirectBase}/settings/integrations?error=slack_token_failed`);
      }

      // Persist the bot token
      const savedToken = await prisma.integrationToken.update({
        where: {
          orgId_userId_provider: {
            orgId,
            userId,
            provider: IntegrationProvider.slack,
          },
        },
        data: {
          accessTokenEncrypted: encryptToken(tokens.access_token),
          scope: tokens.scope?.split(',') ?? [],
          status: 'active',
          externalAccountId: tokens.team?.id,
          externalAccountEmail: tokens.team?.name,
          deltaState: {},
          lastRefreshedAt: new Date(),
        },
      });

      // Upsert SlackWorkspace row
      if (tokens.team?.id && tokens.team.name && tokens.bot_user_id) {
        await prisma.slackWorkspace.upsert({
          where: { orgId },
          create: {
            orgId,
            integrationTokenId: savedToken.id,
            slackTeamId: tokens.team.id,
            teamName: tokens.team.name,
            botUserId: tokens.bot_user_id,
            botScopes: tokens.scope?.split(',') ?? [],
          },
          update: {
            integrationTokenId: savedToken.id,
            slackTeamId: tokens.team.id,
            teamName: tokens.team.name,
            botUserId: tokens.bot_user_id,
            botScopes: tokens.scope?.split(',') ?? [],
          },
        });
      }

      const accessToken = tokens.access_token;

      try {
        const authTest = await slackGet<{
          ok: boolean;
          team?: string;
          team_id?: string;
          user_id?: string;
          bot_id?: string;
          error?: string;
        }>('auth.test', accessToken);
        if (authTest.ok) {
          await recordSerumConnectorTestSuccess({
            orgId,
            connectorId: 'slack',
            operation: 'slack.oauth.callback',
            testedByUserId: userId,
            evidence: {
              team: authTest.team,
              teamId: authTest.team_id,
              userId: authTest.user_id,
              botId: authTest.bot_id,
            },
          });
        }
      } catch (err) {
        server.log.warn({ err }, 'Slack auth.test failed; connection evidence not recorded');
      }

      // Sync channel list (non-fatal on error)
      try {
        await syncChannels(orgId, savedToken.id, accessToken, server.log);
      } catch (err) {
        server.log.warn({ err }, 'Slack channel sync failed — non-fatal');
      }

      // Build user mappings from users.list + email match (non-fatal)
      try {
        await buildUserMappings(orgId, accessToken, server.log);
      } catch (err) {
        server.log.warn({ err }, 'Slack user mapping failed — non-fatal');
      }

      server.log.info({ orgId, userId, team: tokens.team?.name }, 'Slack workspace connected');
      return reply.redirect(`${redirectBase}/settings/integrations?connected=slack`);
    },
  });

  // GET /integrations/slack/channels — list available channels for notification config
  app.get('/integrations/slack/channels', {
    schema: {
      response: {
        200: z.object({
          channels: z.array(
            z.object({
              id: z.string(),
              channelId: z.string(),
              channelName: z.string(),
              isShared: z.boolean(),
              isPrivate: z.boolean(),
              isMember: z.boolean(),
              isArchived: z.boolean(),
            }),
          ),
        }),
      },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const channels = await prisma.slackChannel.findMany({
        where: { orgId },
        orderBy: { channelName: 'asc' },
      });
      return reply.send({ channels });
    },
  });

  // GET /integrations/slack/workspace — current workspace info
  app.get('/integrations/slack/workspace', {
    schema: {
      response: {
        200: z.object({
          workspace: z
            .object({
              id: z.string(),
              teamName: z.string(),
              slackTeamId: z.string(),
              botScopes: z.array(z.string()),
              connectedAt: z.string(),
            })
            .nullable(),
        }),
      },
    },
    handler: async (req, reply) => {
      const { orgId } = req.auth;
      const ws = await prisma.slackWorkspace.findUnique({ where: { orgId } });
      if (!ws) return reply.send({ workspace: null });
      return reply.send({
        workspace: {
          id: ws.id,
          teamName: ws.teamName,
          slackTeamId: ws.slackTeamId,
          botScopes: (ws.botScopes as string[]) ?? [],
          connectedAt: ws.createdAt.toISOString(),
        },
      });
    },
  });

  // DELETE /integrations/slack/disconnect — revoke token and delete workspace
  app.delete('/integrations/slack/disconnect', {
    schema: { response: { 204: z.null() } },
    handler: async (req, reply) => {
      const { orgId, userId } = req.auth;

      // Best-effort Slack API revocation (non-fatal)
      try {
        const token = await prisma.integrationToken.findFirst({
          where: {
            orgId,
            userId,
            provider: IntegrationProvider.slack,
            status: 'active',
          },
        });
        if (token) {
          const { decryptToken: _dec } = await import('@bidstack/shared/token-crypto');
          const botToken = _dec(token.accessTokenEncrypted);
          await fetch('https://slack.com/api/auth.revoke', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${botToken}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });
        }
      } catch {
        // Non-fatal — we still mark the token revoked locally
      }

      await prisma.integrationToken.updateMany({
        where: {
          orgId,
          userId,
          provider: IntegrationProvider.slack,
        },
        data: { status: 'revoked', deletedAt: new Date() },
      });

      // Cascade via DB: SlackWorkspace delete cascades to SlackChannel
      await prisma.slackWorkspace.deleteMany({ where: { orgId } });

      server.log.info({ orgId, userId }, 'Slack workspace disconnected');
      return reply.status(204).send(null);
    },
  });

  // POST /integrations/slack/events — Slack Events API webhook
  // Must NOT be behind auth middleware — Slack signs the request itself.
  // Registered at /api/v1/integrations/slack/events but public.
  app.post('/integrations/slack/events', {
    config: { public: true },
    schema: {
      body: z.record(z.unknown()),
      response: { 200: z.object({ challenge: z.string().optional() }) },
    },
    handler: async (req, reply) => {
      const timestamp = req.headers['x-slack-request-timestamp'];
      const signature = req.headers['x-slack-signature'];

      if (!timestamp || !signature || Array.isArray(timestamp) || Array.isArray(signature)) {
        throw server.httpErrors.badRequest('Missing Slack signature headers');
      }

      // Constant-time signature verification
      const rawBody = JSON.stringify(req.body);
      if (!verifySlackSignature(timestamp, rawBody, signature)) {
        server.log.warn({ timestamp }, 'Slack Events API: invalid signature rejected');
        throw server.httpErrors.forbidden('Invalid Slack signature');
      }

      const payload = req.body as Record<string, unknown>;

      // URL verification challenge (one-time on Events API setup)
      if (payload.type === 'url_verification') {
        return reply.send({ challenge: payload.challenge as string });
      }

      // Event dispatch
      if (payload.type === 'event_callback') {
        const event = (payload.event ?? {}) as Record<string, unknown>;
        const teamId = payload.team_id as string | undefined;

        if (event.type === 'channel_created' && teamId) {
          await handleChannelCreated(event, teamId, server.log);
        } else if (event.type === 'member_joined_channel' && teamId) {
          await handleMemberJoinedChannel(event, teamId, server.log);
        }
      }

      // Slack requires a 200 within 3 seconds — always respond OK
      return reply.send({});
    },
  });
};
