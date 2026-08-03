# BidStack full feature test — report

## Verdict

**YES — the round‑1 fusion work is verified safe to keep.** All four fusion changes passed at every layer that could execute on this box, and no fusion‑touched test is red. Deciding numbers:

| Fusion change | Proof that ran this session | Result |
|---|---|---|
| **SEC‑1** (demo‑session takeover fix) | `penetration.demo-session.test.ts`, DB‑free, live | **8/8 PASS** in 1.15s (5 takeover‑blocked + 3 legit‑resume). Email‑only minting gone; claimed email without a server‑signed resume proof → 409, no token minted. |
| **unknown ≠ bad** (fallback assessment) | `rfp-fallback-assessment.test.ts` (in worker suite) | **5/5 PASS**. fallbackCompliance→UNAVAILABLE+null, fallbackQa→scoreBps null, analytics mean([9000,8000,null]) = **8500, not** zero‑coerced 5666.67. |
| **design‑law lint** | `pnpm lint` + web `eslint src` | **0 errors** workspace‑wide. The two error‑level fusion rules (`no-theme-variant-geometry`, `no-foreign-token-vocabulary`) produced **zero** violations. 28 warnings = pre‑existing hex‑in‑classname debt only. |
| **tokens / geometry** | `accent.test.ts` (green) + live smoke | Light↔dark geometry **pixel‑identical** (cards/buttons/badges aligned, only colours change); no "Created by Tony" in sidebar. |

Static baseline held: **typecheck 11/11 green (zero regressions), builds 5/5 green.** Roughly **1,890 tests executed and passed** this session. The one BROKEN finding in the whole audit (Slack **Events** API HMAC) and the Zapier registration gap are **pre‑existing and unrelated to fusion**.

Honesty caveat that keeps this from reading as "everything passed": the four fusion changes are proven at the **unit / static / live‑smoke** layer. The DB‑backed **integration + e2e** layers — where the fusion contract's API‑boundary assertion lives (`bid-workspace.integration.test.ts:246‑247`, PENDING/null before fill) — **could not run** here except one probe. That is a coverage gap, not a failure (details below).

---

## Coverage scoreboard

| Layer | Test files | Ran | Tests passed | Env‑blocked | Result |
|---|---:|---:|---:|---:|---|
| Static — typecheck (tsc, 11 projects) | 11 | 11 | 11 proj | 0 | **GREEN** |
| Static — eslint (workspace + design‑law) | 11 (+1 no‑lint) | 11 | 0 errors | 0 | **GREEN** (28 warns, pre‑existing) |
| Static — builds (shared/db/dust/odoo/web) | 5 | 5 | 5 | 0 | **GREEN** |
| Web unit (vitest, happy‑dom) | 112 | 112 | **593** | 0 | **GREEN** |
| Worker (vitest) | 48 | 48 | **415** | 0 | **GREEN** |
| @bidstack/shared | 21 | 21 | **175** | 0 | **GREEN** |
| @bidstack/api unit (`--exclude integration`) | 84 | 84 | **618** | 0 | **GREEN** (4 first‑run DB flakes cleared on rerun) |
| @bidstack/db | 8 | 8 | 76 | **1** | **BLOCKED‑ENV** (pii‑encryption integration) |
| @bidstack/dust‑client | 2 | 2 | 10 | 0 | **GREEN** |
| Pentest (⊂ api‑84) | 4 | 4 | **27** | 0 | **GREEN** (demo‑session 8/8 live, DB‑free) |
| **API integration** (`*.integration.test.ts`) | **61** | **1** | 3 (probe) | **60** | **PARTIAL — env** |
| **E2E** (playwright `*.spec.ts`) | **51** | **0** | 0 (421 enumerated) | **51** | **UNRUN — env** |

**Totals:** ~**1,890 tests passed**; **1** env‑blocked failure; **4** timing flakes that cleared on rerun; **0** code failures. **DB‑backed gap: 111 files could not run here** (60 of 61 API integration + all 51 e2e). Not run ≠ passed — see the env‑blocked section.

---

## Feature matrix by domain

