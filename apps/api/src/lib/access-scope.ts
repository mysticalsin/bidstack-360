// M7 — access-based data scoping (PLAN.md ADR-7).
//
// What a user sees must mirror their group access in the source systems
// (ABC, Opportunity Management). Connectors don't exist yet, so groups are
// ADMIN-MANAGED in BidStack (Settings → Access groups); a future sync job
// will maintain the same UserGroup/UserGroupMember tables.
//
// Semantics v1 — country-scoped OPPORTUNITIES only:
// - A user's visible scope is the UNION of their non-deleted groups.
// - Zero memberships, or membership in any scopeAll group, = UNRESTRICTED.
//   (Back-compat default: orgs that never configure groups see no change.)
// - Otherwise an opportunity is visible when ANY of:
//     • opportunity.country ∈ scopeCountries
//     • opportunity.territory.countryCodes overlaps scopeCountries
//     • opportunity.ownerId = userId (you always see your own deals)
//   A group with empty scopeCountries (and scopeAll=false) therefore means
//   "own records only" — intentional, not a bug.
//
// HONEST LIMITS of v1 (documented gaps, not silent ones):
// - Opportunity LIST + COUNT + DETAIL-by-id (GET /opportunities/:id) are
//   scoped — a restricted user cannot open an out-of-scope deal by direct
//   link/ID. Companies/leads/contacts stay org-visible even though
//   Company.countryCode exists (v2 candidate).
// - API-key callers (req.auth.userId = "apikey:<id>", not a User row) are
//   unrestricted: keys are org-level credentials gated by read/write scopes.

import { prisma, type Prisma } from '@bidstack/db';

import { createLogger } from './logger.js';
import { publish, subscribe } from '../services/realtime.service.js';

const log = createLogger({ name: 'access-scope' });

