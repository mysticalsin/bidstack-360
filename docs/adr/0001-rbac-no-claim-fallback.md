# ADR 0001 — RBAC has no claim-based fallback; UserRole grants are the only source of truth

- **Status:** Accepted
- **Date:** 2026-05-24
- **Deciders:** Tony Walteur (CTO), Security Engineer (Phase 3 security audit)
- **Related:** `docs/audits/2026-05-24-twenty-agent-deep-audit.md` (HIGH-3), `apps/api/src/plugins/rbac.ts`, `apps/api/src/plugins/auth.ts`

## Context

The original `requirePermission` decorator in `apps/api/src/plugins/rbac.ts` did
two lookups in order:

1. Count `UserRole` rows where the user is assigned to a `Role` whose
   `RolePermission` covers the requested permission key.
2. If that returned zero, allow the request anyway when
   `req.auth.role === 'admin'` (a value derived from the Clerk
   `org_role: org:admin` claim).

Step 2 was intended as a transitional fallback while the seeded `Admin` ->
`Permission` rows were being backfilled. In practice it created a hard security
hole:

- Any tenant whose `UserRole` rows were not seeded (every fresh Clerk org, every
  tenant created outside `pnpm db:seed`, every tenant whose seed had drifted)
  effectively had `requirePermission` operating as `requireAdmin` for admins.
- An attacker who managed to promote a user to `org:admin` in Clerk (social
  engineering on the org owner, OAuth scope abuse, leaked Clerk dashboard
  session) immediately bypassed every granular permission gate — including
  `settings:write`, `users:write`, `integrations:write`, and
  `audit-log:read`.
- The 2026-05-24 deep audit rated this HIGH-3 against the security scorecard.

The architectural mistake was treating an identity claim as authorisation.
Modern RBAC (Salesforce, AWS IAM, Google Cloud IAM, Auth0) keeps these layers
strictly separate: the token says _who_ the caller is; the database says
_what_ the caller may do. Falling back from one to the other collapses the
separation and turns every permission check into a no-op for the privileged
class.

## Decision

We remove the claim-based fallback entirely. `requirePermission` now consults
exactly one source of truth — the `UserRole` x `RolePermission` graph scoped
by `orgId`. There is no escape hatch for any role name, including `admin`.

To keep this safe in practice, the auth plugin's JIT provisioner now
guarantees the invariant that any user whose Clerk role maps to `admin` also
holds an explicit `Admin` `UserRole` grant in the database:

```ts
// apps/api/src/plugins/auth.ts (excerpt)
if (clerkRole === 'admin') {
  await ensureAdminRoleGrant(user.id, org.id, req);
}
```

`ensureAdminRoleGrant` is idempotent (`upsert` on the composite PK
`(userId, roleId)`) and silently no-ops when the org has no seeded `Admin`
role — in that case the operator has to run `pnpm db:seed` before admins can
use permission-gated endpoints. We deliberately do NOT auto-create the `Role`
row itself, because a `Role` without its `RolePermission` mappings would be a
silent privilege gap. The full role+permission set is seeded centrally in
`packages/db/src/seed.ts`.

## Consequences

### Positive

- One source of truth. Every permission check goes through the same database
  graph, which is the only place audit logs, role-management routes, and the
  UI can edit.
- Tenant isolation is restored. The `where: { user: { orgId } }` clause on the
  count query continues to enforce that a UserRole in tenant A cannot satisfy
  a permission check in tenant B.
- Permission gates can be relied on in code review. A reviewer no longer needs
  to mentally trace whether the caller might be `admin` and therefore exempt.

### Negative / Migration risk

- Any tenant whose `UserRole` rows are stale (no `Admin` grant for the
  Clerk-admin user) will 403 on permission-gated routes until the next
  sign-in triggers the JIT grant, or until an operator manually inserts the
  row.
- Mitigation: on the first deploy carrying this change, run
  `pnpm db:seed` against every active tenant. The seed is idempotent.
- Mitigation: the JIT grant runs on every sign-in, so most users self-heal as
  soon as they next authenticate.

### Test coverage

`apps/api/src/plugins/rbac.test.ts` now contains two paired regression tests:

- `rejects an admin claim without an explicit Admin UserRole grant` — locks
  in the removal of the fallback.
- `allows an admin claim that ALSO has an Admin UserRole grant` — proves the
  legitimate post-JIT path still works.

If either test ever needs to be loosened, that change requires a follow-up
ADR.

## Alternatives considered

1. **Keep the fallback behind a feature flag.** Rejected — a feature flag for
   "bypass authorisation if you have the admin claim" is the same vulnerability
   with extra steps.
2. **Auto-create the Admin role row server-side on JIT.** Rejected — a role
   without its permission mappings is a silent privilege gap, and the
   permission catalogue is rev'd centrally in `seed.ts`. We'd rather 403 and
   alert the operator than auto-grant a half-built role.
3. **Run the fallback only when no rows exist for the org.** Rejected —
   collapsing "this org has been freshly provisioned" into "this caller can
   bypass authorisation" repeats the same category error.

## Follow-ups

- A future ADR should cover the `Role.isSystem` invariant — system roles must
  not be deletable by tenants, only by seed migration.
- The `apikey.used` audit log sampling (1%, see
  `apps/mcp-server/src/auth.ts`) should be reviewed when alert volume is
  established.
