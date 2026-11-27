// Presence service — tracks who is online in an org and which entity
// each user is currently viewing/editing.
//
// WHY Redis: presence is ephemeral. A 30s TTL means we never have stale
// "online" users after a crash or network drop. We don't write to Postgres
// for presence events — they're too frequent and too throwaway.
//
// Key layout:
//   presence:org:<orgId>:user:<userId>  → JSON PresenceEntry, 30s TTL
//
// Heartbeat: clients ping every 15s; server calls upsertPresence() on each
// ping which resets the TTL.

import Redis from 'ioredis';
import { publish } from './realtime.service.js';
import { shouldRemovePresenceRow } from './presence-ownership.js';

const PRESENCE_TTL_SECONDS = 30;

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

// Dedicated Redis client for presence writes — avoids interference with
// the pub/sub subscriber connection which must stay in subscribe mode.
const presenceRedis = new Redis(redisUrl, {
  connectTimeout: 1_000,
  enableOfflineQueue: true,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 5_000),
  lazyConnect: true,
});

presenceRedis.on('error', () => {
  // Presence errors are non-fatal — the app degrades gracefully.
});

export interface PresenceEntry {
  userId: string;
  orgId: string;
  name: string;
  avatarUrl: string | null;
  currentEntityType: string | null;
  currentEntityId: string | null;
  sessionId: string;
  lastSeenAt: number; // Unix ms
}

function presenceKey(orgId: string, userId: string): string {
  return `presence:org:${orgId}:user:${userId}`;
}

function orgPatternKey(orgId: string): string {
  return `presence:org:${orgId}:user:*`;
}

/**
 * Upsert the presence entry for a user. Resets the 30s TTL.
 * Called on connect and on every heartbeat ping.
 */
export async function upsertPresence(entry: PresenceEntry): Promise<void> {
  const key = presenceKey(entry.orgId, entry.userId);
  const value: PresenceEntry = { ...entry, lastSeenAt: Date.now() };
  await presenceRedis.set(key, JSON.stringify(value), 'EX', PRESENCE_TTL_SECONDS);

  // Broadcast to org channel so connected clients update their maps.
  await publish(`presence:org:${entry.orgId}`, 'presence.update', value);
}

// Delete only when the value is still the one we decided to remove. A
// heartbeat that landed between the read and the delete keeps its row.
const DELETE_IF_UNCHANGED_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

/**
 * Drop this socket's presence row. The close deletes the row only when its
 * sessionId is still the one stored. A newer socket or the team-list
 * heartbeat keeps the row, and a delete that did not land does not broadcast
 * a leave.
 */
export async function removePresence(
  orgId: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const key = presenceKey(orgId, userId);
  const raw = await presenceRedis.get(key);
  if (typeof raw !== 'string' || !shouldRemovePresenceRow(raw, sessionId)) return;
  const removed = await presenceRedis.eval(DELETE_IF_UNCHANGED_LUA, 1, key, raw);
  if (Number(removed) !== 1) return;

  await publish(`presence:org:${orgId}`, 'presence.remove', { userId, orgId });
}

/**
 * Get all online users in an org by scanning Redis keys.
 * Use sparingly — real-time preferred. The GET /presence/org route calls this.
 */
export async function getOrgPresence(orgId: string): Promise<PresenceEntry[]> {
  const pattern = orgPatternKey(orgId);
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return [];

  const values = await presenceRedis.mget(...keys);
  const entries: PresenceEntry[] = [];
  for (const raw of values) {
    if (!raw) continue;
    try {
      entries.push(JSON.parse(raw) as PresenceEntry);
    } catch {
      // Malformed entry — skip.
    }
  }
  return entries;
}

/**
 * Get all users currently viewing/editing a specific entity.
 */
export async function getEntityPresence(
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<PresenceEntry[]> {
  const all = await getOrgPresence(orgId);
  return all.filter(
    (e) => e.currentEntityType === entityType && e.currentEntityId === entityId,
  );
}

/** SCAN-based key listing — avoids KEYS which blocks Redis in production. */
async function scanKeys(pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await presenceRedis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

/** Graceful shutdown. */
export async function shutdownPresenceService(): Promise<void> {
  await presenceRedis.quit();
}
