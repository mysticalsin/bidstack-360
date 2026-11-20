// Domain event: an activity landed on an account. Emitted by the synced
// meetings and emails bridge and by activity ingest; account follow
// notifications subscribe here. With no subscriber it is a no-op, and a
// failing subscriber never fails the sync that emitted the event.
//
// Two subscription levels:
// - per item (subscribeAccountActivityCreated): every activity, as it lands.
// - digest (subscribeAccountActivityDigest): one event per account per run.
//   Inside runAccountActivityBatch the items are held and flushed together
//   when the run ends, so a bulk import raises one alert per account, not
//   one per item. Outside a batch each item is its own digest.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface AccountActivityCreated {
  orgId: string;
  companyId: string;
  activityId: string;
  /** Null when the system created it (provider sync), else the person who did. */
  actorUserId: string | null;
  /** Polo users already on the item (mailbox owner, internal attendees); never alerted about it. */
  involvedUserIds?: string[];
}

export interface AccountActivityDigest {
  orgId: string;
  companyId: string;
  activityIds: string[];
  /** The one person behind every item (actor, else the involved owner); null when mixed or none. */
  actorUserId: string | null;
  /** Actors and involved users of every item; none of them is alerted. */
  excludeUserIds: string[];
}

export type AccountActivityListener = (event: AccountActivityCreated) => void | Promise<void>;
export type AccountActivityDigestListener = (digest: AccountActivityDigest) => void | Promise<void>;

const listeners = new Set<AccountActivityListener>();
const digestListeners = new Set<AccountActivityDigestListener>();
const batchStore = new AsyncLocalStorage<AccountActivityCreated[]>();

/** Most items one digest carries; the count past this is still reported by weight downstream. */
const MAX_DIGEST_ITEMS = 500;

/** Subscribe; returns the unsubscribe function. */
export function subscribeAccountActivityCreated(listener: AccountActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to one event per account per run; returns the unsubscribe function. */
export function subscribeAccountActivityDigest(listener: AccountActivityDigestListener): () => void {
  digestListeners.add(listener);
  return () => {
    digestListeners.delete(listener);
  };
}

async function dispatch<T>(set: Set<(e: T) => void | Promise<void>>, event: T): Promise<void> {
  for (const listener of [...set]) {
    try {
      await listener(event);
    } catch {
      // Swallowed on purpose: see header.
    }
  }
}

/** Fold the items of one run into one digest per (org, account). */
export function digestAccountActivity(items: readonly AccountActivityCreated[]): AccountActivityDigest[] {
  const groups = new Map<string, AccountActivityCreated[]>();
  for (const item of items) {
    const key = `${item.orgId}\u0000${item.companyId}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0]!;
    const people = new Set(group.map((i) => i.actorUserId ?? i.involvedUserIds?.[0] ?? null));
    const exclude = new Set<string>();
    for (const i of group) {
      if (i.actorUserId) exclude.add(i.actorUserId);
      for (const id of i.involvedUserIds ?? []) exclude.add(id);
    }
    const activityIds = [...new Set(group.map((i) => i.activityId))].slice(0, MAX_DIGEST_ITEMS);
    return {
      orgId: first.orgId,
      companyId: first.companyId,
      activityIds,
      actorUserId: people.size === 1 ? ([...people][0] ?? null) : null,
      excludeUserIds: [...exclude],
    };
  });
}

/**
 * Hold every account activity raised inside `fn` and emit one digest per
 * account when it settles, whether it resolved or threw (rows written before a
 * failure are real). A nested call joins the outer run.
 */
export async function runAccountActivityBatch<T>(fn: () => Promise<T>): Promise<T> {
  if (batchStore.getStore()) return fn();
  const items: AccountActivityCreated[] = [];
  try {
    return await batchStore.run(items, fn);
  } finally {
    for (const digest of digestAccountActivity(items)) await dispatch(digestListeners, digest);
  }
}

export async function onAccountActivityCreated(
  orgId: string,
  companyId: string,
  activityId: string,
  actorUserId: string | null,
  involvedUserIds: string[] = [],
): Promise<void> {
  const event: AccountActivityCreated = { orgId, companyId, activityId, actorUserId, involvedUserIds };
  await dispatch(listeners, event);
  const batch = batchStore.getStore();
  if (batch) {
    batch.push(event);
    return;
  }
  for (const digest of digestAccountActivity([event])) await dispatch(digestListeners, digest);
}