Legend — **Cov:** COVERED / PARTIAL / UNCOVERED · **Suite (this session):** `unit✓` a unit/component test ran green · `int-env` integration test exists but env‑blocked · `int✓` integration ran green · `e2e-env` e2e exists, unrun · `none` no test · `exists*` test present but not executed this session · **Live:** WORKS / SLOW‑DB / N/C (not checked) / **BROKEN**.

### Domain 1 — Sales / Pipeline / Accounts / Contacts (30)

| Feature | Cov | Suite | Live |
|---|---|---|---|
| Opportunities — list & filter/search | COVERED | unit✓(web) · int-env · e2e-env | N/C |
| Opportunities — create | COVERED | e2e-env (no api‑unit) | N/C |
| Opportunities — edit / detail (optimistic concurrency) | COVERED | int-env | N/C |
| Opportunities — stage move | COVERED | int-env | N/C |
| Pipeline board (kanban) | COVERED | unit✓(web) · e2e-env | N/C |
| Pipeline stages config (define/reorder) | **UNCOVERED** | none | N/C |
| Opportunities — export CSV | COVERED | int-env | N/C |
| Opportunities — brief generation | COVERED | unit✓(api) · int-env | N/C |
| Opportunity timeline | COVERED | unit✓(web+api) | N/C |
| Opportunity contacts (link) | **UNCOVERED** | none | N/C |
| Accounts (key/top/industries/tier) | COVERED | unit✓(web) · int-env · e2e-env | N/C |
| Companies (CRUD + hierarchy) | COVERED | unit✓(api) | N/C |
| Company detail (+ technical‑stack) | COVERED | unit✓(api) · e2e-env | N/C |
| Contacts (CRUD + search) | COVERED | int-env · e2e-env | N/C |
| Tasks (CRUD + summary) | COVERED | int-env · e2e-env | N/C |
| Workload (team capacity) | COVERED | unit✓(web) · int-env | N/C |
| Leads (CRUD + convert) | COVERED | int-env · e2e-env | N/C |
| Forecasts (period/territory) | COVERED | int-env | N/C |
| Forecast projection (run‑rate) | PARTIAL | unit✓(helpers only) | N/C |
| Reports — report builder (saved) | COVERED | int-env · e2e-env | N/C |
| Reports — legacy canned aggregates | PARTIAL | int-env (only /pipeline) | N/C |
| Global search | COVERED | int-env · e2e-env | N/C |
| Win / Loss analysis | COVERED | unit✓(web) · int-env | N/C |
| Sector view | PARTIAL | unit✓(web only; no api test) | N/C |
| Cross‑sell recommendations | COVERED | unit✓(web) · int-env · e2e-env | N/C |
| Territories (CRUD + routing) | COVERED | unit✓(web) · int-env | N/C |
| Activities (cross‑entity timeline) | COVERED | int-env | N/C |
| Notes (+ import‑meeting) | COVERED | unit✓(api) | N/C |
| Saved views (per‑list filters) | **UNCOVERED** | none | N/C |
| CRM dashboard / summary (home) | COVERED | unit✓(web+api) | N/C |

### Domain 2 — Bids / RFP / Proposals / Compliance (20)

| Feature | Cov | Suite | Live |
|---|---|---|---|
| Bid/No‑Bid criteria registry (100‑weight matrix) | COVERED | unit✓(shared 12/12) | **WORKS** |
| Bid composite computation (`computeBidComposite`) | COVERED | unit✓(shared) | **WORKS** |
| Bid score persistence + versioning (P2002 retry) | COVERED | int-env | SLOW‑DB |
| Bid/No‑Bid override + director/VP escalation | COVERED | unit✓(contract) · int-env | **WORKS** (contract) |
| Bid score AI calibration + defend narrative | PARTIAL | int-env | SLOW‑DB |
| Proposals CRUD + lifecycle state machine | COVERED | int-env | SLOW‑DB |
| Proposal section drafting + admin analytics | PARTIAL | int-env (analytics unasserted) | SLOW‑DB |
| RFP document upload → pipeline kickoff | COVERED | int-env (9 skipIfNoDb) | SLOW‑DB |
| RFP orchestration state machine (FlowProducer) | COVERED | unit✓(worker) | N/C (not booted) |
| Requirement extraction (confidence + ASSESSED) | COVERED | unit✓(worker) | N/C |
| Compliance matrix — snapshot + per‑row edit | COVERED | int-env (PENDING/null assert) | SLOW‑DB |
| **Compliance autofill (unknown≠bad core)** | COVERED | **unit✓(worker 5/5)** · int-env | **WORKS** |
| **QA review (unknown≠bad 2nd fallback)** | COVERED | **unit✓(worker 5/5)** | **WORKS** |
| Approval gate (EU AI Act Art.50 HITL) | COVERED | int-env (12 skipIfNoDb) | SLOW‑DB |
| RFP live progress (SSE, LISTEN/NOTIFY) | COVERED | int-env (5 skipIfNoDb) | SLOW‑DB |
| Bid workspace snapshot + document register | COVERED | int-env · unit✓(worker chunk) | SLOW‑DB |
| RFP draft / proposal drafting surface (7 endpoints) | PARTIAL | unit✓(worker) · **no int test on endpoints** | N/C |
| RFP legal scan / review crew | COVERED | unit✓(worker) | N/C |
| Win/Loss + pattern mining + outcome record | COVERED | unit✓(web) · int-env | SLOW‑DB |
| **Fusion schema contract (AssessmentStatus + nullable confidenceBps)** | COVERED | **unit✓(worker)** · int-env(API boundary) | **WORKS** |

