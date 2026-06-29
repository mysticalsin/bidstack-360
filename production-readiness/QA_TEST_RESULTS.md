# BidStack 360 - QA Test Results (Gate 9)

**Date:** 2026-06-28 - **Branch:** feat/prod-hardening-mantu - **Env:** local Dockerized Postgres 16 + Redis 7.

## Static Gates

| Gate                        | Command                                   | Result                            | Evidence           |
| --------------------------- | ----------------------------------------- | --------------------------------- | ------------------ |
| Typecheck (all packages)    | `pnpm typecheck`                          | PASS                              | `typecheck.log`    |
| Production build (all apps) | `pnpm build`                              | PASS                              | `build.log`        |
| MCP server unit             | `pnpm --filter @bidstack/mcp-server test` | PASS                              | `unit-nondb.log`   |
| Shared unit                 | `pnpm --filter @bidstack/shared test`     | PASS                              | `unit-nondb.log`   |
| SAST (semgrep, OWASP/JS/TS) | `pnpm security:scan`                      | PASS, 0 findings / 1568 files     | `semgrep-sast.log` |
| SCA (dependencies)          | `pnpm audit`                              | PASS, 0 high/critical, 1 moderate | operator log       |

## API Integration Suite

| Run                     | Result                      | Notes                                                                                                                                                             |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| early local runs        | mixed                       | pre-isolation/probe-contended runs were polluted by concurrent `pg_dump`, source edits, and `tsc`; failures were readiness-probe timeouts, not assertion failures |
| latest full local proof | PASS, 119 files / 811 tests | `pnpm --filter @bidstack/api test` passed after the route-test isolation tail with `D:\BIDCRM\walteur-kit\bin` prepended to `PATH`                                |
| API-key scope proof     | PASS, 3 files / 24 tests    | exact API-key scope, RBAC, and Dust integration setup-guide tests pass after the scope hardening slice                                                            |
| AI compute auth proof   | PASS, 2 files / 18 tests    | RBAC human-session decorator plus AI assistant/call re-analysis API-key denial tests pass                                                                         |
| Public-flow browser E2E | PASS, 2 files / 8 tests     | public booking and e-signature flows now hard-fail on missing fixtures/UI; Chromium proof is `evidence/2026-06-29/e2e-public-flows-hardening-gates.log`           |

## Flakiness Analysis

- Earlier failures observed on 2026-06-28 were environmental contention artifacts: concurrent `pg_dump`, source edits, or `tsc` caused readiness-probe timeouts around `SELECT 1`.
- The prior intrinsic flake (`llm-judge` global `fetch` leak) was fixed in `f08a9ed1`.
- Route-test shared-org pollution has been cleaned in the current tree: the isolation-tail proof found no `org_seed_mantu`, `seed org`, `DB/seed`, or `it.skipIf(!dbReachable)` references under `apps/api/src/routes/*.test.ts`.

## Recommended Durable Fix

Run the full API suite repeatedly in CI on isolated infrastructure, for example 10x green, and preserve logs. If CI still flakes, treat each failure as a new shared-state or readiness-probe bug and fix the named file.

## Gate 9 Status: PARTIAL

The latest full local API suite passes after route-test isolation, and the targeted public booking/e-signature browser gate passes 8/8 on Chromium. A clean 10x consecutive CI run on isolated infra and broader lifecycle/browser coverage have not been demonstrated. Gate 9 remains PARTIAL until CI repeat proof exists.
