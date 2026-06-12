# PLAN — BidStack 360 full-review fix program (WALTEUR v8.5 brownfield)

Source of truth for findings: `walteur-kit/audit-findings.json` (54 confirmed, 19 minors, 2 refuted).
Chief self-signed (autopilot; Tony away). Assumptions: scope = fix confirmed defects + reconnect orphaned features; NO new feature builds (email integration, merge UI = report-only); stack frozen as-is.
Re-verify any finding with verdict.confidence=low in code before editing (verifier died on spend limit).

Status legend: [ ] open · [x] done+verified · [~] in progress · [R] report-only · [D] deferred

## Wave 0 — baseline (DONE, committed 2026-06-10)
- [x] Typecheck green (companies.ts dead skipGenericAudit config), lint green, pre-commit repaired (lint-staged config added).

## Wave 1 — CRITICALS (DONE, committed)
- [x] C1 Import queue consumer built — apps/worker/src/queues/migration.ts (CSV from Redis + HubSpot v3 pagination; honest FAILED states; per-chunk undo audit trail). KNOWN GAP: no HubSpot token refresh (fails loud); no UI exists for migrations at all (benchmark gap).
- [x] C2 usePatchOpportunity onMutate crash on count query — guarded non-page cache entries.
- [x] C3 Money micros CAD default → EUR (useFormatMoney, useDisplayMoney ×2, MonthlySalesChart).
- [x] C4 Quick-add opportunity/task dead → controlled-open dialogs wired.
- [R] C5 Analytics report-builder + dashboards: /api/reports AND /api/dashboards do not exist server-side — whole cluster is frontend-only. Backend = new feature (2+ Prisma models, query engine, migrations + env handoff). Reported, not built. Cluster kept out of nav.
- [R] C6 CI workflows target non-existent 'main' branch — no PR/push ever gates. CLAUDE.md forbids workflow edits without coordination. Proposed fix in final report.
- [x] C7 MCP Redis reconnect-on-demand helper + /health now probes redis honestly.

## Wave 2 — MAJORS (DONE, committed)
- [x] M1 8 provider webhook routes config.public (Twilio SMS ×2, Graph ×2, Zoom, Teams, Twilio-voice ×2).
- [x] M2 Booking cancel URL fixed + test asserts real route.
- [x] M3 Booking TOCTOU — pg_advisory_xact_lock + in-tx overlap recheck.
- [x] M4 Lead-convert micros cap 1e12→9e15.
- [x] M5 Convert stage persisted (schema+route+dialog) + empty-name 400 fixed.
- [x] M6 ['report:pipeline'] invalidation key unified (3 hooks).
- [x] M7 Tier PATCH preserves keyAccount fields.
- [x] M8 Bid-score threshold 1e10→1e13 micros.
- [x] M9 Calls keyset pagination (scheduledAt,id) cursor.
- [x] M10 Calendar overlap predicate.
- [x] M11 Multi-word @mention resolution (longest-prefix vs org users).
- [x] M12 track.ts open redirect closed (token must resolve; verified REAL — redirect fired with junk tokens; refuting verdict was wrong).
- [x] M13 Migration undo removes contacts/opportunities via audit trail.
- [x] M14 Opportunity code mint via mintNextCode + bounded retry in lead convert.

## Wave 3 — NAV + UX states
- [ ] N1 Orphaned features reachable: /calendar, /calls, custom objects, /reports/list, /quick-start, /admin/predictive. EXCLUDED: /analytics + /dashboards (dead backend, see C5).
- [ ] N2 Silent failures get error UI: CalendarPage create (268), BidNoBidPage save+calibrate (53), AgentsPage create/update (130).
- [ ] N3 LeadDetailPage debounced-server-cache inputs wipe typing — LeadDetailPage.tsx:328. Accept: local draft state.
- [ ] N4 Pipeline KPIs computed on first 50 rows — PipelinePage.tsx:34. Accept: KPIs from full aggregate.
- [ ] N5 RfpPipelinePage shows upload zone during resume load — RfpPipelinePage.tsx:140. Accept: skeleton until resolved.
- [ ] N6 NewProductDialog no focus trap/Escape — ProductsPage.tsx:257. Accept: Radix Dialog.
- [ ] N7 Calendar week grid mouse-only — CalendarPage.tsx:230. Accept: keyboard + SR access.

## Wave 4 — PERF
- [ ] P1 /search sequential queries — search.ts:81 → parallelize.
- [ ] P2 /api/opportunities pulls intel JSONB never returned — opportunities.ts:57 → drop from select (verify serializer first).
- [ ] P3 Command palette searches every keystroke — usePaletteItems.tsx:61 → debounce.
- [D] P4 Duplicate framer-motion (motion@12.40 in login Hero.tsx) — DEFERRED: Tony's uncommitted edits in that file.
- [ ] P5 queryCache persistence unbounded growth — queryCache.ts:44. Accept: bounded + debounced writes.
- [ ] P6 Tiptap+Y.js statically in detail chunks — OpportunityDetailPage.tsx:18 → React.lazy.

## Wave 5 — VERIFY + SHIP
- [ ] V1 pnpm typecheck green (api+web+worker+mcp verified green at wave-2 commit; full chain re-run at end)
- [ ] V2 pnpm lint green
- [ ] V3 pnpm test (≥600s timeout; db:generate preflight sequential per MISTAKES ledger)
- [ ] V4 Final honest report: fixed vs deferred vs report-only + known gaps

## Out of scope (signed)
- Email send integration, duplicate-merge UI, migrations UI, analytics backend = new features. Reported as benchmark gaps.
- BIDCRM-design/, packages/twenty-bidstack/ untouched. .github/workflows report-only.
- 19 unverified minors: fix opportunistically only if touching the same file.
