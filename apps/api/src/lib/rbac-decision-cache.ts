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
        user: { orgId, deletedAt: null },
        role: {
          orgId,
          deletedAt: null,
          permissions: {
            some: {
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

async function getDecision(
  orgId: string,
  userId: string,
  discriminator: string,
  load: () => Promise<boolean>,
): Promise<boolean> {
  const key = cacheKey(orgId, userId, discriminator);
  const hit = decisionCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.allowed;

  const allowed = await load();
  if (decisionCache.size >= MAX_CACHE_ENTRIES) decisionCache.clear();
  decisionCache.set(key, { allowed, expiresAt: Date.now() + CACHE_TTL_MS });
  return allowed;
}

function applyInvalidation(orgId: string, userId?: string): void {
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
