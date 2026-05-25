# BidStack 360 CRM Audit - 2026-05-24

## Scope

This audit covers the running local CRM at `http://localhost:5173/dashboard`, the dashboard shell background fix, and the current release-gate health observed from the workspace.

It does not certify production readiness. The repo has broad pre-existing worktree changes, untracked generated artifacts, and failing root gates outside the dashboard background change.

## Executive Score

| Area | Score | Status |
| --- | ---: | --- |
| Local dashboard usability | 88/100 | Pass with minor UX debt |
| Web app build and type health | 92/100 | Pass |
| Web app test health | 90/100 | Pass |
| Whole-repo release health | 64/100 | Blocked |
| Production security readiness | 58/100 | Blocked |
| Enterprise CRM product depth | 72/100 | In progress |

Overall current production readiness: **64/100 - BLOCK**.

The dashboard is running and visually cleaner after removing the purple animated shell background. The broader platform is not release-ready until root lint/typecheck/test failures are resolved and production auth/storage/MCP/RFP gates are re-certified.

## Implemented UX Fix

The purple animated CRM shell background was removed from code:

- Removed the `FlowFieldBackground` and `AmbientOrbs` shell rendering from `AppShell`.
- Removed the visual-effects preference from the preference store so the background cannot be toggled back on.
- Removed the visual-effects card from the Appearance settings page.
- Removed dead CSS for `app-flow-field`, `orb-drift-*`, `dashboard-ambient`, and `ambient-orb`.
- Deleted the unused local background component files when present in the worktree.

Browser verification:

- URL: `http://localhost:5173/dashboard`
- H1s found: `Dashboard`, `Workspace Command Center`
- `.app-flow-field` count: `0`
- `.has-flow-field` present: `false`
- `.dashboard-ambient` / `.ambient-orb` count: `0`
- Dashboard error text: `false`
- Browser console errors: `0`

## Gate Evidence

Passing:

- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web test`
- `pnpm --filter @bidstack/web test -- src/stores/preferences.test.ts`
- `pnpm audit --audit-level high`
- API health: `{"ok":true,"db":true,"redis":true}`

Failing or inconclusive:

- `pnpm lint` fails in API:
  - `apps/api/src/services/crm/dashboard.service.ts:1182` unsafe `.confidence` access on `any`.
  - `apps/api/src/services/crm/notes.service.ts:484` unsafe `.confidence` access on `any`.
- `pnpm typecheck` fails in `packages/memos`:
  - `src/index.test.ts:12` uses `typeof MemOSService` where a callable type is expected.
  - `src/index.ts` writes `Record<string, unknown>` into Prisma JSON fields without `InputJsonValue` compatible typing.
- `pnpm test` first failed on a web preference timeout under full parallel load. The web suite now passes after the test timeout was made realistic. A root rerun later hit the command timeout and pnpm `EPIPE`, so root test is **not certified green**.

## Deep Findings

### UX/UI

Score: **88/100 local dashboard**, **76/100 cross-product consistency**.

Strengths:

- Dashboard information hierarchy is strong: portfolio context, KPI strip, priority signals, and command-center framing are easy to parse.
- Removing the full-page animated purple layer makes the CRM feel calmer, more enterprise, and closer to Apple/Salesforce executive software.
- Dark mode is usable and the shell no longer competes with business data.

Problems:

- Purple remains a dominant accent in buttons, glow states, and some glass treatments. That is acceptable as brand accent, but it still risks feeling flashy rather than premium.
- Motion settings still control global motion, not specific expensive effects. The removed background should stay removed; future animations need component-level budgets.
- Some dashboard cards still use shine/shimmer/pulse-style treatments that may distract from dense CRM work.
- Settings and shell IA are improving, but enterprise admins will expect clearer grouping for auth, integrations, agents, data, security, and billing.

Fix plan:

1. Define an "enterprise calm" motion policy: no animated page backgrounds, no continuous decorative loops, reduced hover-only motion.
2. Keep purple as a restrained accent only: focus rings, selected nav, one primary CTA tier.
3. Add visual regression snapshots for dashboard light/dark and reduced-motion mode.
4. Audit every CRM section for text overflow, touch target size, keyboard focus, loading, empty, error, success, and disabled states.

### Frontend Engineering

Score: **92/100 for web build health**, **78/100 for architecture maturity**.

Strengths:

- Web lint, typecheck, build, and tests pass.
- The shell fix simplified `AppShell` instead of adding another preference branch.
- Preferences are now scoped to durable density and motion settings only.

Problems:

- Some web files touched in this session are untracked in the current worktree, which weakens reviewability.
- The root repo has broad dirty state and generated artifacts mixed with source changes.
- The app still ships a large `motion` bundle chunk; animation usage should be lazy and justified.
- React Router future-flag warnings need a planned upgrade path before v7.

Fix plan:

1. Split the dirty worktree into reviewable source, docs, generated artifacts, and local tool files.
2. Add a no-page-background-animation lint or design-system rule.
3. Track bundle budget for `motion` and dashboard route chunks.
4. Resolve React Router future flags and add upgrade tests.

### Backend/API

Score: **62/100 current gate health**.

Strengths:

- Local API health reports DB and Redis ready.
- Existing modules show active work across CRM, RFP, MCP, integrations, and worker queues.

Problems:

- Root lint is blocked by unsafe `any` access in CRM confidence fields.
- Root typecheck is blocked by MemOS Prisma JSON typing.
- Whole-repo tests are not certified after the timeout/EPIPE.
- Some production-hardening areas from prior plans remain unverified: tenant ownership, RLS, MCP scopes, idempotency, webhook SSRF, and storage finalization.

Fix plan:

1. Type the confidence payloads in dashboard and notes services with a shared schema.
2. Add Prisma JSON helpers for MemOS payload metadata and context fields.
3. Re-run root lint, typecheck, test, build after those fixes.
4. Re-run cross-tenant negative tests for every mutation accepting related IDs.

### Security

Score: **58/100 production readiness**.

Strengths:

- High-severity dependency audit gate is clean.
- MCP and auth tests exist and some pass in the workspace.

Problems:

- Production readiness cannot be claimed while root gates fail.
- Local web build verification uses explicit stub auth flags; that is fine locally but must fail closed in production.
- Tenant security, RLS, storage finalization, and MCP write-scope enforcement need full regression evidence before release.
- The dirty worktree includes many generated screenshots and local files, increasing secret-review and supply-chain noise.

Fix plan:

1. Enforce production build failure without real Clerk config and durable storage.
2. Add tenant-ownership helper usage tests across all mutation routes.
3. Add MCP read/write scope tests for every tool.
4. Run secret scanning before any PR.

### QA and Reliability

Score: **70/100 current release confidence**.

Strengths:

- Real browser verification passed for the dashboard.
- Web test suite passes after the preference regression timeout fix.
- API health is green.

Problems:

- Root test command timed out with pnpm `EPIPE`; the whole workspace is not proven green.
- E2E was not re-certified in this pass.
- Worker tests emit Redis connection-close stderr even when passing, which can mask real queue defects.

Fix plan:

1. Stabilize root test orchestration so it cannot hang silently.
2. Add focused E2E for dashboard load, settings appearance, command palette, and reduced-motion mode.
3. Treat noisy worker stderr as a test hygiene issue.
4. Add browser visual regression for the exact background-removal contract.

## Priority Remediation Plan

Critical:

1. Fix root lint API `any` confidence errors.
2. Fix MemOS package typecheck errors.
3. Stabilize root `pnpm test` and prove it passes without timeout.
4. Re-run full release gates from a clean checkout.

High:

1. Add visual regression snapshots for dashboard shell with no animated background.
2. Add production auth/storage fail-closed tests.
3. Complete tenant ownership and MCP authorization negative tests.
4. Reduce continuous decorative motion across dashboard cards.

Medium:

1. Clean React Router future warnings.
2. Add bundle budgets for route chunks and `motion`.
3. Separate generated artifacts from source changes.
4. Improve settings IA for enterprise admin tasks.

## Definition of Done For This Fix

- Dashboard renders at `http://localhost:5173/dashboard`.
- No purple animated page background is mounted in the DOM.
- No user preference can re-enable the removed background.
- Web lint, typecheck, build, and tests pass.
- Browser console has no errors on dashboard load.

Status: **Done for local web dashboard fix. Not done for whole-product production release.**
