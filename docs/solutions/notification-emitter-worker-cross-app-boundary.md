# Notification Emitters — Worker Cross-App Boundary + Dedupe-by-URL Pattern

## Problem

Wiring new **worker-side** notification emitters (task-due, KAM-staleness)
surfaced two reusable traps below. Note: `stage-change` is NOT a worker
emitter — it is an API-side hook (`apps/api/src/routes/opportunities.ts`
PATCH + `opportunities.transitions.ts` POST `/stage`), calling
`createNotification` directly, same-package. It never crosses the apps/worker
↔ apps/api boundary described in Trap 1 below, so it is unaffected by either
trap; it is listed in "New NotificationType requires 3 non-obvious follow-up
edits" only because `stage_change` is one of the pref-gated types that map
touches.

## Trap 1: apps/worker cannot import apps/api services

`createNotification` (the pref-gating seam) lives in `apps/api/src/services/
notification.service.ts`. apps/worker and apps/api are separate packages —
no shared module boundary between them. A worker file importing
`'../services/notification.service.js'` will not resolve.

**Established precedent (already in repo, easy to miss):**
`apps/worker/src/queues/bid-deadline-alerts.ts` already solves this — it writes
`prisma.notification.create` directly and does NOT go through
`createNotification`. Any new worker-side emitter must do the same, and must
re-implement whatever pref-gating it needs inline (see `notificationPref.findUnique`
check in `task-kam-alerts.ts`, mirroring `createNotification`'s own semantics: no
pref row = deliver by default, only an explicit `false` suppresses).

## Trap 2: two notifiers for one deadline = alert fatigue

The task brief asked for a new "opportunity/bid deadline-approaching" emitter.
`bid-deadline-alerts.ts` already does this (7/3/1-day cadence, tested, shipped).
Building a *second, separate* notifier with a different window (e.g. 48h)
would fire two different notifications for the same underlying deadline. Per
Rule 7 (surface conflicts, don't average them): picked the existing,
more-tested implementation and extended it in place rather than duplicating.

**Gap this almost hid:** the existing 7/3/1 cadence only fires while
`daysUntil >= 0` (`thresholdsFor` returns `[]` once overdue) — an opportunity
that actually MISSES its deadline got zero alert, before or after the initial
build. Fixed by adding a once-ever "overdue" bucket to the SAME worker
(`OVERDUE_DEDUPE_THRESHOLD`, a dedupe key distinct from 7/3/1 so it can never
collide with or suppress an on-time alert) rather than a second cron — no
double-notify risk, since the two cases are mutually exclusive by
`daysUntil`'s sign. New cron (`task-kam-alerts.ts`) still covers only what was
genuinely orthogonal: task due/overdue + KAM initiative staleness.

## Dedupe-by-URL, per-day (not once-ever)

`bid-deadline-alerts.ts`'s dedupe key is per `(entity, threshold)` — fires
**once ever** per boundary. Ongoing nudges (a task still overdue tomorrow, an
account still stale next week) need to re-fire on a NEW day but never twice on
the SAME day (the scan is hourly). Dedupe key = `(entity, UTC-day)`:
`findFirst({orgId, userId, url})` before insert, url carries the day component
(`utcDayKey`).

**Correction (was overstated):** "the repeatable runs at concurrency 1, so
there's no race" is only true *within one worker process*. apps/worker runs
2-6 replicas in production (`infra/azure/main.bicep` `workerApp.scale`) — the
same topology `bid-deadline-alerts.ts` was hardened against with a real
partial unique index (`notifications_deadline_dedupe_uq`) + `P2002` catch.
`task-kam-alerts.ts` does NOT have that DB-level backstop (existence-check
only) — a narrow gap accepted for now (see the WHY comment in that file)
rather than adding a migration on this Windows dev host mid-fix. Don't repeat
this file's original "no race" phrasing without that caveat.

## New NotificationType requires 3 non-obvious follow-up edits

Adding `task_due` to `packages/shared/src/schemas/notification.ts`'s Zod enum
(safe — `Notification.type` is a plain DB string column, no migration) still
requires touching:

1. `apps/api/src/services/notification.service.ts` — `GATED_BY_PREF` map, if
   the new type should be gateable by a pref.
2. `apps/web/src/hooks/useNotifications.ts` — its `NotificationType` is a
   **locally re-declared literal union**, not imported from `@bidstack/shared`.
3. `apps/web/src/components/layout/topbar/TopbarNotifications.tsx` —
   `TYPE_ICON: Record<NotificationType, IconName>` is exhaustive; TS errors if
   a new type is added without an icon entry (this is a feature — it forces the
   icon decision, don't bypass with `Partial`).

## Gotcha: `@bidstack/shared` consumers read the built `dist/`, not source

`apps/api`/`apps/web` typecheck against `packages/shared`'s compiled output.
After editing `packages/shared/src/schemas/*.ts`, run
`pnpm --filter @bidstack/shared build` before typechecking dependents, or you
get a stale "property does not exist" error that looks like a real type bug.
