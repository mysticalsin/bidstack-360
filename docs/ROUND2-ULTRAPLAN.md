All load-bearing claims are now verified against both repos. Two reality corrections surfaced during verification that the plan must carry: BidStack ships **seven** locale trees, not five (`ls apps/web/public/locales` → ar/en/es/fr/it/pt/zh), and the raw `--fg-inverted` CSS var already exists in both themes (index.css:71, :233) — only the `@theme` bridge line is missing. Writing the plan.

---

# Round 2 — the 100x plan

**Target:** `D:\BIDCRM`, branch `feat/crm-design-fusion` (5 Round-1 commits ahead of `origin/demo`: `9cb2b5e6..3cf26d22`, verified `git log --oneline origin/demo..HEAD`). PRs stack onto this branch, merge target `origin/demo` (amendment 1). Source: `D:\CRM` (trycompai/crm). BidStack is pnpm; CRM is bun. Round 1 is shipped and is the floor; this plan is the 100x.

---

## Verdict — what we build, what we refuse

**We build the "balanced" design — two tracks from day 1 converging on one square metre of screen — with eight grafts from the losing designs.**

- **Track A (design):** the named 18-file graft (amendments 5/6/7) into a new namespace `apps/web/src/components/table-kit/`, rewritten into BidStack's token vocabulary *during* the port — enforced mechanically, because Round 1's shipped lint already errors on 8 shadcn names in `apps/web` (`packages/eslint-rules/design-law.js:62-71`, rules `no-foreign-token-vocabulary` / `no-theme-variant-geometry` / `no-raw-hex-in-classname`, verified). Density and URL-as-state land on the four surfaces a bid manager lives in (amendment 8): `ProposalsPage.tsx`, `BidNoBidPage.tsx`, `ComplianceMatrix.tsx`, `ReferencesPage.tsx` — all four verified present.
- **Track B (agent):** the vertical agent slice amendment 9 orders verbatim (*"Give the agent a face and move it to week 1… Promote Phase 7's own week-4 shippable slice (`packages/evidence` + `BidFact` + `answer_requirement`) into core scope"* — `D:\CRM\docs\BIDSTACK-FUSION-VALIDATION.md:118`): an immutable `BidFact` ledger + typed citations, the CRM's evidence scorer with its untouchable thresholds (`D:\CRM\apps\agent\agent\lib\evidence.ts:93-133`, verified: CEILING 0.99, contradiction clamp 0.45, VERIFIED = ≥0.85 AND a primary source), one upgraded worker (`rfp-compliance-fill` gains SourceChunk retrieval, in-code quote re-verification, gap-flagging, propose-only writes), one decide endpoint cloning the CRM's TOCTOU-guarded settle transaction (`D:\CRM\apps\api\src\contacts\contacts.service.ts:432-487`, verified), and the face: accept/dismiss strips + provenance tooltips inside the reskinned compliance matrix.

**Why this is the 100x and not a 2x:** the reskin alone is copyable — the source is an open repo. What is not copyable is the flywheel this round starts: every accept/dismiss decision is logged against the evidence kinds that produced the proposal (`bid_fact_decisions`), calibrating weights against real bid-manager judgement per tenant, on top of an integration depth (153-model multi-tenant schema, SERUM governance, TOCTOU gate, Art. 50 audit trail) that took two rounds of groundwork. The target is unusually ready: `ComplianceMatrixRow` already carries `answerDraft` (schema.prisma:1668), nullable `confidenceBps` (:1671), Round 1's `AssessmentStatus` (:1672, enum at :1453-1459), and `evidence`/`citations` Json defaulting `"[]"` (:1673-1674) that **nothing populates today** — the current fill worker sends only bare `requirementText` to the LLM (`apps/worker/src/queues/rfp-compliance-fill.ts:95-105`, verified) and writes `answerDraft` uncited (:138-146). That is live product debt this round retires.

