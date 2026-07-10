# RBAC Decision Cache Invalidation

BidStack permission gates are DB-authoritative: Clerk/admin claims identify the
caller, but `UserRole -> Role -> RolePermission` authorizes access. Repeating
that indexed lookup on every guarded route is expensive at scale, but caching it
is only safe when every authorization mutation invalidates the cached decision.

Pattern used in `apps/api/src/lib/rbac-decision-cache.ts`:

- cache only human `requireRole` / `requirePermission` decisions;
- keep REST API-key scope checks uncached, because they are already local and
  carried by the resolved auth context;
- key by `orgId`, `userId`, and role/permission discriminator;
- keep a short TTL so a missed cross-replica invalidation is bounded;
- invalidate one user after `UserRole` assignment/revoke or JIT admin grant;
- invalidate the whole org after `Role` or `RolePermission` changes;
- publish invalidations over Redis Pub/Sub outside tests so other API replicas
  drop stale entries too;
- never let Redis publish failure break the write path: local invalidation is
  synchronous, remote replicas fall back to the TTL.

Regression tests must prove both directions:

- a repeated allowed decision uses the cache and avoids a second DB read;
- a cached denial is cleared after user-level invalidation;
- a cached grant is cleared after org-level invalidation.

Test harness rule: when a test replaces the RBAC count/read mock for the same
org/user/permission tuple, clear the decision cache before making the next
request. Otherwise the test may assert the cached result from the previous
matrix row instead of the permissions under test.