### Domain 3 — Settings / Workspace / Admin / Data‑config (26)

| Feature | Cov | Suite | Live |
|---|---|---|---|
| Settings shell (tabbed, admin‑gated) | COVERED | unit✓(web) | **WORKS** |
| Overview tab (aggregate + deep‑link) | COVERED | unit✓(web) | **WORKS** |
| SERUM control plane (draft/test/publish/approve/rollback) | COVERED | int-env | SLOW‑DB |
| **Appearance + design‑law geometry lint (fusion)** | PARTIAL | lint✓ (no unit on section) | **WORKS** |
| Notifications preferences | COVERED | int-env | SLOW‑DB |
| Profile & Security | PARTIAL | unit✓(render only) | N/C |
| Workspace (org/team/roles/currency/locale) | COVERED | unit✓(web) · int-env | **WORKS** |
| Data configuration parent | PARTIAL | int-env | SLOW‑DB |
| Custom fields (defs + values) | **UNCOVERED** | none | N/C |
| Pipeline stages (CRUD, reorder) | PARTIAL | int-env (indirect only) | N/C |
| Tags (CRUD + apply/suggest) | COVERED | unit✓(web) · int-env | **WORKS** |
| Email templates (CRUD + render) | COVERED | int-env | SLOW‑DB |
| Lead rot config | COVERED | int-env | SLOW‑DB |
| Data import (CSV wizard) | PARTIAL | int-env (migration routes) | N/C |
| Top accounts (curated top‑10) | COVERED | int-env | SLOW‑DB |
| Access groups (CRUD + membership) | COVERED | int-env | SLOW‑DB |
| Opportunity filters (org‑level) | COVERED | int-env | SLOW‑DB |
| RFP Analytics (admin) | PARTIAL | int-env (not section‑scoped) | SLOW‑DB |
| Modules (app‑module toggle) | COVERED | int-env | SLOW‑DB |
| Integrations (connector catalog, Dust) | PARTIAL | unit✓(api dust) · connectors untested | SLOW‑DB |
| Webhooks / event subscriptions | COVERED | int-env | SLOW‑DB |
| Audit log (filterable) | COVERED | unit✓(api) · e2e-env | SLOW‑DB |
| Developer access / API keys | COVERED | unit✓(web) | **WORKS** |
| Roles / RBAC (roles + permission matrix) | COVERED | unit✓(api) · int-env · e2e-env | SLOW‑DB |
| Custom objects admin (defs + records) | PARTIAL | int-env | SLOW‑DB |
| Data source / provider credentials | **UNCOVERED** | none | N/C |

### Domain 4 — Integrations / AI / MCP / Extension (27)

