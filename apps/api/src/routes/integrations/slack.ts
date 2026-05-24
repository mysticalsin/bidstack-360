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
 */

import { randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { type ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '@bidstack/db';
import { encryptToken } from '@bidstack/shared';

const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

const SLACK_SCOPES = [
  'chat:write',
  'channels:read',
  'groups:read',
  'im:write',
  'users:read',
  'users:read.email',
].join(',');

function clientId(): string {
  const v = process.env.SLACK_CLIENT_ID;
  if (!v) throw new Error('SLACK_CLIENT_ID is not set');
  return v;
}
function clientSecret(): string {
  const v = process.env.SLACK_CLIENT_SECRET;
  if (!v) throw new Error('SLACK_CLIENT_SECRET is not set');
  return v;
}
function signingSecret(): string {
  const v = process.env.SLACK_SIGNING_SECRET;
  if (!v) throw new Error('SLACK_SIGNING_SECRET is not set');
  return v;
}
function redirectUri(): string {
  return (
    process.env.SLACK_REDIRECT_URI ??
    `${process.env.PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/integrations/slack/oauth/callback`
  );
}

// ─── Slack API helpers ────────────────────────────────────────────────────

async function slackGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://slack.com/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<T>;
}

// ─── Signature verification ───────────────────────────────────────────────

/**
 * Verify Slack's X-Slack-Signature HMAC-SHA256 header.
 * Uses timingSafeEqual to prevent timing oracle attacks.
 * Rejects requests older than 5 minutes (replay protection).
 */
function verifySlackSignature(
  requestTimestamp: string,
  requestBody: string,
  signatureHeader: string,
): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  const reqSec = parseInt(requestTimestamp, 10);

  // Reject stale requests (replay protection)
  if (Math.abs(nowSec - reqSec) > 300) return false;

  // WHY HMAC-SHA256 not plain SHA-256: Slack signing uses HMAC keyed on the
  // signing secret. The signature binds both the content and the secret so
  // an attacker who knows the body cannot forge a valid signature.
  const baseString = `v0:${requestTimestamp}:${requestBody}`;
  const expectedHmac = `v0=${createHmac('sha256', signingSecret()).update(baseString).digest('hex')}`;

  try {
    const expectedBuf = Buffer.from(expectedHmac, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

// ─── Route plugin ─────────────────────────────────────────────────────────

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
          integration_tokens_org_user_provider_key: {
            orgId,
            userId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: 'slack' as any,
          },
        },
        create: {
          orgId,
          userId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'slack' as any,
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
          integration_tokens_org_user_provider_key: {
            orgId,
            userId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: 'slack' as any,
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
          integration_tokens_org_user_provider_key: {
            orgId,
            userId,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: 'slack' as any,
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            provider: 'slack' as any,
            status: 'active',
          },
        });
        if (token) {
          const { decryptToken: _dec } = await import('@bidstack/shared');
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'slack' as any,
        },
        data: { status: 'revoked', deletedAt: new Date() },
      });

      // Cascade via DB: SlackWorkspace delete cascades to SlackChannel
      await prisma.slackWorkspace.deleteMany({ where: { orgId } });

      server.log.info({ orgId, userId }, 'Slack workspace disconnected');
      return reply.status(204).send();
    },
  });

  // POST /integrations/slack/events — Slack Events API webhook
  // Must NOT be behind auth middleware — Slack signs the request itself.
  // Registered at /api/v1/integrations/slack/events but public.
  app.post('/integrations/slack/events', {
    config: { skipAuth: true },
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

// ─── Event handlers ───────────────────────────────────────────────────────

async function handleChannelCreated(
  event: Record<string, unknown>,
  teamId: string,
  log: pino.Logger,
): Promise<void> {
  const channel = event.channel as
    | { id?: string; name?: string; is_private?: boolean }
    | undefined;
  if (!channel?.id || !channel.name) return;

  const workspace = await prisma.slackWorkspace.findFirst({
    where: { slackTeamId: teamId },
  });
  if (!workspace) return;

  await prisma.slackChannel
    .upsert({
      where: {
        slack_channels_org_channel_key: {
          orgId: workspace.orgId,
          channelId: channel.id,
        },
      },
      create: {
        orgId: workspace.orgId,
        integrationTokenId: workspace.integrationTokenId,
        slackWorkspaceId: workspace.id,
        channelId: channel.id,
        channelName: channel.name,
        isPrivate: channel.is_private ?? false,
      },
      update: { channelName: channel.name, isPrivate: channel.is_private ?? false },
    })
    .catch((err) => {
      log.warn({ err, channelId: channel.id }, 'channel_created upsert failed');
    });
}

async function handleMemberJoinedChannel(
  event: Record<string, unknown>,
  teamId: string,
  log: pino.Logger,
): Promise<void> {
  const channelId = event.channel as string | undefined;
  if (!channelId) return;

  const workspace = await prisma.slackWorkspace.findFirst({
    where: { slackTeamId: teamId },
  });
  if (!workspace) return;

  // Mark channel as isMember=true when the bot joins
  if (event.user === workspace.botUserId) {
    await prisma.slackChannel
      .updateMany({
        where: { orgId: workspace.orgId, channelId },
        data: { isMember: true },
      })
      .catch((err) => {
        log.warn({ err, channelId }, 'member_joined isMember update failed');
      });
  }
}

// ─── Sync helpers ─────────────────────────────────────────────────────────

async function syncChannels(
  orgId: string,
  integrationTokenId: string,
  accessToken: string,
  log: pino.Logger,
): Promise<void> {
  // Resolve workspace id once
  const workspace = await prisma.slackWorkspace.findUnique({ where: { orgId } });

  const channelsData = await slackGet<{
    ok: boolean;
    channels?: Array<{
      id: string;
      name: string;
      is_shared?: boolean;
      is_private?: boolean;
      is_member?: boolean;
      is_archived?: boolean;
    }>;
  }>('conversations.list?types=public_channel,private_channel&limit=200', accessToken);

  if (!channelsData.ok || !channelsData.channels) return;

  // Delete stale records then upsert fresh list
  await prisma.slackChannel.deleteMany({ where: { orgId } });

  for (const ch of channelsData.channels.slice(0, 200)) {
    await prisma.slackChannel
      .upsert({
        where: { slack_channels_org_channel_key: { orgId, channelId: ch.id } },
        create: {
          orgId,
          integrationTokenId,
          slackWorkspaceId: workspace?.id ?? null,
          channelId: ch.id,
          channelName: ch.name,
          isShared: ch.is_shared ?? false,
          isPrivate: ch.is_private ?? false,
          isMember: ch.is_member ?? false,
          isArchived: ch.is_archived ?? false,
        },
        update: {
          channelName: ch.name,
          isShared: ch.is_shared ?? false,
          isPrivate: ch.is_private ?? false,
          isMember: ch.is_member ?? false,
          isArchived: ch.is_archived ?? false,
        },
      })
      .catch((err) => log.warn({ err, channelId: ch.id }, 'channel upsert failed'));
  }

  log.info({ orgId, count: channelsData.channels.length }, 'Slack channels synced');
}

async function buildUserMappings(
  orgId: string,
  accessToken: string,
  log: pino.Logger,
): Promise<void> {
  // Fetch Slack user list (paginated — first page only on connect for speed)
  const usersData = await slackGet<{
    ok: boolean;
    members?: Array<{ id: string; profile?: { email?: string }; deleted?: boolean; is_bot?: boolean }>;
  }>('users.list?limit=200', accessToken);

  if (!usersData.ok || !usersData.members) return;

  // Build email → slackUserId map (exclude bots and deleted users)
  const emailMap = new Map<string, string>();
  for (const member of usersData.members) {
    if (member.deleted || member.is_bot) continue;
    const email = member.profile?.email?.toLowerCase();
    if (email) emailMap.set(email, member.id);
  }

  if (emailMap.size === 0) return;

  // Match against BidStack users in this org
  const orgUsers = await prisma.user.findMany({
    where: { orgId },
    select: { id: true, email: true },
  });

  for (const user of orgUsers) {
    const slackUserId = emailMap.get(user.email.toLowerCase());
    if (!slackUserId) continue;

    await prisma.slackUserMapping
      .upsert({
        where: { slack_user_mappings_org_user_key: { orgId, userId: user.id } },
        create: { orgId, userId: user.id, slackUserId },
        update: { slackUserId },
      })
      .catch((err) => log.warn({ err, userId: user.id }, 'SlackUserMapping upsert failed'));
  }

  log.info({ orgId, matched: orgUsers.length }, 'Slack user mappings built');
}

// pino type alias — avoids importing the heavy pino dep at the route level
import type pino from 'pino';
