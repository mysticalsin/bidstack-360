import { prisma } from '@bidstack/db';
import type { PermissionKey } from '@bidstack/shared';

import { createLogger } from './logger.js';
import { publish, subscribe } from '../services/realtime.service.js';

const log = createLogger({ name: 'rbac-decision-cache' });

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_ENTRIES = 20_000;
const INVALIDATION_CHANNEL = 'rbac-decision:invalidate';

interface CacheEntry {
  allowed: boolean;
  expiresAt: number;
}

interface InvalidationMessage {
  orgId: string;
  userId?: string;
}

const decisionCache = new Map<string, CacheEntry>();

// Bumped on every invalidation (local or cross-replica pub/sub). getDecision
// captures this before its DB load and refuses to write the cache if it
// changed while the load was in flight — otherwise a load started before a
// revocation can resolve `allowed: true` and land in the cache AFTER the
// invalidation already ran, re-caching a stale ALLOW for the full TTL.
let invalidationEpoch = 0;

export async function userHasAnyRole(
  orgId: string,
  userId: string,
  allowedNames: string[],
): Promise<boolean> {
  const roleKey = allowedNames.map(normalizeRoleName).sort().join('|');
  return getDecision(orgId, userId, `role:${roleKey}`, async () => {
    const roleNameFilters = allowedNames.map((name) => ({
      name: { equals: name, mode: 'insensitive' as const },
    }));

    const assignedRoleCount = await prisma.userRole.count({
      where: {
        userId,
        // The ASSIGNMENT row's own tombstone. Revocation is a soft delete on
        // user_roles (routes/users.ts DELETE /users/:id/roles/:roleId), so
        // without this the revoked user keeps the role forever: the audit log
        // records the revoke and the users list stops showing it, while every
        // authorization check here still passes.
        deletedAt: null,
        user: { orgId, deletedAt: null },
        role: {
          orgId,
          OR: roleNameFilters,
          deletedAt: null,
        },
      },
    });

    return assignedRoleCount > 0;
  });
}

export async function userHasPermission(
  orgId: string,
  userId: string,
  permission: PermissionKey,
): Promise<boolean> {
  return getDecision(orgId, userId, `permission:${permission}`, async () => {
    const assignedPermissionCount = await prisma.userRole.count({
      where: {
        userId,
        // See userHasAnyRole: the assignment's own tombstone, without which a
        // revoked role keeps granting every permission it carries.
        deletedAt: null,
        user: { orgId, deletedAt: null },
        role: {
          orgId,
          deletedAt: null,
          permissions: {
            some: {
              // RolePermission is soft-deletable too, and revoking a single
              // permission from a role is the same class of no-op without this.
              deletedAt: null,
              permission: { key: permission },
            },
          },
        },
      },
    });

    return assignedPermissionCount > 0;
  });
}

export function invalidateRbacDecisionCache(orgId: string, userId?: string): void {
  applyInvalidation(orgId, userId);

  if (process.env.NODE_ENV === 'test') return;

  const message: InvalidationMessage = { orgId, ...(userId ? { userId } : {}) };
  void publish(INVALIDATION_CHANNEL, 'rbac-decision.invalidate', message).catch((err) => {
    log.warn({ err, orgId, userId }, 'failed to broadcast RBAC decision invalidation');
  });
}

export function clearRbacDecisionCacheForTest(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('clearRbacDecisionCacheForTest is only available in NODE_ENV=test');
  }
  decisionCache.clear();
}

// Exposes Map iteration order (= LRU order: oldest/least-recently-touched
// first) so eviction behavior is directly assertable instead of inferred.
export function getRbacDecisionCacheKeysForTest(): string[] {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('getRbacDecisionCacheKeysForTest is only available in NODE_ENV=test');
  }
  return [...decisionCache.keys()];
}

async function getDecision(
  orgId: string,
  userId: string,
  discriminator: string,
  load: () => Promise<boolean>,
): Promise<boolean> {
  const key = cacheKey(orgId, userId, discriminator);
  const hit = decisionCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    // Touch: re-insert to move this key to the MRU end (Map preserves
    // insertion order), so a hot key survives eviction below.
    decisionCache.delete(key);
    decisionCache.set(key, hit);
    return hit.allowed;
  }

  const epochAtLoadStart = invalidationEpoch;
  const allowed = await load();

  // An invalidation landed while `load()` was in flight: its result may
  // reflect permissions from before the revocation. Return it to this caller
  // (a stale ALLOW here is no worse than the request having started a moment
  // earlier) but do NOT cache it, so the next call re-checks the DB instead
  // of reading back the same stale answer for the rest of the TTL.
  if (invalidationEpoch !== epochAtLoadStart) {
    return allowed;
  }

  if (decisionCache.size >= MAX_CACHE_ENTRIES) {
    // Evict only the single least-recently-used entry (Map's first key),
    // not the whole cache — a full clear() at the cap makes every org's next
    // request re-hit Postgres simultaneously (a decision-cache stampede).
    const lruKey = decisionCache.keys().next().value;
    if (lruKey !== undefined) decisionCache.delete(lruKey);
  }
  decisionCache.set(key, { allowed, expiresAt: Date.now() + CACHE_TTL_MS });
  return allowed;
}

function applyInvalidation(orgId: string, userId?: string): void {
  invalidationEpoch++;

  if (userId) {
    const prefix = `${orgId}:${userId}:`;
    for (const key of decisionCache.keys()) {
      if (key.startsWith(prefix)) decisionCache.delete(key);
    }
    return;
  }

  const prefix = `${orgId}:`;
  for (const key of decisionCache.keys()) {
    if (key.startsWith(prefix)) decisionCache.delete(key);
  }
}

function cacheKey(orgId: string, userId: string, discriminator: string): string {
  return `${orgId}:${userId}:${discriminator}`;
}

function normalizeRoleName(name: string): string {
  return name.trim().toLowerCase();
}

if (process.env.NODE_ENV !== 'test') {
  subscribe(INVALIDATION_CHANNEL, (payload) => {
    const data = payload.data as InvalidationMessage | undefined;
    if (!data || typeof data.orgId !== 'string') return;
    applyInvalidation(data.orgId, data.userId);
  });
}