| Feature | Cov | Suite | Live |
|---|---|---|---|
| Dust AI — inbound webhook receiver (HMAC/dedup/replay) | COVERED | unit✓(dust hmac) · int-env | SLOW‑DB |
| Dust AI — dust‑client package | COVERED | unit✓(10/10) | **WORKS** |
| Dust AI — integration mgmt routes | PARTIAL | unit✓(api) | N/C |
| Dust AI — AI Assistant (Dust‑agent) | **UNCOVERED** | none (route‑level) | N/C |
| Dust AI — persistence DustRun / AiInsight | **UNCOVERED** | none | N/C |
| Clerk org bootstrap webhook (Svix HMAC) | COVERED | unit✓(api) · int-env | **WORKS** |
| **DocuSign Connect webhook [recent CRITICAL fix]** | **UNCOVERED** | **none (fail‑closed HMAC untested)** | WORKS (code‑correct) |
| Zoom call webhook + oracle guard [CRITICAL fix] | COVERED | unit✓(4 tests) | **WORKS** |
| MS Graph mail webhook (clientState) | **UNCOVERED** | none | N/C |
| MS Teams call webhook (clientState) | **UNCOVERED** | none | N/C |
| Twilio Voice webhook (X‑Twilio‑Signature) | COVERED | unit✓(service) | **WORKS** |
| Twilio SMS status callback | COVERED | unit✓(service) | N/C |
| Twilio SMS inbound (STOP/opt‑out) | COVERED | unit✓(service) | N/C |
| Slack slash commands (`/bidstack`) | **UNCOVERED** | none | N/C |
| **Slack Events API (channel/member)** | **UNCOVERED** | none | **BROKEN** |
| Outbound webhooks — subscription CRUD (SSRF‑guarded) | COVERED | int-env | SLOW‑DB |
| Outbound webhooks — delivery fan‑out + HMAC | PARTIAL | unit✓(worker) | N/C |
| Zapier integration (REST‑hooks) | **UNCOVERED** | none (+ **registration gap**) | N/C |
| Odoo MCP client | COVERED | exists* (not run) | N/C |
| ERP / Odoo MCP routes (ERP_ENABLED‑gated) | COVERED | unit✓(api) | N/C |
| MCP server (34 tools, scoped keys) | COVERED | exists* (not run) | N/C |
| Chrome extension (MV3) | **UNCOVERED** | none | N/C |
| SDK — Go | PARTIAL | exists* (not run) | N/C |
| SDK — Python | COVERED | exists* (not run) | N/C |
| SDK — Ruby | COVERED | exists* (not run) | N/C |
| Currency / exchange‑rates | COVERED | unit✓(api) | **WORKS** |
| Notifications (in‑app feed + prefs) | COVERED | int-env | SLOW‑DB |

### Domain 5 — Auth / Tenancy / Security (18)

| Feature | Cov | Suite | Live |
|---|---|---|---|
| Clerk JWT auth (production, verifyToken every req) | COVERED | unit✓(api) · int-env | N/C |
| Stub auth (dev/test, loopback‑gated) | COVERED | unit✓(api) | N/C |
| Demo mode auth (HMAC Bearer, per‑visitor org) | COVERED | unit✓(pentest 8/8) | **WORKS** |
| **SEC‑1 demo‑session takeover fix (resume‑proof)** | COVERED | **unit✓(8/8 live)** | **WORKS** |
| Tenant isolation (org scoping, IDOR→404) | COVERED | int-env (pentest) | N/C |
| Access‑scope data scoping (country/group union) | PARTIAL | int-env (no unit on helpers) | N/C |
| Tenant‑scope‑guard Prisma middleware | COVERED | unit✓(db) | N/C |
| RBAC enforcement (no claim fallback, ADR‑0001) | COVERED | unit✓(api, 294 sites) · e2e-env | N/C |
| Audit logging (auth events) | COVERED | unit✓(api) | N/C |
| Audit immutability (INSERT‑only AuditLog) | COVERED | unit✓(db + worker) | N/C |
| Mutation audit plugin | COVERED | unit✓(api) | N/C |
| Audit log read API (perm‑gated) | COVERED | unit✓(api) · e2e-env | N/C |
| Rate limiting (per‑tenant keyGen, Redis fail‑loud) | PARTIAL | unit✓(mcp limiter only) | N/C |
| API‑key auth (sha256, scope‑bounded) | COVERED | unit✓(api) | N/C |
| Penetration suite (authz/injection/demo/webhook) | COVERED | unit✓(27/27; demo 8/8 live) | **WORKS** |
| Clerk inbound webhook (svix HMAC + replay) | COVERED | unit✓(api) · int-env | N/C |
| SSO domain restriction (allowlist, pre‑cache) | COVERED | unit✓(api) | N/C |
| Security headers + CORS (helmet/CSP/HSTS) | COVERED | unit✓(api) | N/C |

