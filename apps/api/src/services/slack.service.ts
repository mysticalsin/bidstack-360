/**
 * Slack service — Block Kit message delivery for channel posts and DMs.
 *
 * Design decisions:
 *  - All public functions return { ok, ts?, error? } so callers can handle
 *    failure without throwing. The queue worker calls these and decides retry.
 *  - Bot token fetched fresh on every call via decryptToken to support
 *    mid-session token refresh without restart.
 *  - DM is two-step: conversations.open → chat.postMessage.
 *    WHY: Slack requires opening a DM channel before posting.
 *  - formatNotificationToBlocks converts generic Notification rows from the
 *    notification engine into structured Block Kit payloads.
 */

import { createHash } from 'node:crypto';
import { prisma } from '@bidstack/db';
import { decryptToken } from '@bidstack/shared';
import type pino from 'pino';

// ─── Types ────────────────────────────────────────────────────────────────

export type SlackBlock = Record<string, unknown>;

export interface PostMessageParams {
  orgId: string;
  channelId: string;
  blocks: SlackBlock[];
  text: string; // fallback text for notifications and non-GUI clients
}

export interface PostReplyParams {
  orgId: string;
  channelId: string;
  threadTs: string;
  blocks: SlackBlock[];
  text?: string;
}

export interface DmUserParams {
  orgId: string;
  userId: string; // BidStack user id — resolved via SlackUserMapping
  blocks: SlackBlock[];
  text?: string;
}

export interface SlackResult {
  ok: boolean;
  ts?: string; // message timestamp for threading
  error?: string;
}

export interface NotificationPayload {
  id: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  actorName?: string;
  occurredAt?: Date;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

const SLACK_API = 'https://slack.com/api';

async function getBotToken(orgId: string): Promise<string> {
  const token = await prisma.integrationToken.findFirst({
    where: {
      orgId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: 'slack' as any,
      status: 'active',
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!token) {
    throw new Error(`No active Slack token for org ${orgId}`);
  }

  return decryptToken(token.accessTokenEncrypted);
}

async function slackPost(
  method: string,
  token: string,
  body: Record<string, unknown>,
  log?: pino.Logger,
): Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const status = res.status;
    log?.warn({ method, status }, 'Slack API HTTP error');
    return { ok: false, error: `HTTP ${status}` };
  }

  // Slack always responds 200; check the payload for logical errors
  const data = (await res.json()) as {
    ok: boolean;
    ts?: string;
    channel?: string;
    error?: string;
  };

  if (!data.ok) {
    log?.warn({ method, error: data.error }, 'Slack API logical error');
  }

  return data;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Post a Block Kit message to a Slack channel.
 * Returns the message timestamp (ts) for threading on success.
 */
export async function postMessage(
  params: PostMessageParams,
  log?: pino.Logger,
): Promise<SlackResult> {
  const { orgId, channelId, blocks, text } = params;

  let botToken: string;
  try {
    botToken = await getBotToken(orgId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log?.warn({ orgId, error }, 'Slack postMessage: no bot token');
    return { ok: false, error };
  }

  const result = await slackPost(
    'chat.postMessage',
    botToken,
    { channel: channelId, blocks, text },
    log,
  );

  return { ok: result.ok, ts: result.ts, error: result.error };
}

/**
 * Post a threaded reply to an existing Slack message.
 */
export async function postReply(
  params: PostReplyParams,
  log?: pino.Logger,
): Promise<SlackResult> {
  const { orgId, channelId, threadTs, blocks, text } = params;

  let botToken: string;
  try {
    botToken = await getBotToken(orgId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }

  const result = await slackPost(
    'chat.postMessage',
    botToken,
    { channel: channelId, thread_ts: threadTs, blocks, text: text ?? '' },
    log,
  );

  return { ok: result.ok, ts: result.ts, error: result.error };
}

/**
 * Send a direct message to a BidStack user via their SlackUserMapping.
 * Opens an IM channel with conversations.open first (idempotent per Slack API).
 */
export async function dmUser(params: DmUserParams, log?: pino.Logger): Promise<SlackResult> {
  const { orgId, userId, blocks, text } = params;

  // Resolve BidStack user → Slack user id
  const mapping = await prisma.slackUserMapping.findUnique({
    where: { slack_user_mappings_org_user_key: { orgId, userId } },
  });

  if (!mapping) {
    log?.warn({ orgId, userId }, 'Slack dmUser: no user mapping found');
    return { ok: false, error: 'no_slack_user_mapping' };
  }

  let botToken: string;
  try {
    botToken = await getBotToken(orgId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }

  // Step 1 — open DM channel
  const openResult = await slackPost(
    'conversations.open',
    botToken,
    { users: mapping.slackUserId },
    log,
  );

  if (!openResult.ok || !openResult.channel) {
    return { ok: false, error: openResult.error ?? 'conversations_open_failed' };
  }

  // Step 2 — post message to DM channel
  const postResult = await slackPost(
    'chat.postMessage',
    botToken,
    { channel: openResult.channel, blocks, text: text ?? '' },
    log,
  );

  return { ok: postResult.ok, ts: postResult.ts, error: postResult.error };
}

/**
 * Convert a generic notification payload into a Block Kit message.
 *
 * Layout:
 *  - Header section: notification title
 *  - Body section: notification text
 *  - Context section: actor + timestamp
 *  - Actions: "View" button deep-linking into the CRM entity
 *
 * WHY Block Kit over plain text: supports interactive "Mark read" button
 * and renders rich context without cluttering the DM with long URLs.
 */
export function formatNotificationToBlocks(
  notification: NotificationPayload,
  baseUrl: string,
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: notification.title,
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: notification.body,
      },
    },
  ];

  // Context section: actor name + formatted timestamp
  const contextElements: Record<string, unknown>[] = [];
  if (notification.actorName) {
    contextElements.push({
      type: 'mrkdwn',
      text: `*By:* ${notification.actorName}`,
    });
  }
  if (notification.occurredAt) {
    const unixTs = Math.floor(notification.occurredAt.getTime() / 1000);
    contextElements.push({
      type: 'mrkdwn',
      text: `<!date^${unixTs}^{date_short_pretty} at {time}|${notification.occurredAt.toISOString()}>`,
    });
  }
  if (contextElements.length > 0) {
    blocks.push({ type: 'context', elements: contextElements });
  }

  // "View in BidStack" action button — only when entity is linkable
  if (notification.entityType && notification.entityId) {
    const entityPath = buildEntityPath(notification.entityType, notification.entityId);
    if (entityPath) {
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'View in BidStack', emoji: false },
            url: `${baseUrl}${entityPath}`,
            // action_id is deterministic so Slack deduplicates rapid clicks
            action_id: `view_${createHash('sha256').update(notification.id).digest('hex').slice(0, 8)}`,
          },
        ],
      });
    }
  }

  return blocks;
}

function buildEntityPath(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'opportunity':
      return `/opportunities/${entityId}`;
    case 'lead':
      return `/leads/${entityId}`;
    case 'contact':
      return `/contacts/${entityId}`;
    case 'task':
      return `/tasks/${entityId}`;
    case 'company':
      return `/companies/${entityId}`;
    default:
      return null;
  }
}
