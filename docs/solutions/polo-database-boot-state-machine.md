# Polo database boot is an explicit state machine

## Problem

The container database boot was a row of conditionals: init the cluster,
create `app_role` and restore, tolerate one `42P06` for schema `public`,
run drill hooks, then `ready` or `failed`. A missed branch was hard to see,
and four follow-ups from #353 were still open: the notice matched any
duplicate schema, the password `psql` did not get `PGVERBOSITY=verbose`,
its argv test did not reject `-c`, and drill hooks were gated only by
`POLO_RESTORE_DRILL=1`.

## Pattern

- Name the states `Init`, `AppRoleRestore`, `TolerateDuplicateSchema`,
  `DrillHooks`, `Ready`, and `Failed`. Each event has a guard. A failed
  guard ends in `Failed` with a reason, except a drill hook that production
  must ignore, which stays in `DrillHooks`.
- `Ready` and `Failed` are terminal. A later event stays there and keeps
  the reason.
- Log every transition as `{ from, to, event, guard, reason, infrastructure }`.
- Tolerate `42P06` only for the full text `schema "public" already exists`,
  once, on exit status 1.
- The password `psql` gets `PGVERBOSITY=verbose` and `LC_ALL=C`, and its
  argv is rejected when it contains `-c` or `--command`. The statement
  stays on stdin.
- Drill hooks run only when `POLO_RESTORE_DRILL` is `1` and `NODE_ENV` is
  not `production` (any case). Production sources do not assign the flag.
- A timeout is an infrastructure failure (`infrastructure: true`), not a
  skipped test.

## Implementation

- `apps/polo-preview/src/database-boot.js` owns the machine and the guards.
- `apps/polo-preview/container/entrypoint.mjs` sends the events from the
  database boot and from the password and gate `psql` spawns. It does not
  change `POLO_DATA_MODE`.

## Verification

```
pnpm --filter @bidstack/polo-preview exec vitest run src/database-boot.test.ts src/database-boot-transitions.test.ts src/database-boot-guards.test.ts src/database-boot-followups.test.ts
```

The restore drill is unchanged and still requires `POLO_RESTORE_DRILL=1`
plus Postgres 16, pgvector, and redis-server. It does not run under
`pnpm test`.