export interface AccessScope {
  unrestricted: boolean;
  /** ISO-2 country codes visible to the user (union of their groups). */
  countries: string[];
  /** Caller's user id — needed for the owner-visibility rule. */
  userId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CACHE_TTL_MS = 60_000;
// Hard ceiling on group memberships read per user — bounded query.
const MAX_GROUPS = 100;
// Drop the whole cache past this size instead of LRU bookkeeping: scope
// lookups are one indexed query, so a rare full rebuild is cheaper than
// per-entry eviction logic.
const MAX_CACHE_ENTRIES = 5_000;

const scopeCache = new Map<string, { scope: AccessScope; expiresAt: number }>();

// Redis Pub/Sub channel for cross-replica cache invalidation. Each API replica
// holds its own in-process scopeCache; a group mutation on one replica must
// drop the matching entries on all the others or restricted users would keep
// seeing stale scope until the 60s TTL lapses.
const INVALIDATION_CHANNEL = 'access-scope:invalidate';

interface InvalidationMessage {
  orgId: string;
  userId?: string;
}

/** Resolve the caller's visibility scope (60s in-process cache). */
export async function getAccessScope(orgId: string, userId: string): Promise<AccessScope> {
  // API keys (and any non-User principal) carry no group membership —
  // querying the uuid column with "apikey:<id>" would throw. Org-level
  // credentials stay unrestricted; their power is bounded by key scopes.
  if (!UUID_RE.test(userId)) {
    return { unrestricted: true, countries: [], userId };
  }

  const cacheKey = `${orgId}:${userId}`;
  const hit = scopeCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.scope;

  const memberships = await prisma.userGroupMember.findMany({
    where: { orgId, userId, group: { deletedAt: null } },
    select: { group: { select: { scopeAll: true, scopeCountries: true } } },
    take: MAX_GROUPS,
  });

  let scope: AccessScope;
  if (memberships.length === 0 || memberships.some((m) => m.group.scopeAll)) {
    scope = { unrestricted: true, countries: [], userId };
  } else {
    const countries = [...new Set(memberships.flatMap((m) => m.group.scopeCountries))];
    scope = { unrestricted: false, countries, userId };
  }

  if (scopeCache.size >= MAX_CACHE_ENTRIES) scopeCache.clear();
  scopeCache.set(cacheKey, { scope, expiresAt: Date.now() + CACHE_TTL_MS });
  return scope;
}

/**
 * Drop the matching entries from THIS replica's in-process cache. Without a
 * userId the whole org is invalidated (group-level edits affect every member).
 * Local-only — never re-broadcasts, so it is safe to call from the pub/sub
 * subscriber without forming an invalidation loop.
 */
function applyInvalidation(orgId: string, userId?: string): void {
  if (userId) {
    scopeCache.delete(`${orgId}:${userId}`);
    return;
  }
  for (const key of scopeCache.keys()) {
    if (key.startsWith(`${orgId}:`)) scopeCache.delete(key);
  }
}

/**
 * Drop cached scopes after a group mutation, on this replica AND all the others.
 * Invalidates locally first (synchronous, guaranteed) then fire-and-forgets a
 * Pub/Sub broadcast. A Redis hiccup must never break the write path that called
 * this, so the publish error is swallowed/logged — at worst other replicas keep
 * stale scope for up to the 60s TTL, which is the pre-broadcast behaviour.
 */
export function invalidateAccessScope(orgId: string, userId?: string): void {
  applyInvalidation(orgId, userId);

  const message: InvalidationMessage = { orgId, ...(userId ? { userId } : {}) };
  void publish(INVALIDATION_CHANNEL, 'access-scope.invalidate', message).catch((err) => {
    log.warn({ err, orgId, userId }, 'failed to broadcast access-scope invalidation');
  });
}

// Subscribe each replica to remote invalidations. The subscriber calls
// applyInvalidation (NOT invalidateAccessScope) so a received message clears the
// local cache without re-broadcasting. Guarded out of the test env — unit tests
// import this module without a Redis subscriber, matching the NODE_ENV==='test'
// gate used by the queue bootstraps.
if (process.env.NODE_ENV !== 'test') {
  subscribe(INVALIDATION_CHANNEL, (payload) => {
    const data = payload.data as InvalidationMessage | undefined;
    if (!data || typeof data.orgId !== 'string') return;
    applyInvalidation(data.orgId, data.userId);
  });
}

/**
 * Merge the visibility rule into an existing opportunity where clause.
 * Wraps in AND so route-level filters (search OR, stage, owner…) survive.
 */
export function applyOpportunityScope(
  where: Prisma.OpportunityWhereInput,
  scope: AccessScope,
): Prisma.OpportunityWhereInput {
  if (scope.unrestricted) return where;
  // Group codes are uppercase ISO-2 (CountryCode schema), but opportunity.country
  // / territory.countryCodes are stored raw — match both cases so a lowercase
  // record isn't silently hidden from a user who should see it. Prisma `in`
  // has no case-insensitive mode, so we expand the list.
  const variants = [...new Set(scope.countries.flatMap((c) => [c.toUpperCase(), c.toLowerCase()]))];
  return {
    AND: [
      where,
      {
        OR: [
          { country: { in: variants } },
          { territory: { countryCodes: { hasSome: variants } } },
          { ownerId: scope.userId },
        ],
      },
    ],
  };
}

/**
 * Cache-key discriminator for req.cache. The shared redis cache keys on
 * orgId only — without this tag a scoped user's filtered page (or an
 * unrestricted user's full page) would be served to the wrong caller.
 * Unrestricted callers keep sharing one entry (today's behavior).
 */
export function countryVariantsForScope(scope: AccessScope): string[] {
  return [...new Set(scope.countries.flatMap((c) => [c.toUpperCase(), c.toLowerCase()]))];
}

export function accountOpportunityScopePredicate(
  scope: AccessScope,
): Prisma.OpportunityWhereInput | null {
  if (scope.unrestricted) return null;
  const variants = countryVariantsForScope(scope);
  const clauses: Prisma.OpportunityWhereInput[] = [{ ownerId: scope.userId }];
  if (variants.length > 0) {
    clauses.unshift({ territory: { countryCodes: { hasSome: variants } } });
    clauses.unshift({ country: { in: variants } });
  }
  return { OR: clauses };
}

export function companyScopePredicate(scope: AccessScope): Prisma.CompanyWhereInput | null {
  if (scope.unrestricted) return null;
  const variants = countryVariantsForScope(scope);
  const opportunityPredicate = accountOpportunityScopePredicate(scope);
  const clauses: Prisma.CompanyWhereInput[] = [
    { keyAccountOwnerId: scope.userId },
    ...(opportunityPredicate
      ? [{ opportunities: { some: { deletedAt: null, ...opportunityPredicate } } }]
      : []),
  ];
  if (variants.length > 0) clauses.unshift({ countryCode: { in: variants } });
  return { OR: clauses };
}

export function applyCompanyScope(
  where: Prisma.CompanyWhereInput,
  scope: AccessScope,
): Prisma.CompanyWhereInput {
  const predicate = companyScopePredicate(scope);
  if (!predicate) return where;
  return { AND: [where, predicate] };
}

export function scopeCacheTag(scope: AccessScope): string {
  return scope.unrestricted ? 'scope-all' : `scope-${scope.userId}`;
}
