/**
 * Redis state for Jarvis: run views (polled by the panel), pending write
 * actions (executed only by the confirm route) and the per-user rate limit.
 * Every record carries orgId + userId; reads check both so a run or action
 * id is useless to anyone but its creator.
 */
import { randomUUID } from 'node:crypto';

import type { AgentToolPreview } from '@bidstack/db/agent-tools';

import { redis } from '../../redis.js';

import type { JarvisRunView } from './jarvis.types.js';

const TTL_SECONDS = 15 * 60;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;

interface Owner {
  orgId: string;
  userId: string;
}

interface StoredRun extends Owner {
  view: JarvisRunView;
}

export interface PendingAction extends Owner {
  id: string;
  runId: string;
  tool: string;
  args: Record<string, unknown>;
  preview: AgentToolPreview;
}

const runKey = (runId: string) => `bidstack:jarvis:run:${runId}`;
const actionKey = (id: string) => `bidstack:jarvis:action:${id}`;

function owns(record: Owner, owner: Owner): boolean {
  return record.orgId === owner.orgId && record.userId === owner.userId;
}

export async function saveRun(owner: Owner, view: JarvisRunView): Promise<void> {
  const record: StoredRun = { ...owner, view };
  await redis.set(runKey(view.runId), JSON.stringify(record), 'EX', TTL_SECONDS);
}

export async function loadRun(runId: string, owner: Owner): Promise<JarvisRunView | null> {
  const raw = await redis.get(runKey(runId));
  if (!raw) return null;
  const record = JSON.parse(raw) as StoredRun;
  return owns(record, owner) ? record.view : null;
}

export async function stageAction(
  input: Omit<PendingAction, 'id'>,
): Promise<PendingAction> {
  const action: PendingAction = { ...input, id: randomUUID() };
  await redis.set(actionKey(action.id), JSON.stringify(action), 'EX', TTL_SECONDS);
  return action;
}

export async function peekAction(id: string, owner: Owner): Promise<PendingAction | null> {
  const raw = await redis.get(actionKey(id));
  if (!raw) return null;
  const action = JSON.parse(raw) as PendingAction;
  return owns(action, owner) ? action : null;
}

/** Single-use: only the caller whose DEL removed the key may execute it. */
export async function consumeAction(id: string, owner: Owner): Promise<PendingAction | null> {
  const action = await peekAction(id, owner);
  if (!action) return null;
  const removed = await redis.del(actionKey(id));
  return removed === 1 ? action : null;
}

export function rateLimitPerMinute(): number {
  const raw = Number(process.env.JARVIS_RATE_LIMIT_PER_MINUTE);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_RATE_LIMIT_PER_MINUTE;
}

/** Fixed one-minute window per org + user. Returns false when over the limit. */
export async function takeRateLimit(owner: Owner, nowMs = Date.now()): Promise<boolean> {
  const bucket = Math.floor(nowMs / 60_000);
  const key = `bidstack:jarvis:rl:${owner.orgId}:${owner.userId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 70);
  return count <= rateLimitPerMinute();
}
