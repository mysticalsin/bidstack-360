# Code-review remediation patterns (prod-hardening wave)

Reusable fixes from remediating a multi-lane review of the saved-views route,
the bid-deadline / scheduled-reports workers, and the cockpit TechStackCard.
Search this before re-solving any of the classes below.

## 1. Periodic-alert dedupe: nearest bucket + real-days copy

**Problem:** a "fire at 7/3/1 days before due" scan that returns *every* crossed
threshold creates multiple notifications at once for an opp first seen already
inside a tight window (e.g. due tomorrow → 7d + 3d + 1d alerts), and copy that
interpolates the *bucket* number ("in 7 days") is factually wrong.

**Fix:**
- Keep the per-(entity, threshold) deterministic dedupe key (the idempotency
  guard), but alert on the **nearest** crossed bucket only
  (`thresholdsFor(d).at(-1)`). Because days-until only decreases, a later scan
  crossing into a tighter bucket fires that bucket via its own key → the intended
  7→3→1 cadence, one alert per boundary.
- Drive the copy from the **real** days remaining, not the bucket
  (`dueInLabel(daysUntil)`; collapse ≤0 to "today").
- Keep the threshold maths as pure, unit-tested helpers (no DB/Redis).

Files: `apps/worker/src/queues/bid-deadline-alerts.{ts,helpers.ts,helpers.test.ts}`.

## 2. WCAG AA contrast on tinted backgrounds — `--token-strong` with fallback

**Problem:** a semantic color (`--info` #6e59ff) passes AA on white but fails on
a brand-tinted pill background (~4.1:1 < 4.5:1). Darkening the global token risks
its other uses; leaving it fails AA.

**Fix:** add a darker sibling token (`--info-strong`) in the light `:root` only,
and reference it as `var(--info-strong, var(--info))`. Dark mode (where the bright
value already has high contrast on dark surfaces) falls back to `--info`
untouched — no dark-theme override needed. Comment the measured ratios inline,
matching the file's existing per-token contrast notes.

Files: `apps/web/src/index.css`, `apps/web/src/styles/cockpit.css`.

## 3. Per-user routes must reject API-key callers

**Problem:** global `onRequest` auth makes every route reachable by API keys
(`req.auth.role === 'api'`, synthetic `userId = 'apikey:<id>'`). For per-user
routes that write `userId` into a `@db.Uuid` FK column, an api-role caller 500s
(the synthetic id is not a UUID), and uuid-column read filters throw too.

**Fix:** a plugin-level `server.addHook('preHandler', …)` that throws
`forbidden` when `req.auth.role === 'api'`, so the whole router returns a clean
403 instead of a 500. Mirrors `apps/api/src/plugins/rbac.ts` and
`routes/kam-drafts.ts`. Use a single hook over per-handler guards when *all*
routes in the plugin are human-only.

Files: `apps/api/src/routes/saved-views.ts`.

## 4. Bound open `z.record` filter payloads

**Problem:** an "intentionally open" `z.record(union(primitive | primitive[]))`
with no caps is an authenticated storage-amplification vector when the value is
persisted verbatim (and doubled into an audit-log diff), while every sibling
field (name/sort/columns) is bounded.

**Fix:** cap string values (`.max(2000)`), inner arrays (`.array(...).max(200)`),
and key count (`.refine(v => Object.keys(v).length <= 50)`). `.refine` returns a
`ZodEffects` that still supports `.default({})` / `.partial()` / `.safeParse`, so
downstream create/patch/response schemas are unaffected. Unit-test the bounds.

Files: `packages/shared/src/schemas/saved-view.{ts,test.ts}`.

## 5. Worker run rows: status is the marker, not `error`

A scheduled-run placeholder must not stash an informational note in the `error`
column — a non-null `error` reads as a failed run in the runs UI. Use `status`
('pending') as the lifecycle marker and put metadata in `result` (Json).

Files: `apps/worker/src/queues/scheduled-reports.ts`.

## Verification discipline (monorepo + in-flight multi-agent WIP)

- A search that exits **2** is an *error*, not "no matches" — never conclude
  "zero references" from empty output unless it exited 0/1. Prefer the Grep tool
  or scope shell `rg` to `apps packages` (raw `rg .` aborts on `.claude/worktrees`
  symlinks). See MISTAKES.md 2026-06-26.
- Verify per-package (`pnpm --filter @bidstack/<pkg> typecheck|exec vitest run|exec
  eslint`) to isolate your changes from unrelated in-flight wave state.
- A stale generated Prisma client surfaces as `Property '<model>' does not exist
  on PrismaClient` in *untouched* files (Windows `db:generate` EPERM). Confirm the
  model is in `schema.prisma` and the file is unmodified before treating it as a
  real error → hand off `pnpm db:generate`.
