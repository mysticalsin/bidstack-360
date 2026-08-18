# BATON — BidStack 360° / Polo PreSales

**Repo:** `D:\BIDCRM` · **Branch:** `feat/crm-design-fusion` · **HEAD:** `a3f4ae10`
**Shift:** Claude (Opus 5) · 2026-08-17 · finish the Amaris Bid Office upgrade, land it on the
real pages, test it all.

---

## State NOW — Amaris Bid Office upgrade COMPLETE, full gate green, 7 commits, NOT pushed

Phases 1–3 (classification engine + panel, persisted class + `gate_decisions`, stage-gate
enforcement) were already shipped. This shift finished the remainder and hardened what shipped.

**7 commits `ae9739f6..a3f4ae10`:**

1. `ae9739f6 fix(bid)` — closed **five proven stage-gate bypasses** + class-driven gates.
2. `611c92ec feat(bid)` — governance + Stage-10 debrief land on the opportunity record.
3. `1e204e4a feat(settings)` — per-org stage-gate enforcement control (Settings → Data configuration).
4. `4c6d2c8a chore(i18n)` — 79 new keys × 7 locales (panel was English-only).
5. `a36b2488 fix(collab)` — yjs WS used a `window.__apiTokenProvider` global nothing ever set.
6. `059c6624 test` — realigned 2 suites drifted by `7a95286f` / `6b792ab9` (not this branch's work).
7. `a3f4ae10 docs(lessons)` — `lessons/2026-08-17-a-gate-that-fails-open-is-not-a-gate.md`.

### The five bypasses (all had integration regressions added)
1. **No `PipelineStage` row → no gate.** `{ stage: 's4_negotiation' }` with no matching row was
   accepted and written; an org with no default pipeline had zero enforcement.
   Fix: `canonicalStageNodes()` backs the gate from the product's stage enum.
2. **Close-then-reopen laundering.** Both moves were legal-and-not-forward, so two allowed
   requests moved a No-Go bid to the funnel end. Fix: reopening IS forward advancement.
3. **Any BidScore cleared a No-Go** ("not no_bid" ⇒ positive). Fix: whitelist the 3 real values.
4. **Mismatched gate/outcome ERASED the decision** — `{go_no_go, approved}` maps to no signal and,
   because the query reads only the latest row, HID an earlier No-Go. Fix: `GATE_OUTCOMES` + 400.
5. **Tenant guard turned the gate into a 500** — stage-node `findMany` had no `orgId`, and
   `BIDSTACK_TENANT_SCOPE_GUARD=enforce` is required in production.

Also: archived stages corrupted adjacency; unordered `take:100` was nondeterministic; the
Presales→Bid Office handoff fired spuriously (`?? -1`) and raced (now a partial unique index,
migration `20260817000000`).

---

## Gate (this shift, on HEAD)
`pnpm typecheck` all-green · lint clean on every touched file (pre-existing failures remain in
`components/login/*`, `TerritoryPanels`, `ChartContainer` — untouched) · **api 1088/1088 (157
files) · web 884/884 (182) · worker 512/512 (53) · shared 241/241 (23) · db 77/77 (8)** ·
`pnpm --filter @bidstack/web build` green.

**Live-verified** on the running stack (api :4000, web :38081, Postgres :5433) with chrome-devtools:
classification save → toast → panel rehydrates → gate options narrow to the C4 set; gate sign-off
recorded and rendered; the reopen-with-standing-No-Go bypass returns **409** on an org with no
pipeline rows (the exact double-bypass case); a positive Go then lets the same move through (200);
invalid pairing → 400, wrong-class gate → 409, both with actionable messages; Settings control
persists `enforce`; Lessons Learned card appears only on a closed bid and its debrief persists;
`gate_decision` notifications land for the committee. Zero app console errors. **Test data was
restored afterwards** (OP-H10 back to `closed_lost`, class/gates/win-loss/notifications removed,
org `stage_gate_mode` back to NULL).

---

## Local DB was drifted — fixed this shift
`bidcrm-postgres-1` had a P3009 failed-migration wall (`20260623000000_kam_foundation` unfinished)
and 3 unapplied migrations. Resolved the 4 already-physically-applied migrations
(`migrate resolve --applied`) and ran `migrate deploy`; the DB is now current including
`bid_class` / `gate_decisions` / `stage_gate_mode` / the new handoff unique index.
Prisma CLI needs the URL passed explicitly:
`DATABASE_URL="postgresql://bidstack:bidstack@localhost:5433/bidstack" ./node_modules/.bin/prisma …`
run from `packages/db`.

---

## NEXT (concrete)
1. **Push + PR** `feat/crm-design-fusion` → `demo`. Nothing is pushed.
2. **Decide the rollout mode.** `STAGE_GATE_MODE` env still defaults to `off`; the per-org control
   now exists. Suggested: set orgs to `warn`, read the `stage-gate violation (warn mode)` logs for
   a week, then `enforce`.
3. **Amaris role types are still decorative.** `GateDecision.decidedByRole` is free text and the
   committee/validator strings ("Business: D3", "Delivery: CDSO") match no `Role` row, so nothing
   checks that a signer holds the position. To make it enforceable: an `AMARIS_ROLE_CODES` enum in
   `packages/shared`, seed them in `ROLE_SEEDS` (`packages/db/src/seed.rbac.ts:143`), then validate
   with `userHasAnyRole` at decision time. Needs Tony's call on the org's real position model.
4. **Stage-9 Won-branch artifacts** (IKOM BID-TEM-401, Success Case, Sales Acceleration Toolkit)
   are still reference-only — they need a template/document-generation decision, not more code.
   No SharePoint push for Stage 10 either (no integration exists).
5. Two acronyms remain unconfirmed with the Bid Office (`STRATM`, `IKOM`; and whether "SM" is
   Senior or Sales Manager in the C2 committee) — flagged in the source report, not guessed at.

## Watchouts
- `packages/shared` is consumed from `dist/`: **run `pnpm --filter @bidstack/shared build` after
  editing it**, or the API/web typecheck reads a stale barrel (this is what hid the two drifted
  test files for two commits).
- Dev servers this shift: API on **:4000** (`PORT` env ignored — it reads `PORT_API`), web on
  **:38081** (strictPort, proxies `/api` to the API).
- chrome-devtools MCP holds `~/.cache/chrome-devtools-mcp/chrome-profile`; a stale instance from a
  previous session blocks `new_page` until that Chrome process tree is stopped.
