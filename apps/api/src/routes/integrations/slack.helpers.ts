/**
 * Slack integration — shared constants, crypto helpers, sync helpers,
 * and event handlers.
 *
 * Imported by:
 *   routes/integrations/slack.ts  — OAuth/Events/channel routes
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@bidstack/db';
import type pino from 'pino';

// pino type alias — avoids importing the heavy pino dep at the route level
export type SlackRouteLogger = Pick<pino.Logger, 'debug' | 'error' | 'info' | 'warn'>;

// ─── Constants ───────────────────────────────────────────────────────────────

export const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
export const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';

export const SLACK_SCOPES = [
  'chat:write',
  'channels:read',
  'groups:read',
  'im:write',
  'users:read',
  'users:read.email',
].join(',');

// ─── Env helpers ─────────────────────────────────────────────────────────────

export function clientId(): string {
  const v = process.env.SLACK_CLIENT_ID;
  if (!v) throw new Error('SLACK_CLIENT_ID is not set');
  return v;
}
export function clientSecret(): string {
  const v = process.env.SLACK_CLIENT_SECRET;
  if (!v) throw new Error('SLACK_CLIENT_SECRET is not set');
  return v;
}
export function signingSecret(): string {
  const v = process.env.SLACK_SIGNING_SECRET;
  if (!v) throw new Error('SLACK_SIGNING_SECRET is not set');
  return v;
}
export function redirectUri(): string {
  return (
    process.env.SLACK_REDIRECT_URI ??
    `${process.env.PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/integrations/slack/oauth/callback`
  );
}

// ─── Slack API helper ─────────────────────────────────────────────────────────

export async function slackGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://slack.com/api/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json() as Promise<T>;
}

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verify Slack's X-Slack-Signature HMAC-SHA256 header.
 * Uses timingSafeEqual to prevent timing oracle attacks.
 * Rejects requests older than 5 minutes (replay protection).
 */
export function verifySlackSignature(
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

// ─── Event handlers ───────────────────────────────────────────────────────────

export async function handleChannelCreated(
  event: Record<string, unknown>,
  teamId: string,
  log: SlackRouteLogger,
): Promise<void> {
  const channel = event.channel as { id?: string; name?: string; is_private?: boolean } | undefined;
  if (!channel?.id || !channel.name) return;

  const workspace = await prisma.slackWorkspace.findFirst({
    where: { slackTeamId: teamId },
  });
  if (!workspace) return;

  await prisma.slackChannel
    .upsert({
      where: {
        orgId_channelId: {
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

export async function handleMemberJoinedChannel(
  event: Record<string, unknown>,
  teamId: string,
  log: SlackRouteLogger,
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

// ─── Sync helpers ─────────────────────────────────────────────────────────────

export async function syncChannels(
  orgId: string,
  integrationTokenId: string,
  accessToken: string,
  log: SlackRouteLogger,
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
        where: { orgId_channelId: { orgId, channelId: ch.id } },
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

export async function buildUserMappings(
  orgId: string,
  accessToken: string,
  log: SlackRouteLogger,
): Promise<void> {
  // Fetch Slack user list (paginated — first page only on connect for speed)
  const usersData = await slackGet<{
    ok: boolean;
    members?: Array<{
      id: string;
      profile?: { email?: string };
      deleted?: boolean;
      is_bot?: boolean;
    }>;
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
        where: { orgId_userId: { orgId, userId: user.id } },
        create: { orgId, userId: user.id, slackUserId },
        update: { slackUserId },
      })
      .catch((err) => log.warn({ err, userId: user.id }, 'SlackUserMapping upsert failed'));
  }

  log.info({ orgId, matched: orgUsers.length }, 'Slack user mappings built');
}
