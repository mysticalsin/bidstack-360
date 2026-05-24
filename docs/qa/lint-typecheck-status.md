# BidStack 360° — Lint / Typecheck Status Per Branch
**Date:** 2026-05-24
**Method:** Static analysis only — `node_modules` absent in QA worktree; no live toolchain run possible.
**Note:** All "can-typecheck" and "errors/warnings" columns marked `[STATIC ONLY]` — must be verified with `pnpm typecheck` after `pnpm install` in the main repo.

---

## Status Table

| Branch | Last Commit SHA | Can Install | Can Typecheck | Known Compile Blockers | Est. Error Severity |
|---|---|---|---|---|---|
| running\_best (base) | f7fd2723 | YES (main repo) | YES (per PROGRESS.md: 8/8 packages pass) | None | CLEAN |
| feat/wave3-calendar-twoway-booking | 841f76a1 | NO (worktree) | [STATIC ONLY] | None detected statically | LOW |
| feat/wave3-migration-connectors | ffff29ab | NO (worktree) | [STATIC ONLY] | None detected statically | LOW |
| feat/wave3-mobile-pwa-offline | 71044238 | NO (worktree) | [STATIC ONLY] | None detected statically | LOW |
| feat/wave3-notification-engine | 4306d4e8 | NO (worktree) | [STATIC ONLY] | None detected statically | LOW |
| feat/wave3-workflow-builder-ui | 23082905 | NO (worktree) | [STATIC ONLY] | None detected statically | LOW |
| feat/wave4-ai-assistant | f9b5f326 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep in bid-scores.ts + proposals.ts | **HIGH — compile error** |
| feat/wave4-analytics-dashboards | ba791590 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 21 as-any/ts-ignore hits | **HIGH — compile error + 21 suppressions** |
| feat/wave4-design-system | 97ec6b39 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep | **HIGH — compile error** |
| feat/wave4-esignature | 72ee1620 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep | **HIGH — compile error** |
| feat/wave4-pwa-completion | 66668ed9 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 8 TODO entries | **HIGH — compile error** |
| feat/wave4-rbac-encryption-onboarding | f9b5f326 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep | **HIGH — compile error** |
| feat/wave4-timeline-custom-fields | 25a1b6e7 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep | **HIGH — compile error** |
| feat/wave5-ai-frontend | 28fadf4f | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 18 as-any/ts-ignore hits | **HIGH — compile error + 18 suppressions** |
| feat/wave5-analytics-frontend | 0bfedb96 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 33 as-any/ts-ignore hits | **HIGH — compile error + 33 suppressions** |
| feat/wave5-azure-sso | a11f6630 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 18 as-any/ts-ignore hits | **HIGH — compile error + 18 suppressions** |
| feat/wave5-custom-fields | 8a200726 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 19 as-any/ts-ignore hits | **HIGH — compile error + 19 suppressions** |
| feat/wave5-esignature-frontend | c608ac76 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 19 as-any/ts-ignore hits; missing SignatureRequest model | **HIGH — multiple compile errors** |
| feat/wave5-final-polish | 6f366510 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 18 as-any/ts-ignore hits | **HIGH — compile error + 18 suppressions** |
| feat/wave5-gmail-integration | 2d04f9db | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 21 as-any/ts-ignore hits | **HIGH — compile error + 21 suppressions** |
| feat/wave5-onboarding-complete | 5e6ddab8 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 33 as-any/ts-ignore hits | **HIGH — compile error + 33 suppressions** |
| feat/wave5-outlook-integration | e8dc4ac6 | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 21 as-any/ts-ignore hits | **HIGH — compile error + 21 suppressions** |
| feat/wave5-slack-zapier | ad05e8af | NO (worktree) | [STATIC ONLY] | `@bidstack/memos` phantom dep; 28 as-any/ts-ignore hits | **HIGH — compile error + 28 suppressions** |

---

## Single Systemic Fix

**Every Wave 4/5 branch will fail typecheck on the same root cause:**

```
apps/api/src/routes/bid-scores.ts:4:
  import { MemOSService } from '@bidstack/memos';
  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  Cannot find module '@bidstack/memos' or its corresponding type declarations.
```

and:
```
apps/api/src/routes/proposals.ts:3:
  import { MemOSService } from '@bidstack/memos';
```

**Fix (one commit, resolves all branches):**

Option A — Remove dependency:
Replace `MemOSService` calls in `bid-scores.ts` and `proposals.ts` with direct Prisma calls to `MemosTrace`/`MemosPolicy` (which ARE in the schema).

Option B — Create stub package:
```
packages/memos/package.json   → { "name": "@bidstack/memos", "main": "src/index.ts" }
packages/memos/src/index.ts   → export class MemOSService { ... }
```

Option A is preferred per Rule 2 (simplicity) — no new package needed.

---

## Post-Install Verification Steps

After `pnpm install` + `pnpm db:generate` in main repo:

```bash
# Per-package typecheck
pnpm --filter @bidstack/api typecheck
pnpm --filter @bidstack/web typecheck
pnpm --filter @bidstack/worker typecheck
pnpm --filter @bidstack/shared typecheck

# Lint
pnpm lint

# Unit tests
pnpm test
```

Target: 0 typecheck errors, 0 ESLint errors before any merge PR opens.