---

## Proven green (ran + passed this session)

- **Static:** typecheck **11/11** projects, eslint **0 errors** (design‑law error rules clean), **5/5** builds.
- **Unit/component:** web **593/593** · worker **415/415** · shared **175/175** · api unit **618/618** · db **76/77** · dust‑client **10/10** · pentest **27/27**. ≈**1,890 tests**.
- **The four fusion changes specifically:** SEC‑1 demo‑session **8/8** (DB‑free, live); unknown≠bad `rfp-fallback-assessment` **5/5**; design‑law lint **0 errors**; token/geometry via `accent.test.ts` + live smoke (identical light/dark geometry).
- **All worker‑side RFP logic** (orchestrator, requirement‑extract, review‑crew, story‑match, embed, compliance‑fill, qa‑review, document‑extract) executed green as unit tests — it just wasn't booted against live Redis/queues.
- **Live smoke:** 6 Settings tabs, nav (5 groups), Bid/No‑Bid matrix (18 real opportunities, all 10 weighted criteria), Proposals — all rendered real data, **zero console errors**.

## Covered but unrun (env‑blocked) — and how to run them

The DB layer is the honest gap. **111 test files exist and could not execute here:** **60 of 61** API `*.integration.test.ts` and **all 51** e2e `*.spec.ts` (421 tests enumerated). Only **one** integration file was coaxed to run — `bid-workspace.integration.test.ts`, **3/3 green but 65.68s** for three endpoints — proving the shared Postgres `:5433` is the blocker, not the code (matches the box's Lead.count 70s / Proposal.findMany 37s pathology; the db `pii-field-encryption` failure is the same signature). This is why heavy suites (leads/opportunities/proposals/approval‑gate/SSE) are **SLOW‑DB**, not verified.

**What would run them: a fast, isolated Postgres** (not the shared instance). Concretely:
1. Spin a disposable local PG (e.g. Docker `postgres:16` on a dedicated port, ideally tmpfs/in‑memory) and point `DATABASE_URL` at it.
2. `pnpm db:migrate && pnpm db:seed`.
3. Integration: `pnpm --filter @bidstack/api exec vitest run '**/*.integration.test.ts'` (61 files) — including the fusion API‑boundary assertion at `bid-workspace.integration.test.ts:246‑247`.
4. E2E: `pnpm --filter @bidstack/web exec playwright test` (51 files/421 tests; the config auto‑boots API + web preview, needs the DB healthy within 120s — feasible only on a fast DB).

On a fast DB the probe's ~22s/test collapses to low single digits, making the full 61 + 51 tractable. Until then, these layers are **covered, not passed** — do not read them as green.

## Uncovered features (real gaps worth writing)

Ranked by risk:

1. **DocuSign Connect webhook — HMAC fail‑closed path.** A **recent CRITICAL fix** (commit f034a0e8) that makes an unset key *throw* instead of accepting forged webhooks that flip `SignatureRequest→SIGNED` — and it ships with **no test** asserting unset‑key‑throws / unsigned‑reject. Highest‑value test to add; a silent regression re‑opens the vuln.
2. **Slack Events API** — uncovered **and BROKEN** (see below). Needs a raw‑body fix *and* a signature test.
3. **Microsoft Graph mail + Teams webhooks** — clientState anti‑forgery, security‑sensitive, zero tests on `verifyClientState`.
4. **Slack slash commands** — HMAC + raw‑body handling, no test.
5. **Zapier** — no tests, plus verify the router is actually registered in `server.routes.ts`.
6. **CRUD endpoints with no test at all:** Custom fields, Saved views, Opportunity contacts, Pipeline‑stages config, Data‑provider credentials.
7. **Dust AI Assistant routes** and **DustRun/AiInsight persistence** — no route‑level coverage.
8. Lower priority: Chrome extension (MV3), SDK Go, MCP‑server tests exist but weren't executed this pass.

## Live smoke findings

No BROKEN findings in the browser. Settings (Overview, Appearance, Workspace, Data‑config, Developer, Audit) all rendered real data; nav's 5 groups expanded and routed; `/bid-matrix` fully interactive with 18 real opportunities and all 10 weighted criteria; `/proposals` loaded 2 proposals with status tabs; **zero console errors** anywhere (only two benign first‑load warnings). Both fusion‑design assertions **CONFIRMED**: light↔dark geometry pixel‑identical; no "Created by Tony" string. Not loaded this pass (NOT‑CHECKED, not failures): Dashboard, heavy list pages, Calendar, Analytics, Workflows, and ~11 other Settings tabs — deprioritized per slow‑DB guidance.

## Blockers for the round‑1 commits

**None.** The four round‑1 fusion changes (SEC‑1, tokens/geometry, unknown≠bad, design‑law lint) are all proven green at every layer that could run here, plus confirmed in live smoke, with zero regressions to the static baseline. Keep the commits.

Two **non‑blocking** flags to file as follow‑ups (both **pre‑existing, unrelated to fusion**):
- **`slack.ts:404` — latent HMAC bug (`BROKEN`).** The Slack **Events** route computes `JSON.stringify(req.body)` and HMACs that, with **no `addContentTypeParser`** raw‑body parser — the exact re‑serialization anti‑pattern that `slack-commands.ts` / `webhooks.ts` / `signatures.ts` already fixed. Legitimate Slack events would fail signature (403). Not shipped by round‑1; fix independently.
- **Zapier router registration gap** — `zapierRoutes` is defined but was not found registered in `server.routes.ts`; verify before relying on it.

And the standing **environment** limitation (not a code blocker): 111 DB‑backed files (60 integration + 51 e2e) remain unverified until run against a fast/isolated Postgres.
---

# APPENDIX — DB-backed gap CLOSED (fast isolated Postgres)

The original report's honest gap (111 DB-backed files unrunnable on the shared 30-70s/query Postgres) was closed by provisioning an isolated `pgvector/pgvector:pg16` Postgres on tmpfs (:5434), applying all migrations + seed.

**Migration proof:** all migrations applied clean on the fresh DB — the `20260623000000_kam_foundation` "failed migration" that blocks `migrate deploy` on the shared instance is **local-state corruption, not a broken file**.

## Integration — ALL 61 files executed, ZERO real failures
| Run | Files | Tests | Result |
|---|---|---|---|
| 5-shard swarm | 41 | 250 | GREEN |
| remaining, batch 1 | 10 | 63 | GREEN |
| remaining, batch 2 | 8 | 71 | GREEN |
| collaboration (alone) | 1 | 9 | GREEN |

The fusion API-boundary assertion `bid-workspace.integration.test.ts:246-247` (PENDING/null before autofill) **ran and passed** against live Postgres (14s vs 65s-timeout on shared DB).

**One investigated non-failure:** batching 22 integration files into a single vitest process produced 2 `collaboration` reds (a legit comment reply → 403). Root cause: **`rbac-decision-cache` contamination across isolated orgs in one process** — a test-harness ordering artifact, which is exactly why the repo pins `fileParallelism: false`. Proven: collaboration passes **9/9 when run alone**. Not a product bug, not a fusion regression.

## E2E — bootable, core journeys green
Playwright auto-boots its own stack (API :4010 inheriting DATABASE_URL, web prod-build → preview :4174). Pointed at :5434: **102 chromium tests passed**, 8 failed, 28 skipped. The 8 failures, all **outside the fusion surface**:
1. `smoke.spec.ts` agents page — seed has no agent rows (data gap).
2. `reports.spec.ts` (6) — stale spec vs the shipped **Analytics** dashboard redesign.
3. `flows/esignature.spec.ts` — confirmation step needs the document worker + Redis (not booted in the lean run).

Full suite command: `E2E_WORKERS=4 pnpm --filter @bidstack/web exec playwright test --project=chromium-desktop` (add `E2E_DOCUMENT_WORKER=1` + `REDIS_URL` for e-signature).

## Final status
Round-1 fusion work is verified across **unit + integration + live** layers. No blocker. Pre-existing non-fusion follow-ups: Slack Events HMAC bug (`slack.ts:404`), DocuSign HMAC fail-closed test gap, stale reports e2e specs, agents/e-signature e2e env deps.