**We refuse:** the chat panel (eve's React 18 compat is unverified — `eve@0.29.4` declares no react peer), the judgement queue/dispatcher build (specified in an ADR this round, built in Round 3), the record-sheet peek shell (specified, not built), `icon.tsx`, React 19, `format.ts`, the CRM's greens, and the dead 56-component import. Full list in NOT DOING.

**Governance posture, called now:** in Round 2 **every** agent output lands `PROPOSED` — including VERIFIED-band facts. The CRM's law lets VERIFIED apply directly (`D:\CRM\apps\agent\agent\lib\facts.ts:137`), but SERUM hard-denies write-capable/autonomous agent modes (`packages/db/src/serum-runtime-policy.ts:789-796`, verified: `/unrestricted|write|autonomous/i` → denied) and requires `approvalConfirmed` (:781). Auto-apply of VERIFIED is a Round 3 decision, taken only after calibration data exists and the SERUM registration ADR has survived review. Promotion to record happens exclusively through the human decide endpoint or the existing TOCTOU-safe approval transaction (`apps/api/src/routes/rfp-pipeline.ts:429-490`, verified: atomic `updateMany` on `approvedAt IS NULL` :433-443, conditional raw state UPDATE asserting one row :449-460, in-transaction blocker recount :465-471, Art. 50 `logAiInvocation` :495-505).

---

## Where the judges split and how I called it

All three judges picked **balanced** (83/80/84 vs graft-only 70/67/66 vs agent-forward 53/53/52). The splits were inside the grafts and the reality corrections:

1. **When the `no-arbitrary-geometry` lint rule lands.** Balanced originally put it in Phase 3; judge 2 demanded it ship "in the same commit that lands the first table-kit file, not in Phase 3 — the graft is exactly when that debt would silently accumulate." **Called for judge 2:** the rule ships inside commit A1, the first table-kit commit. Cost is identical; timing is the whole point. Today literal `rounded-[7px]`/`p-[13px]` pass lint — only `RAW_HEX_RE` (design-law.js:84, warn) covers arbitrary values.
2. **Which phase gets breadcrumb record-name resolution.** Judge 1: "fold into balanced's Phase 3 seal." Judge 3: "fits inside Phase 2's surface work." **Called for Phase 3:** Phase 2 commits are strictly surface-scoped (page + search-params + e2e per PR); the breadcrumb edit touches `Topbar.tsx:33-52` (shell — its own comment at :46-47 admits the TODO: *"show a generic 'Detail' rather than a raw UUID, until we wire per-record names through React Query cache"*, verified). Shell edits do not ride in surface PRs.
3. **How much "agent activity" surface to build without the task queue.** Judge 1 wanted a per-opportunity rationale list; judge 2 wanted a per-row outcome line; agent-forward's full `AgentActivityPanel` needs `bid_agent_task`, which we are not building. **Called: both minimal forms, zero queue dependency** — a per-row rationale line under each settled answer, plus a small per-opportunity "what the agent did" list rendered purely from `BidFact` rows (Phase 2, commit C7). The outcome-is-the-answer discipline lands without any dispatcher.
4. **Dark brand: amendment 2's `#5B7FFF` vs code.** The binding brief says amendments override the plan; reality overrides both: live dark brand is `#5e6ad2` (`apps/web/src/index.css:195`, verified) and `docs/adr/0002-design-tokens.md` already documents the divergence and notes **both values pass contrast** (verified: *"the dark brand in code is `#5e6ad2`, not the `#5B7FFF` the validation doc quotes… Both pass"*). **Called: code wins.** Amendment 2's substance is "theme-specific brand values that each pass WCAG" — `#2C4BFF` light / `#5e6ad2` dark satisfies it. All new CSS writes `var(--brand-primary)` only; ADR-0005 records the reconciliation so the question stays moot.
5. **"Five locales" (amendment 13) vs reality.** `ls apps/web/public/locales` → **seven** trees: `ar en es fr it pt zh` (verified). **Called: follow reality** — every new string lands keys in `en` + all six translations, in the introducing commit.
6. **"102 e2e" vs "51 e2e suites."** Both true: 51 e2e **files** + 60/61 integration files are the DB-backed set (`docs/FEATURE-TEST-REPORT.md:238`), and pointed at the fast DB the chromium run yields **102 passed** tests (:260). Plans below cite files for scope, tests for green-ness.

---

## The 18-file graft manifest

All line counts re-verified with `wc -l` in `D:\CRM\packages\ui\src` (sum of graft set + closure = 2,218). `rg tanstack packages/ui` → **0 matches** (verified): the data table is headless, no @tanstack/react-table anywhere. Everything lands in `apps/web/src/components/table-kit/` (components) and `apps/web/src/lib/table/` (lib) — **never overwriting** BidStack's tested `Table.tsx`/`Card.tsx`/`Button.tsx`/`Tooltip.tsx`/`Icon.tsx`.

| # | File (D:\CRM\packages\ui\src\…) | Lines | Port cost | Classname/API rewrites (during graft — lint-enforced) | Lands where |
|---|---|---|---|---|---|
| 1 | `components/data-table.tsx` | 604 | light-rewrite | `bg-muted`→`bg-surface-sunken` (sticky header :424), `bg-muted/30`→`bg-surface-soft` (subrows :557), `hover:bg-muted/60`→`hover:bg-surface-hover`, `bg-card`→`bg-surface-card`, `text-muted-foreground`→`text-fg-secondary`, `shadow-[inset_0_-1px_0_var(--border)]`→`var(--border-default)`; 7 Carbon glyphs (:3-9, verified) → BidStack `<Icon name=…>` (ArrowsVertical→ChevronsUpDown, Column→Columns3); Button `outline`→`secondary`, `contrast`→`primary`; 2 nuqs `useQueryState` calls (:159-171, verified) stay on nuqs via v6 adapter; ~12 strings → `t()` in all 7 locales | `table-kit/data-table.tsx` |
| 2 | `components/table.tsx` | 119 | light-rewrite | `text-muted-foreground`→`text-fg-secondary` (TableHead :76), `hover:bg-muted/60`→`hover:bg-surface-hover`, `data-[state=selected]:bg-muted`→`bg-surface-sunken` (:63), bare `border-b`/`border-t` → `+ border-border-subtle` (BidStack has no universal border-color rule) | `table-kit/table.tsx` |
| 3 | `components/simple-table.tsx` | 118 | light-rewrite | `bg-popover`→`bg-surface-raised`, `bg-background`→`bg-surface-page`, `bg-card`→`bg-surface-card`, `bg-muted`→`bg-surface-sunken`, inset-shadow `var(--border)`→`var(--border-default)` (7 edits) | `table-kit/simple-table.tsx` |
| 4 | `components/card-table.tsx` | 34 | light-rewrite | `text-muted-foreground`→`text-fg-secondary`; `border-t` + explicit color | `table-kit/card-table.tsx` |
| 5 | `components/table-pagination.tsx` | 69 | light-rewrite | 2 Carbon chevrons → `<Icon name="ChevronLeft/Right">`; Button `contrast`→`primary`, `ghost` stays; `text-muted-foreground`→`text-fg-secondary` ×2; `Previous/Next/No results/Showing…of…` → `t()` | `table-kit/table-pagination.tsx` |
| 6 | `components/dropdown-menu.tsx` | 272 | **heavy-rewrite** | 29 token edits: `text-accent-foreground`→`text-fg-primary` ×10, `bg-accent`→`bg-surface-hover` ×5, `bg-popover`→`bg-surface-raised`, `text-popover-foreground`→`text-fg-primary`, `bg-destructive/10`→`bg-danger-tint`, `ring-1 ring-foreground/10`→`border border-border-default`, `outline-hidden`→`outline-none`; `data-open:`/`data-closed:`→`data-[state=open/closed]:` (classic Radix emits `data-state`); dep `radix-ui`→**new** `@radix-ui/react-dropdown-menu`; animate-in utilities via **new** `tw-animate-css` | `table-kit/dropdown-menu.tsx` |
| 7 | `components/spinner.tsx` | 16 | verbatim | cn import path only (`@/lib/cn`) | `table-kit/spinner.tsx` |
| 8 | `components/card.tsx` | 122 | light-rewrite | `bg-card`→`bg-surface-card` ×2, `text-muted-foreground`→`text-fg-secondary` ×2, explicit border colors; verify `@container/card-header` on the post-bump Tailwind | `table-kit/card.tsx` (namespaced — BidStack `Card.tsx` untouched) |
| 9 | `components/empty.tsx` | 137 | light-rewrite | cva variants inlined as plain `Record` maps (**no cva dep**); `text-muted-foreground`→`text-fg-secondary`, `bg-muted`→`bg-surface-sunken` (icon chip), `font-heading`→`font-display`, `border-dashed` + explicit color | `table-kit/empty.tsx` |
| 10 | `components/empty-cell.tsx` | 5 | verbatim | `text-muted-foreground`→`text-fg-secondary` (1 edit) | `table-kit/empty-cell.tsx` |
| 11 | `components/status-indicator.tsx` | 107 | light-rewrite | CSS-var remap (:15-21): `var(--color-muted-foreground)`→`var(--fg-secondary)`, `--color-info/success/warning`→`--info/--success/--warning`, `--color-destructive`→`--danger`; rides `lib/dither.ts` (12) + bloom CSS | `table-kit/status-indicator.tsx` |
| 12 | `components/stat-card.tsx` | 100 | light-rewrite | `text-destructive`→`text-danger`, `text-muted-foreground`→`text-fg-secondary` ×4, `text-success` unchanged (BidStack defines it) | `table-kit/stat-card.tsx` |
| 13 | `components/dashboard.tsx` | 223 | light-rewrite | `text-muted-foreground`→`text-fg-secondary` ×4, explicit borders; rides `skeleton.tsx` micro-port (13 lines, `bg-muted`→`bg-surface-sunken`); container queries (`@container/stats`, `@2xl`) verified against post-bump Tailwind | `table-kit/dashboard.tsx` |
| 14 | `components/sourced-value.tsx` | 70 | light-rewrite | Retarget off-list `tooltip.tsx` import to BidStack's tested `Tooltip` (~10-line adaptation); `text-muted-foreground`→`text-fg-secondary`; `SOURCED_VALUE` dotted-underline class unchanged | `table-kit/sourced-value.tsx` — **the strip's renderer** |
| 15 | `lib/row-accent.ts` | 21 | verbatim | one edit: `bg-foreground`→`bg-fg-primary` (line 5) | `lib/table/row-accent.ts` |
| 16 | `lib/table-query.ts` | 17 | verbatim | none — pure types | `lib/table/table-query.ts` |
| 17 | `lib/format.ts` | 98 | **SKIP** | Reality overrides amendment 5: BidStack's `apps/web/src/lib/format.ts` is locale-aware and collides on `formatMoney` semantics (cents vs whole EUR). Lift only `formatCount` + `initialsFromName` (~10 lines) into BidStack's file | (not ported) |
| 18 | `styles/globals.css:242-481` (bloom 242-254, icon-motion 256-397, view-transition 399-481) | 238 | verbatim | Pure CSS, zero brand values — take no `:root` tokens, no 5px radius, no fonts. Verified absent from BidStack (0 `cds-icon`, 0 bloom matches in index.css) | `index.css` new sections (or `table-kit/motion.css` imported once) |
| + | `components/icon.tsx:35-78` `MOTION_BY_ICON` | 44 | **reimplement** | Do NOT port icon.tsx (amendment 7). Re-key the map (verified :35-69, fallback `"pop"` :75-78) to BidStack's lucide semantic names; stamp `cds-icon` class + `data-motion` attr inside BidStack's existing `Icon.tsx`. **Zero edits** to the 342 call sites across 128 files (re-verified: `grep -rlo '<Icon name=' → 128`, `-o → 342`). No React 19 | modify `apps/web/src/components/ui/Icon.tsx` |
| + | closure: `button.tsx`/`tooltip.tsx`/`lib/utils.ts` | 129 | **SKIP** | BidStack has tested equivalents (`Button.tsx` VARIANT map at :94, `Tooltip.tsx`, `lib/cn.ts`). Mapping: `outline`→`secondary`, `contrast`→`primary`; the h-6 sort buttons use `sm` or an added `xs` size | (not ported) |
| + | closure: `skeleton.tsx` (13) + `lib/dither.ts` (12) | 25 | micro-port | ride with dashboard/status-indicator; 1 token edit each | `table-kit/skeleton.tsx`, `lib/table/dither.ts` |
| + | `components/suggestion.tsx` | 61 | light-rewrite (Phase 2) | Props verified (:10-21): `{value, rationale, pending, onAccept, onDismiss}`; Carbon `Checkmark`/`Close` (:3-4) → lucide via `<Icon>`; `text-muted-foreground` (:26)→`text-fg-secondary`, `text-foreground` (:30)→`text-fg-primary`; `size="icon-xs"` → BidStack ghost icon sizing | `components/agent/Suggestion.tsx` |

**Rewrite volume:** ~81 semantic-color occurrences in the named files, ~114 with closure (the plan's "243" measured the abandoned 56-component set). The un-rewritten path **fails CI by design** — `design-law.js:62-71` errors on `bg-card`, `text-muted-foreground`, `bg-popover`, `bg-accent`, `text-accent-foreground`, `bg-secondary`, `text-card-foreground`, `border-input` in `apps/web`.

**New deps (3):** `@radix-ui/react-dropdown-menu` (BidStack has dialog/tabs/tooltip/hover-card, no dropdown), `tw-animate-css` (CSS-only), `nuqs` (2.9.4 ships a first-class `react-router` adapter — verified `node_modules/.bun/nuqs@2.9.4…/dist/adapters/react-router.js` exists in D:\CRM's install). **Avoided deps:** `@carbon/icons-react`, `class-variance-authority`, `@tanstack/react-table` (never needed — zero usages).

---

## The design transplant — tokens, rhythm, shell delta

**Tokens (amendments 2 + 6).** One vocabulary: BidStack's `--surface-*/--fg-*/--border-*/--brand-*` set with the `@theme` bridge at `index.css:354`. Exactly one token addition: `--color-fg-inverted: var(--fg-inverted)` inside the `@theme` block — the raw var already exists in both themes (`index.css:71` light `#ffffff`, `:233` dark `#010102`, verified); only the Tailwind bridge is missing. Brand stays `#2C4BFF` light / `#5e6ad2` dark (code, `index.css:195`); the CRM's `#006b4f` is never imported (it measures 2.94:1 on dark — the exact failure ADR 0002 records). All grafted CSS writes `var(--brand-primary)`, never a hex.

**Rhythm (density).** The CRM's density grammar arrives whole: `text-xs` table base, `h-9` headers / `px-2 py-2.5` cells at the primitive tier with DataTable's comfortable list-page override (h-11 / px-3 py-3), right-aligned `tabular-nums` for every number, sticky sunken header with inset-shadow border, `ROW_ACCENT`'s 2px bar + 200ms padding slide on hover, `EmptyCellValue`'s em-dash as the only legal null render, status as quiet dot+word via `StatusIndicator` (never a filled pill), KPIs as one bordered `StatGroup` instrument panel. Blocker removed first: the **unconditional** 44px touch-target rule (`index.css:536-541`, verified: `button, [role='button'], a { min-height: 44px; min-width: 44px; }`) gets scoped to the already-defined `pointer-coarse` custom variant (`index.css:29`, verified) so dense h-8/h-9 controls stop being inflated on desktop while touch devices keep WCAG 2.5.5.

**URL-as-state.** `nuqs` mounted once via `NuqsAdapter` from `nuqs/adapters/react-router/v6` (react-router-dom ^6.30.4 already installed); `createListSearchParams` (D:\CRM `apps/app/components/data-table/list-search-params.ts:64-113`) ports with the RSC-only `load` field deleted; `use-table-query.ts` (60 lines) ports near-verbatim. Each surface declares its queryable shape in a ~6-line module (the `deals-search-params.ts:1-8` template). Every filtered view becomes a shareable link; Back walks pages (`history:'push'` on page). **Precondition (graft from graft-only):** a pre-flight audit of existing `?tab=`/`?view=`/search-param usage on the four surfaces — the Sidebar computes active state from `?tab=` (`Sidebar.tsx:~310-328`, verified) and nuqs writers must preserve unrelated params.

**Shell delta this round: near-zero, by design.** No AppShell/Sidebar/Topbar rework except the Phase 3 breadcrumb fix (`Topbar.tsx:33-52`). The record-sheet peek system (Sheet primitive, `record-stack` URL state, opportunity/account peeks, palette→peek wiring) is **specified in ADR-0006 this round and built in Round 3**, including the peek-vs-page rule written now: *lists/kanban/palette open the peek; direct URLs and "Open full page" hit the route; the `?record=` writer preserves unrelated params.* Icon micro-motion is the one shell-wide visible change: `data-motion` + `cds-icon` stamped inside `Icon.tsx`, so every icon in the app gains its hover motion with zero call-site edits.

---

## The agent layer — models, tools, skills, dispatcher, evidence law, governance path

### Models (migration `packages/db/prisma/migrations/2026xxxx_bid_fact_ledger/`)

On top of Round 1's `AssessmentStatus` enum (schema.prisma:1453-1459, reused verbatim) and the nullable-`confidenceBps` convention (:1632, :1671):

```prisma
enum BidFactStatus { PROPOSED APPLIED DISMISSED SUPERSEDED  @@map("bid_fact_status") }

model BidFact {                       // immutable — supersede, never update
  id                 String        @id @default(uuid()) @db.Uuid
  orgId              String        @map("org_id") @db.Uuid            // tenant pin, NOT NULL
  opportunityId      String?       @map("opportunity_id") @db.Uuid
  subjectType        String        @db.VarChar(40)                    // 'matrix_row' | 'requirement'
  subjectId          String        @map("subject_id") @db.Uuid
  claim              String                                            // the proposed answerDraft text
  verdict            String        @db.VarChar(30)                    // YES|NO|PARTIAL|NOT_APPLICABLE|GAP
  confidenceBps      Int?          @map("confidence_bps")             // scoreEvidence * 10000; null = none
  band               String?       @db.VarChar(12)                    // VERIFIED|PROBABLE|POSSIBLE
  assessmentStatus   AssessmentStatus @default(PENDING) @map("assessment_status")
  rationale          String?                                           // rationaleFor() output, rep-readable
  status             BidFactStatus @default(PROPOSED)
  valueHash          String        @map("value_hash") @db.VarChar(64) // normalized SHA-256, dismissal dedupe
  producedByAgentKey String        @map("produced_by_agent_key") @db.VarChar(80)
  dustRunId          String?       @map("dust_run_id") @db.Uuid
  supersededById     String?       @map("superseded_by_id") @db.Uuid
  decidedByUserId    String?       @map("decided_by_user_id") @db.Uuid
  decidedAt          DateTime?     @map("decided_at") @db.Timestamptz(6)
  createdAt          DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  citations          BidFactCitation[]
  @@index([orgId, subjectType, subjectId, status])
  @@index([orgId, opportunityId, createdAt])
  @@map("bid_facts")
}

model BidFactCitation {                // typed replacement for citations Json "[]"
  id            String  @id @default(uuid()) @db.Uuid
  orgId         String  @map("org_id") @db.Uuid
  bidFactId     String  @map("bid_fact_id") @db.Uuid
  sourceChunkId String  @map("source_chunk_id") @db.Uuid              // FK → source_chunks
  pageStart     Int?    @map("page_start")
  pageEnd       Int?    @map("page_end")
  quote         String                                                 // re-verified in code before insert
  @@index([bidFactId])
  @@map("bid_fact_citations")
}

model BidFactDecision {                // calibration flywheel (graft from agent-forward)
  id              String   @id @default(uuid()) @db.Uuid
  orgId           String   @map("org_id") @db.Uuid
  bidFactId       String   @map("bid_fact_id") @db.Uuid
  decision        String   @db.VarChar(10)                            // accept | dismiss
  decidedByUserId String   @map("decided_by_user_id") @db.Uuid
  evidenceKinds   String[] @map("evidence_kinds")                     // denormalized snapshot for weight calibration
  scoreBps        Int?     @map("score_bps")
  band            String?  @db.VarChar(12)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  @@index([orgId, createdAt])
  @@map("bid_fact_decisions")
}
```

Citations resolve through the existing provenance chain unchanged: `ComplianceMatrixRow.requirementId` (unique, :1663) → `Requirement.sourceChunkId` (:1623, **nullable** — a missing link is `UNAVAILABLE` evidence, never invented) → `SourceChunk.pageStart/pageEnd` → `DocumentVersion` → `BidDocument`. If the Windows `db:generate` DLL lock persists, the new tables follow the Wave 9 raw-SQL house pattern (`apps/worker/src/queues/rfp-orchestrator.ts:7-9`).

### Evidence law (`apps/worker/src/agent/evidence.ts` — arithmetic verbatim, vocabulary new)

Ported unchanged from `D:\CRM\apps\agent\agent\lib\evidence.ts` (verified): noisy-OR `score = min(0.99, 1 − Π(1−w))` (:93, :112-117), any `contradiction` clamps to **0.45** (:95, :118) — below PROBABLE's floor, so disagreement HOLDS, never averages; bands (:97, :128-133): **VERIFIED ≥ 0.85 AND hasPrimary**, PROBABLE ≥ 0.55, POSSIBLE ≥ 0.3, below → `null` = not stored. The model never sets its own confidence — it reports observed evidence kinds; this file prices them. Bid vocabulary (weights recorded in ADR-0004 as explicit starting guesses):

| Kind | Weight | Primary |
|---|---|---|
| `rfp.stated-in-document` | 0.95 | yes |
| `library.delivered-project` | 0.85 | yes |
| `crm.client-correspondence` | 0.85 | yes |
| `proposal.prior-submission` | 0.80 | yes |
| `compliance.certificate-on-file` | 0.80 | yes |
| `web.cited-claim` | 0.40 | no |
| `competitor.insight` | 0.35 | no |
| `similar-requirement-only` | 0.20 | no (deliberately near-worthless alone — the "employer-only" analogue) |
| `contradiction` | 0.00 | no (clamp trigger) |

### Tools shipped this round (worker-internal functions with contracts — the Round-2 agent has exactly one reflex, done properly)

1. `retrieveRequirementContext(orgId, requirementId) → { requirement, chunk | null, neighbours: SourceChunk[], assessable: boolean }` — chunk via `Requirement.sourceChunkId`; neighbours via the existing pgvector hybrid machinery (`apps/worker/src/queues/rfp-story-match.ts:1-41` — no new RAG plumbing), gated by `checkSerumRetrievalRuntimePolicy` exactly as `rfp-embed-requirement.ts:59` does. `chunk === null` → the fact is capped at `assessmentStatus: UNAVAILABLE`.
2. `citeSource(quote, chunk) → BidFactCitation | REJECTED` — normalized-substring re-verification **in code** against `SourceChunk` text before a citation may exist. A quote that cannot be re-found is a **rejection, not a lower score**.
3. `proposeAnswer(orgId, matrixRowId, draft, evidence[]) → BidFact(PROPOSED) | Refusal` — the only write path, enforcing the `recordFact` gate laws (verified in `D:\CRM\apps\agent\agent\lib\facts.ts`): empty → refuse; band `null` → refuse ("below the floor for keeping"); `valueHash` matches a DISMISSED fact → never re-offer (:96-109 pattern, hash instead of `sameValue` because compliance answers are paragraphs); identical APPLIED value → no-op (:111-122); human-edited `answerDraft` with no underlying applied fact → refuse — a person outranks the web (:126-135). Everything that survives lands `PROPOSED` (Round-2 posture; :137's VERIFIED-applies is deferred to Round 3).
4. `flagComplianceGap(orgId, requirementId, gap, evidence[]) → BidFact(verdict GAP) + ReviewIssue` *(graft from agent-forward, all three judges)* — when no source satisfies a **mandatory** requirement, open a `ReviewIssue` (model at schema.prisma:1693, carries `sourceChunkId` — the existing chunk-anchored precedent) at severity `high`. High/critical issues already block the approval gate via the in-transaction recount (`rfp-pipeline.ts:465-471`, verified) — "we cannot comply" becomes a first-class agent outcome for **zero new gate code**.
5. API — `GET /api/opportunities/:oppId/bid-facts?requirementId=&status=` (org-scoped list) and `PATCH /api/bid-facts/:id/decide { decision: 'accept' | 'dismiss' }` cloning the `decideFact` contract (verified `contacts.service.ts:432-487`): 404 absent; **409 "already settled"** unless `PROPOSED` (:451-453); transaction: accept → supersede prior APPLIED for the subject (:460-467 pattern), set APPLIED + `decidedByUserId`/`decidedAt`, write `ComplianceMatrixRow.answerDraft` + `responseStatus` + `confidenceBps` + `assessmentStatus`; dismiss → permanent. Inside the same transaction: insert the `BidFactDecision` calibration row and fire `logAiInvocation` (the Art. 50 twin of `rfp-pipeline.ts:495-505`).

### Skills (prose-as-code, loaded into the worker's system prompt; invariants doubly enforced in code)

`apps/worker/src/agent/skills/` — three files this round, adapted from `D:\CRM\apps\agent\agent\skills/`:
- **`evidence.md`** — you never set a confidence; report what you observed and the ledger prices it; one entry per *independent* source (a page whose subject and obligation both match is ONE observation); the detail line is written for the bid manager's tooltip ("DPA §3 names AWS eu-west-1", not "match confirmed"); a proposal is a normal outcome, not a failure — never add evidence to push a claim over a line.
- **`answering-requirements.md`** (heir to `identity-matching.md`) — guess where to look, never what the answer is; the SUBJECT and the OBLIGATION must both match or it is a different requirement (this is how a UK data-residency answer gets filed against an EU clause — `similar-requirement-only` exists to make that near-worthless); fail closed: an unanswered mandatory row a human can fill beats a wrong answer nobody knows to fix; things that look like evidence and are not: a keyword hit, a reference on the same technology, plausible boilerplate.
- **`data-boundaries.md`** — stricter than source: no client RFP text in third-party queries (derived questions only); org-scoped reads only; nothing from one org's documents into another org's context, logs, or any shared workspace, ever; Tier-D documents never reach any AI processor (`isDocumentAiSafe`, `rfp-requirement-extract.helpers.ts:256`).
- `writing-a-win-theme.md` — deferred to Round 3 (no win-theme tool this round), named in ADR-0007.

### Dispatcher

**Round 2 builds no dispatcher.** The slice's two entry points already exist: the BullMQ compliance-fill queue (mechanical trigger) and the human-triggered autofill route, which hard-requires orchestration `state='approved'` (`rfp-pipeline.ts:295-302`, verified comment: *"A human must have approved the pipeline before AI-generated content can populate production-visible rows"*) — so every proposal is post-human-gate by construction. **The Round 3 dispatcher is fully specified this round in ADR-0007** so the calibration data has a named consumer *(graft from agent-forward, judge 3)*: `bid_agent_task` table = org-pinned clone of the CRM's `agentTask` with `claimDue`'s single-statement `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)` lease (verified `D:\CRM\apps\agent\agent\lib\tasks.ts:24-46`; `LEASE_MS` 10 min :20, `MAX_ATTEMPTS` 3 :22), dedup-by-outstanding-intention, outcome ≤500 chars as the durable answer; tick = BullMQ repeatable job, BATCH 5; mechanical kinds run with no LLM; kinds table: `answer-pass` (prio 20, budget 8, enqueued at extract completion ~`rfp-requirement-extract.processor.ts:305`), `rfp-amendment` (100), `deadline-watch` (200), `bidnobid-prep` (50), `recheck` (0, self-booked with a ≥10-char rep-readable reason).

### Governance path (ride, never fork)

1. **SERUM.** Before every proposing run the worker calls `checkSerumAgentRuntimePolicy`. Verified semantics: unconfigured/disabled → deny; `!humanApprovalRequired || !approvalConfirmed` → deny (:781-787); autonomy matching `/unrestricted|write|autonomous/i` → **deny** (:789-796); not allowlisted → deny (:797-803); concurrency cap (:805-811). **ADR-0003 (written and reviewed in Phase 0, before any Track B code)** registers the proposer with autonomy `propose-only`, records that the org's *versioned published SERUM config* constitutes the standing run-approval (`approvalConfirmed` derives from it), and names the fallback if reviewers reject standing approval: human-triggered runs from the matrix UI only — degrades convenience, preserves everything else.
2. **Propose-only writes.** The worker writes `BidFact(PROPOSED)` + citations + `ReviewIssue`s. It never touches `answerDraft` directly under the new flag. Promotion = the decide endpoint (Clerk user, per-row) or the TOCTOU `rfp-approve` transaction (pipeline-level, `rfp-pipeline.ts:429-505`).
3. **Tenancy.** Every read/write carries `orgId` in the where-clause — `tenant-scope-guard` enforce mode is mandatory in prod (`apps/worker/src/lib/production-env.ts:88-93`) and undefined-orgId counts as unscoped. The worker keeps the loaded-row org-verify + `doNotRetry` pattern (`rfp-compliance-fill.ts:85-87`, verified). Any future cross-opportunity retrieval applies the `startedByUserId` country scope (`access-scope.ts`) — noted in ADR-0003 as a Round 3 obligation; Round 2's retrieval is same-opportunity only.
4. **NDA-D.** `isDocumentAiSafe` stays in front of everything; Tier-D never reaches the proposer.
5. **Audit.** Accept/dismiss writes `logAiInvocation` + the `AuditLog` row, mirroring the approval gate's trail.

---

## Phases

Branch: continue `feat/crm-design-fusion`; one PR per commit-group; PRs target `origin/demo`.

**Test substrate for every phase (the thing that makes this executable):** the isolated fast Postgres from `docs/FEATURE-TEST-REPORT.md:243` — `pgvector/pgvector:pg16` on tmpfs at `:5434`, all migrations + seed applied. This is what makes the **61 integration files** (:247-253, all green) and the **51 e2e files / 102 chromium tests** (:238, :260) runnable at all; the shared DB runs 30-70s per query. Full e2e command (:265): `E2E_WORKERS=4 pnpm --filter @bidstack/web exec playwright test --project=chromium-desktop`. Every phase's DoD below means "green on this recipe", plus `tsc --noEmit`, `eslint --quiet`, and the ~1,890 unit tests.

### Phase 0 — Substrate and law (0.8 ew)

**Scope:** the ground both tracks stand on: Tailwind stable, touch-target scoping, the one missing token, nuqs mounted after a param audit, the BidFact migration, and the three ADRs — including the SERUM ADR **before** any Track B code *(graft: all three judges)*.

**Files:** `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/src/index.css`, `apps/web/src/main.tsx`, `packages/db/prisma/schema.prisma` + new migration dir, `docs/adr/0003-serum-propose-only-agent.md`, `docs/adr/0004-bid-evidence-vocabulary.md`, `docs/adr/0005-brand-dark-reconciliation.md`, `docs/design-system/url-param-audit.md`.

**Commits:**
1. `chore(web): tailwind 4.0.0-beta.7 -> 4.x stable + tailwind-merge v3` — alone, first, with the **48-hour decision gate** *(graft: graft-only)*: full battery + dual-theme screenshots of shell, cockpit, and the four target surfaces; fallback pre-priced (stay on beta.7, downshift the graft's paren shorthands to `[var(--x)]` arbitrary syntax, ~1 day) and **decided by end of day 2**.
2. `fix(web): scope 44px touch-target rule to pointer-coarse` — wraps `index.css:536-541` in the `pointer-coarse` variant defined at `:29`.
3. `feat(web): bridge --color-fg-inverted into @theme` — one line in the `@theme` block (`index.css:354`); raw var already exists (`:71`, `:233`).
4. `docs(adr): SERUM propose-only registration, evidence vocabulary + BidFact lifecycle, dark-brand reconciliation` — ADR-0003 reviewed in isolation before B1 lands; ADR-0004 records weights as guesses + the dismissal-hash normalization (lowercase, collapse whitespace, strip punctuation → SHA-256); ADR-0005: code wins, `#5e6ad2` is law, `DESIGN.md` v2 to match.
5. `feat(web): add nuqs + NuqsAdapter (react-router v6)` — **after** the written `?tab=`/`?view=` audit of the four surfaces *(graft: graft-only)*; adapter export verified present in nuqs 2.9.4.
6. `feat(db): BidFact + BidFactCitation + BidFactDecision immutable ledger` — the schema above; raw-SQL Wave 9 pattern if `db:generate` stays DLL-locked.

**DoD (verifiable by another engineer):** app renders pixel-identical on Tailwind stable (screenshot diff of Sidebar/Topbar/cockpit/four surfaces, both themes, attached to the PR); `tsc`, eslint, ~1,890 unit green; **all 61 integration files green on :5434**; 102 chromium e2e green; migration applies clean on a fresh :5434 container and `prisma migrate diff` is empty against schema; ADR-0003 has a written review sign-off; the param-audit doc lists every query param on the four surfaces.

**User sees:** nothing changed — that is the phase's success criterion.

**Tests:** the full battery on the fast-DB recipe; migration round-trip (`migrate deploy` + rollback drill) on a throwaway :5434 container.

### Phase 1 — Track A: the graft ∥ Track B: the evidence spine (3.4 ew combined; disjoint file sets, no merge tax)

**Track A files (new unless noted):** `apps/web/src/components/table-kit/{data-table,table,simple-table,card-table,table-pagination,dropdown-menu,spinner,card,empty,empty-cell,status-indicator,stat-card,dashboard,sourced-value,skeleton}.tsx`, `apps/web/src/lib/table/{row-accent,table-query,dither}.ts`, `apps/web/src/index.css` (bloom/icon-motion/view-transition blocks), modify `apps/web/src/components/ui/Icon.tsx`, modify `packages/eslint-rules/design-law.js`, new dev route `apps/web/src/pages/dev/TableKitPlayground.tsx`, locale keys in `apps/web/public/locales/{ar,en,es,fr,it,pt,zh}/…`.

**Track A commits:**
1. `feat(table-kit): verbatim tier + motion CSS; feat(lint): no-arbitrary-geometry rule` — spinner, empty-cell, row-accent, table-query, skeleton, dither + the three CSS blocks, **and** the lint rule banning literal `rounded-[…]`/`p-[13px]`/`shadow-[…]` in the same commit *(graft: judge 2 — debt accumulates exactly now)*.
2. `feat(table-kit): table primitives` — table, simple-table, card-table, table-pagination, empty (cva inlined).
3. `feat(table-kit): dropdown-menu on @radix-ui/react-dropdown-menu + tw-animate-css` — the heavy unit; 29 token edits; `data-[state=…]` conversion.
4. `feat(table-kit): data-table` — 604 lines; icons/Button/nuqs/i18n edits per the manifest; keys land in all 7 locale trees in this commit.
5. `feat(table-kit): status + dashboard kit + sourced-value` — status-indicator, stat-card, dashboard, card, sourced-value (retargeted to BidStack Tooltip).
6. `feat(icons): data-motion re-key inside Icon.tsx` — `cds-icon` + `data-motion` from the re-keyed `MOTION_BY_ICON`; zero call-site edits; no React 19 (amendment 7 exactly).
7. `feat(web): /dev/table-kit playground route` — every table-kit component rendered with fixture data, both themes.

**Track B files:** `apps/worker/src/agent/{evidence.ts,facts.ts,retrieval.ts}`, `apps/worker/src/agent/skills/{evidence,answering-requirements,data-boundaries}.md`, modify `apps/worker/src/queues/rfp-compliance-fill.ts`, new `apps/api/src/routes/bid-facts.ts`, register in `apps/api/src/server.routes.ts`, integration tests.

**Track B commits:**
1. `feat(worker): bid evidence scorer — noisy-OR verbatim, VERIFIED = 0.85 + primary, contradiction clamps to 0.45` — unit tests pin every threshold and the clamp.
2. `feat(worker): compliance-fill retrieves its sources and proposes instead of writing` — behind env flag `RFP_PROPOSE_FACTS` (default off in prod, on in dev/staging; the current direct write at `rfp-compliance-fill.ts:138-146` stays as the rollback lever): retrieve chunk + neighbours, page-ranged context in the prompt, model reports evidence kinds, `citeSource` re-verifies quotes in code, `proposeAnswer` writes `BidFact(PROPOSED)` + citations; **gap path** *(graft)*: mandatory requirement with no satisfying source → `flagComplianceGap` opens the high-severity `ReviewIssue`; missing `sourceChunkId` → `UNAVAILABLE`, never invented; SERUM agent check before every run per ADR-0003; org-verify + `doNotRetry` kept.
3. `feat(api): bid-facts list + decide endpoint with calibration logging` — the contract above; 404/409/idempotency/supersede contract tests written **before** any UI consumes it; `BidFactDecision` insert inside the decide transaction *(graft)*.

**DoD:** Track A — all table-kit files pass the design-law lint (zero foreign tokens, zero arbitrary geometry), playground renders both themes, `grep -r "text-muted-foreground\|bg-card\|bg-popover" apps/web/src/components/table-kit` returns nothing, all 7 locale files contain the new keys (CI check), full battery green. Track B — scorer unit tests green including the contradiction clamp and the hasPrimary gate; integration tests on :5434 prove: proposal created with re-verified citation; fabricated quote rejected; dismissed hash never re-offered; human-edited row refused; mandatory-gap opens a ReviewIssue that the approve route's in-tx recount (`rfp-pipeline.ts:465-471`) then blocks on; decide 409s on a settled fact; org-mismatch throws with `doNotRetry`. Both tracks shippable independently: A is additive components + a dev route; B is flag-off in prod.

**User sees:** the `/dev/table-kit` playground — the CRM's table alive in BidStack blue in both themes: dense rows, the 2px accent bar sliding the first cell on hover, facet/sort/column dropdowns animating open, a bordered KPI strip, status dots with bloom, em-dashes for nulls; and every icon in the whole app now does its micro-motion on hover. Real pages unchanged. (Staging only: autofill now yields proposals in psql with citations attached.)

**Tests:** unit (scorer, facts gate, citeSource); integration on :5434 (worker + endpoint, including the SERUM-denied path); e2e untouched and still green — proof the graft is additive.

### Phase 2 — Convergence: density retarget + the face (1.8 ew)

**Files:** new `apps/web/src/lib/table/{list-search-params.ts,use-table-query.ts}`, new `apps/web/src/pages/…/{proposals,bid-no-bid,references,compliance-matrix}-search-params.ts`, modify `ProposalsPage.tsx`, `BidNoBidPage.tsx`, `ReferencesPage.tsx`, `apps/web/src/components/rfp/compliance/ComplianceMatrix.tsx` (93 lines, purely presentational — verified; the mount is additive), new `apps/web/src/components/agent/{Suggestion.tsx,ProposedAnswers.tsx,AgentRationaleList.tsx}`, e2e spec updates **in the same commits**, locale keys ×7.

**Commits:**
1. `feat(web): table query state — list-search-params + use-table-query ports` (RSC `load` deleted; documented).
2. `feat(proposals): table-kit density + URL state` — then 3. `feat(bidnobid): …`, 4. `feat(references): …`, 5. `feat(compliance): …` — one commit per amendment-8 surface, each carrying its e2e updates and the **"no blank table after first paint"** acceptance criterion *(graft: graft-only)*: `placeholderData: keepPreviousData` on every table query, inline Spinner-in-pagination, skeleton on cold load only.
6. `feat(compliance): proposed-answers strip` — `Suggestion` (rewritten per manifest) + `SourcedValue`/`Provenance` mounted per matrix row via a ~80-line react-query adapter over the decide endpoint (BidStack has no tRPC): applied answers render dotted-underlined with the provenance tooltip (claim, per-citation quote + page range + document name, observed date); pending facts render as accept/dismiss strips; dismissed disappear permanently. Per-row **rationale line** under settled answers *(graft: judge 2)*: "filled from Project Meridian reference, §3.2, p.14 — accepted by S. Laurent".
7. `feat(rfp): agent rationale list per opportunity` *(graft: judges 1+2)* — a small panel on the RFP workspace rendered purely from `BidFact` rows, newest first, amber for held/contradiction outcomes. No task queue involved.
8. `feat(worker): enable RFP_PROPOSE_FACTS by default` — the flag flips once 6-7 are green; the old direct-write path remains one env var away as rollback.

**DoD:** each of the four surfaces uses table-kit (text-xs base, fixed widths, right-aligned tabular-nums, sticky header, ROW_ACCENT, EmptyCellValue for every null, StatusIndicator for statuses); paste-a-URL reproduces the exact view (filters, sort, page, expanded rows) — asserted by a new e2e per surface; Back walks pages; no blank table after first paint (e2e asserts the table body is never empty during a page transition); the strip's accept updates `answerDraft` + `assessmentStatus` and re-renders as SourcedValue within one query cycle; dismiss is permanent across reloads; one new e2e file covers the strip (propose → accept → provenance tooltip → dismiss); 61 integration + all e2e green on :5434; every new string keyed in all 7 locales.

**User sees — the money screenshot:** the Compliance Matrix, dense. Rows at ~38px, quiet status dots, em-dashes where nothing is known. A third of rows carry a pale indented strip: *"YES — hosting is delivered from EU datacentres per our Meridian delivery model"*, a rationale line, and two ghost buttons ✓/✕. Accepting collapses the strip; the answer appears with a dotted underline; hovering shows the claim, *"RFP §4.7, p.14: 'all data shall reside within the EEA'"*, the document name, the date. One row is amber: "held — amendment 2 contradicts the base document on SLA; not averaged." Proposals/Bid-No-Bid/References got the same density, each a shareable URL. **This is the frame where BidStack visibly became a CRM with an agent in it — zero chat UI built.**

**Tests:** e2e per surface in-commit; strip e2e; decide-endpoint contract tests already green from Phase 1; full battery on :5434.

### Phase 3 — Seal (0.7 ew)

**Files:** locale JSON sweep, `apps/web/src/components/layout/Topbar.tsx`, optional router wiring, `docs/adr/0006-record-sheet-peek-spec.md`, `docs/adr/0007-bid-agent-task-dispatcher-spec.md`, session log + vault mirrors.

**Commits:**
1. `fix(i18n): audit sweep — zero English leakage in ar/es/fr/it/pt/zh on the four surfaces + strip`.
2. `feat(web): breadcrumb record-name resolution` — replaces the "Detail" placeholder via the React Query cache (`Topbar.tsx:46-51`'s own TODO) *(graft: graft-only; phase split called for 3)*.
3. `feat(web): view-transition wiring via react-router viewTransition` — **stretch, only if float remains**; the CSS shipped in Phase 1 is not claimed as navigation polish until this lands.
4. `docs(adr): Round-3 openers` — ADR-0006: the record-sheet peek system (Sheet primitive, `record-stack` URL state preserving unrelated params — unlike the CRM's writer which nulls them, `record-stack.ts:63-68` — opportunity/account peeks, palette→peek wiring) with the peek-vs-page rule verbatim; ADR-0007: `bid_agent_task` DDL + dispatcher loop + 12-tool contract set + `writing-a-win-theme.md`, plus the named budget line for the `agent-panel.tsx` port (548 lines) per amendment 9's own wording *(grafts: all three judges)*.
5. `docs(session): Round-2 session log + PROGRESS/ADR mirrors to the vault`.

**DoD:** `i18next-parser` (or the repo's key-check) reports zero missing keys for the new namespaces across all 7 locales; breadcrumb shows real names on the four surfaces' detail routes (e2e assertion); both ADRs merged with reviewer sign-off; full battery green.

**User sees:** the same screens in French/Arabic/Chinese without English leakage; breadcrumbs that say "Acme Retender 2026" instead of "Detail"; if the stretch landed, cross-fade between the four surfaces.

**Tests:** locale audit in CI; breadcrumb e2e; full battery on :5434.

### Effort summary

| Phase | Effort | Long pole |
|---|---|---|
| 0 | 0.8 ew | Tailwind regression check across 5,667-line index.css + battery |
| 1A | 1.9 ew | dropdown-menu rewrite; data-table's menus + i18n ×7 |
| 1B | 1.5 ew | retrieval context assembly + quote re-verification + gap path + contract tests |
| 2 | 1.8 ew | four surfaces × (retarget + e2e in-commit); strip is small because both its primitives (1A) and data (1B) exist |
| 3 | 0.7 ew | audit passes + ADRs |
| **Total** | **6.7 ew** | +20% contingency (Tailwind, DLL lock) → **8.0 ew honest ceiling**. Two engineers ≈ 3.5-4 calendar weeks; tracks touch disjoint files until Phase 2. |

---

## The density retarget — the four bid surfaces, before and after

| Surface | Before (verified) | After |
|---|---|---|
| **ProposalsPage.tsx** (8.5K) | `GlassCard`-based layout (import at :6); no dense table; state not in URL | table-kit `DataTable`: text-xs rows, fixed column widths, amounts right-aligned `tabular-nums`, stage as `StatusIndicator` dot+word, null dates as `EmptyCellValue` em-dash, sticky sunken header, ROW_ACCENT hover; `proposals-search-params.ts` (tab: stage; facets: owner/client/dueWindow) — every filtered view a shareable URL |
| **BidNoBidPage.tsx** (12.5K) | zero `<table>` (grep verified); `md:grid-cols-2` card grid (:273) | KPI row becomes one bordered `StatGroup` instrument panel (not floating cards); criteria/scoring rows as `SimpleTable` with ROW_ACCENT; `bid-no-bid-search-params.ts`; delta colors only on deltas (`TREND_COLOR` discipline) |
| **ComplianceMatrix.tsx** (93 lines, purely presentational — props from `RfpPipelinePage`) | static rows; `evidence`/`citations` columns exist but render nothing (default `"[]"`, schema:1673-1674) | table-kit density + **the strip**: value \| provenance-if-applied \| suggestion-if-proposed (the 3-slot pattern from `inline-field.tsx:35-141`, reimplemented not ported); unknown renders neutral (`AssessmentStatus PENDING/UNAVAILABLE` → grey dot / em-dash, never red); per-row rationale line; `compliance-matrix-search-params.ts` (facets: status/section/mandatory) |
| **ReferencesPage.tsx** (13.4K) | 2-col card grid (:185, :208) | `DataTable` default view (facets: sector/region), `initialsFromName` avatars, ROW_ACCENT rows; grid retired; `references-search-params.ts` |

Common acceptance line for all four: information density up ~2x per viewport, zero colored-pill statuses, zero blank cells, zero blank-table frames after first paint, URL round-trips the exact view.

---

## Risk register — top 8 with owner-level mitigation

| # | Risk | Owner | Mitigation |
|---|---|---|---|
| 1 | **Tailwind beta.7 → stable destabilizes 9,519 lines of bespoke CSS** (index.css 5,667 + cockpit.css 3,337 + org-dashboard.css 515) | FE lead | Commit #1, alone, gated on full battery + dual-theme screenshots of shell/cockpit/four surfaces; fallback pre-priced (stay beta.7, `[var(--x)]` downshift, ~1 day); **decision taken within 48h**, never discovered in week 3 |
| 2 | **Prompt injection: RFP text is third-party input read by a proposing worker** | BE lead | Structural, not aspirational: SERUM denies write-capable modes (serum-runtime-policy.ts:789-796); all writes land PROPOSED; quotes re-verified in code before citation (fabricated quote = rejection); model never sets confidence (ledger prices kinds); no shell, no DATABASE_URL, authored functions only, orgId pinned; NDA-D gate in front |
| 3 | **SERUM approval semantics for a non-interactive worker** (`approvalConfirmed`, :781) | Architect | ADR-0003 written and reviewed in Phase 0 **before any Track B code**; registration `propose-only`; versioned published config = standing approval; named fallback: human-triggered runs from the matrix UI |
| 4 | **e2e breakage on the exact surfaces touched** (51 files / 102 chromium green today) | QA + each surface-PR author | e2e updates budgeted **inside** every Phase 2 surface commit, never a trailing fix-tests phase; all runs on the :5434 fast-DB recipe (FEATURE-TEST-REPORT.md:243, :265) — the shared DB's 30-70s/query makes the suites unrunnable otherwise |
| 5 | **Windows `db:generate` DLL lock blocks Prisma client regen** | BE lead | Known house condition (rfp-orchestrator.ts:7-9); new tables follow the Wave 9 parameterized raw-SQL pattern until the lock clears; migration itself is plain SQL and unaffected |
| 6 | **nuqs fights existing search-param usage** (Sidebar active-state reads `?tab=`, ~:310-328) | FE lead | Phase 0 written param audit of the four surfaces before `NuqsAdapter` mounts; nuqs writers configured to preserve unrelated params; audit doc is a Phase 0 DoD artifact |
| 7 | **Port feels worse than the source on first paint (no RSC prefetch) and the graft gets blamed** | FE lead | Spec'd, not hoped: `placeholderData: keepPreviousData` on every table query, Spinner-in-pagination, cold-load skeleton; e2e asserts no blank table frame; written DoD line on every surface commit |
| 8 | **Uncalibrated evidence weights + paragraph-sized dismissal dedupe under-fires** | BE lead | Conservative by construction: 0.85+hasPrimary VERIFIED gate and everything-lands-PROPOSED means early errors cost a click, not a wrong record; normalized-hash dedupe with threshold in ADR-0004; `bid_fact_decisions` captures kind-level accept/dismiss data from the first day so Round 3 recalibrates from evidence, not vibes |

---

## What we are deliberately NOT doing

- **No chat panel / "watch it work" streaming UI.** The 548-line `agent-panel.tsx` port is a named, budgeted Round 3 deliverable (ADR-0007), per amendment 9's own wording. `eve@0.29.4` declares no react peer dep — React 18 compat must be priced before Round 3 commits to eve vs a native SSE session API.
- **No judgement queue / dispatcher / self-scheduling this round.** No `bid_agent_task`, no `claimDue` port, no `schedule_recheck`. The agent acts only through the existing post-approval compliance-fill entry. The full spec ships as ADR-0007 so Round 3 starts from a reviewed design.
- **No record-sheet peek shell.** Sheet primitive, `record-stack`, opportunity/account peeks, palette→peek wiring: specified in ADR-0006 with the peek-vs-page rule, built Round 3. Kanban clicks still navigate this round.
- **No `icon.tsx` port, no React 19** (amendment 7). BidStack's `Icon` and its 342 call sites across 128 files stay untouched; only `data-motion` is stamped inside it.
- **No `format.ts` port.** BidStack's locale-aware formatter wins; only `formatCount` + `initialsFromName` lift over. Two money grammars on one screen is the exact inconsistency this round kills.
- **No CRM brand values.** `#006b4f` fails dark contrast (2.94:1, ADR 0002); BidStack keeps `#2C4BFF`/`#5e6ad2` (amendment 2 as reconciled).
- **No 56-component import** (amendment 5), no `thread-message.tsx` (email-timeline UI, not agent UI), no `agent-model.tsx` settings card (presumes the Vercel AI Gateway).
- **No seam-B gate recommendation** (agent summary attached to `awaiting_approval`) and **no seam-A post-extraction judgement** — the agent's blockers already reach the gate through the ReviewIssue channel; richer gate UX is Round 3.
- **No density work on AuditLog / CrossSell / ServiceDesk / Calls** (amendment 8 retargets, it does not grow). Two table vocabularies coexist for one round, by design.
- **No auto-apply of VERIFIED facts.** Everything proposes; a human settles. Revisited in Round 3 with calibration data and the SERUM ADR outcome.
- **No replatform, no schema fusion, no shell rebuild.** Settled unanimously by the prior panel; BidStack survives.

---

## The first pull request — files, body, evidence

**PR #1 — `chore(web): tailwind 4.0.0-beta.7 -> 4.x stable + tailwind-merge v3`**
Branch `feat/crm-design-fusion` → `origin/demo`. One commit, nothing else rides along.

**Files:**
- `apps/web/package.json` — `tailwindcss` `4.0.0-beta.7` → `4.x` stable; `tailwind-merge` → `^3`
- `pnpm-lock.yaml`
- (only if the stable compiler demands it) mechanical syntax fixes inside `apps/web/src/index.css`, each listed in the PR body

**PR body:**

> **Why now:** the Round-2 graft (18 files from trycompai/crm) uses Tailwind v4-stable idioms — `data-[state=open]:` variants, paren shorthands, container queries (`@container/stats`). Bumping first beats downshifting 20+ files, and isolates the risk in one revertible commit (per the Round-2 plan, Phase 0.1).
>
> **Decision gate (48h):** if this PR cannot go green with zero visual drift by end of day 2, it closes and the fallback executes: stay on beta.7, graft written in `[var(--x)]` arbitrary syntax (+~1 day, pre-priced). No graft file lands before this decision is taken.
>
> **Evidence attached:**
> - `tsc --noEmit` clean; `eslint . --quiet` clean (design-law rules `no-theme-variant-geometry` / `no-foreign-token-vocabulary` / `no-raw-hex-in-classname` still pass — `packages/eslint-rules/design-law.js`)
> - ~1,890 unit tests green
> - All 61 integration files green on the isolated fast Postgres (`pgvector/pgvector:pg16` on tmpfs at `:5434`, migrate + seed — `docs/FEATURE-TEST-REPORT.md:243`; the shared DB's 30-70s/query cannot run them)
> - e2e: `E2E_WORKERS=4 pnpm --filter @bidstack/web exec playwright test --project=chromium-desktop` against `:5434` — 102 chromium tests green (`docs/FEATURE-TEST-REPORT.md:260,265`)
> - Dual-theme screenshot diffs (light + dark): Sidebar, Topbar, DashboardPage (cockpit.css route chunk), ProposalsPage, BidNoBidPage, ComplianceMatrix, ReferencesPage — pixel-identical or each divergence itemized
> - Verified untouched by the bump: dark brand `#5e6ad2` (`apps/web/src/index.css:195`), `pointer-coarse` variant (`:29`), 44px rule (`:536-541` — scoped in the *next* PR, not this one), `@theme` bridge (`:354`)
>
> **What this unblocks:** PR #2 `fix(web): scope 44px touch-target rule to pointer-coarse` + `feat(web): bridge --color-fg-inverted`; PR #3 `feat(db): BidFact + BidFactCitation + BidFactDecision immutable ledger`; then the two tracks run in parallel per the Round-2 plan.
>
> Round 1 baseline this stacks on: `9cb2b5e6..3cf26d22` (design-asset salvage, SEC-1, theme-invariant geometry, unknown-not-bad, design-law lint) — verified green before this PR.

---

**Verification appendix (claims checked in this pass, beyond the mining dossier):** Round-1 commits `git log origin/demo..HEAD` = 5 (3cf26d22, 11e18280, 6011c2c2, e73df439, 9cb2b5e6). SERUM: `approvalConfirmed` denial at serum-runtime-policy.ts:781-787, write/autonomous denial at :789-796, allowlist :797-803, concurrency :805-811. Compliance-fill: bare `requirementText` prompt :95-105, direct `answerDraft` write :134-146, UNAVAILABLE fallback :147-158, `doNotRetry` :85-87. Schema: `AssessmentStatus` 1453-1459; `Requirement.sourceChunkId` 1623, `confidenceBps` 1632; `ComplianceMatrixRow.answerDraft` 1668, `confidenceBps` 1671, `assessmentStatus` 1672, `evidence` 1673, `citations` 1674; `ReviewIssue` 1693. Evidence math: evidence.ts:93 (CEILING), :95 (0.45), :97 (floors), :109-118 (clamp), :128-133 (bandFor + hasPrimary). decideFact: contacts.service.ts:432-487 (409 at :451-453, supersede :460-467, decidedBy :470-477, column write :479-484). Approval gate: rfp-pipeline.ts:295-302 (approved guard), :429-490 (transaction), :495-505 (Art. 50). facts.ts gate: dismissed :96-109, no-op :111-122, humanOwns :126-135, VERIFIED-applies :137. claimDue: tasks.ts:20 (lease), :22 (attempts), :24-46 (SKIP LOCKED). design-law rules + tokens: design-law.js:62-71, :76-84, rule ids no-raw-button-strings/no-theme-variant-geometry/no-foreign-token-vocabulary/no-raw-hex-in-classname. index.css: pointer-coarse :29, dark brand :195, `--fg-inverted` :71/:233, `@theme` :354, 44px :536-541. Files: data-table 604 lines, Carbon imports :3-9, useQueryState :159-171; suggestion.tsx props :10-21; MOTION_BY_ICON icon.tsx:35-69, fallback :75-78; graft-set `wc -l` sum 2,218; `rg tanstack packages/ui` = 0. nuqs 2.9.4 `dist/adapters/react-router` present. Icon call sites 342 across 128 files. Four surfaces exist (`ProposalsPage.tsx` 8.5K GlassCard :6; `BidNoBidPage.tsx` 12.5K grid :273, zero tables; `ReferencesPage.tsx` 13.4K grid :185/:208; `ComplianceMatrix.tsx` 93 lines). Locales: **seven** (`ar en es fr it pt zh`). Fast DB + suite counts: FEATURE-TEST-REPORT.md:238 (60 int + 51 e2e files), :243 (recipe), :247-253 (61 files green), :260 (102 chromium), :265 (command). Topbar TODO :46-51; Sidebar `?tab=` matching ~:310-328; ADR 0002 brand note ("both pass", code `#5e6ad2`).