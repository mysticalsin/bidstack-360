# PLAN — BidStack demo-feedback program (WALTEUR v8.5 brownfield)

**Date:** 2026-06-12 · **Branch:** `demo` · **Mode:** /goal autopilot (Chief self-signs; Tony away)
**Source of truth:** Tony's demo-feedback brief (2026-06-12 session message) + `walteur-kit/recon-demo-feedback.json` (14-area recon).
**Prior program:** `walteur-kit/PLAN-2026-06-10-fullreview.md` (54-finding audit, waves 1–4 shipped).

## Design doc

**① Why** — Demo session feedback: BidStack is a *pre-sales bid piloting tool*, not a CRM/ERP. Strip quote-to-cash + innovation clutter, make the account view the core with explicit data-source separation, add the pre-sales governance features managers actually asked for. Success = every brief item traced to a shipped task or a signed report-only line, gates green.

**② Scope**
- IN: remove SalesOrders(Quotations)/Products/Invoices/RFP-Agent; minimal global dashboard; account-view external/internal split; signal-coverage explainability; flagged revenue + win/loss blocks; Top-10 curation; ABC filter rules config; access-scoping layer; cross-sell log; sector view; comitology log; Spotlight-Ref receiving end; InfoSearch MCP (flag-gated); 360Learning toolkits (flag-gated); bid/no-bid scoring upgrade; feature-flag wiring; CRM-wording purge; Azure-readiness config docs.
- OUT (signed): live ABC/Opportunity-Management connectors (no API access yet — flags hide dependent blocks); Spotlight Ref ingestion pipeline (stub + TODO per brief); real Azure deploy (group security validation pending — mock/seed data only until then); InfoSearch/360L live credentials (env-gated, graceful hide).
- Analytics report-builder backend (uncommitted WIP from prior session): KEPT — closes prior-audit critical C5; not part of this brief but committed as Wave 0 baseline after its review findings are fixed.

**③ Architecture decisions (ADR-lite, recorded here)**
1. **"Quotes section" = the live `Quotations & Orders` SalesOrder module** + 3 dead Quote* Prisma models. Products are REQUIRED FKs of order lines; invoices hang off orders. ⇒ delete the whole Odoo-style quote-to-cash vertical (sales-orders, products, invoices, payments) in one wave + one generated drop migration. Evidence: recon `quotes`/`products`/`invoices`.
2. **"RFP Agent" = the Dust-agent squad + NocoBase proxy cluster** (AgentsPage, RfpAgentsPage, /agents + /rfp-nocobase routes, Agent/AgentRun/RfpAgentAssignment). The core RFP pipeline (RfpPipelinePage, rfp-engine) STAYS — it is the product's bid backbone, not the innovation feature. Surgical decouple: dust-agent.service + schemas/agent.ts imports.
3. **Sales Dashboard**: /sales page + /api/sales-dashboard backend die with the module (their KPIs are quotations/orders/AR). Global OrgDashboard goes minimal: fabricated widgets (WorkspaceHealthCard composite, WeeklyGoalCard hardcoded 500k) removed; account-centric essentials stay. Landing stays `/dashboard` (8 auth redirect paths untouched) but dashboard now funnels to accounts.
4. **Feature flags**: env-driven (existing env.ts Zod pattern) + `GET /api/v1/config/features` so the SPA reads runtime flags without rebuild. Flags: `WIN_LOSS_DATA_AVAILABLE`, `SHOW_REVENUE_BLOCK`, `INFOSEARCH_ENABLED`, `LMS_360L_ENABLED` (env names can't start with a digit — `360L_*` brief names become `LMS_360L_API_KEY`/`LMS_360L_BASE_URL`, documented).
5. **Manual override layer** (external→internal promotion): new `CompanyFieldOverride` model (orgId, companyId, fieldKey, value Json, overriddenBy, overriddenAt) — cockpit merges Apollo data with overrides and flags them. Simplest correct; avoids mutating enrichment snapshots.
6. **Top-10 curation**: reuse dormant `Company.topAccountRank` column + admin Settings editor + `/accounts/top` returns curated ranks when present (auto-leaderboard fallback labeled "auto").
7. **Access scoping**: new `UserGroup`/`UserGroupMember` + group→scope rules (country/team) applied as read filters on accounts/opportunities lists. Honest limit: source-system (ABC/OM) group sync is a connector we cannot build yet — groups are admin-managed; mapping table ready for the connector. Gate: no real client data until security validation (already the deployment posture).
8. **Bid/No-Bid**: single criteria registry moves to `packages/shared` (6 brief criteria + weights), backend recomputes, override-below-threshold requires justification, persisted + audit-logged + surfaced to directors via existing notification prefs (in-app list + opportunity detail breakdown).

**④ Edge cases** — (a) deleted-table rows referenced by audit-logs/custom-fields/webhook enums → tolerant parsing + cleanup noted, audit history preserved (targetType strings stay valid as text); (b) flag OFF → blocks fully hidden, never empty states (brief demand); (c) widget references deleted report (analytics) → SetNull handled; (d) demo seed: sales-order/invoice/product fixtures removed from seed path so `db:reset` stays green; (e) e2e nav assertions updated with nav changes.

**⑤ Test matrix** — per wave: unit (engine/scoring/flags), integration (routes incl. negative org-scope), web unit (pages/sections render all states), e2e nav smoke updated; full gates in Wave V (typecheck, lint, root test ≥600s, build:demo).

**⑥ Risks** — drop migration is destructive on demo DB (Railway runs migrate on boot) — acceptable, demo data reseeds; biggest blast radius = sales-intelligence report shared by cockpit (trim carefully, keep wire schema compiling); RFP-Agent decouple touches Wave-4 AI assistant imports; criteria registry change invalidates old persisted BidScores (reads stay tolerant — read/write contract split per MISTAKES ledger).

**⑦ Open questions** — none blocking; all resolved by evidence above. Brief ambiguities resolved to simplest defensible reading and recorded in ③.

## Task matrix

Status: [ ] open · [x] done+verified · [~] in progress · [R] report-only

### Wave 0 — baseline (analytics WIP + hygiene)
- [~] T0.1 Analytics migration generated+applied; analytics tests green; fix confirmed review findings (wf_21553843); commit WIP. — opus
- [x] T0.2 Lint root-cause fixed (.vercel eslint ignore + no-fallthrough); typecheck green. — sonnet

### Wave R — REMOVE (one commit per cluster; generated drop migration last)
- [ ] R1 Delete sales-orders module: pages/hooks/routes/services/tests/seeds/nav/i18n/e2e refs (recon `quotes` file list). — sonnet
- [ ] R2 Delete products module + RBAC seed perms + top-products surfaces (recon `products`). — sonnet
- [ ] R3 Delete invoices+payments module + ArAgingCard + dead crm/invoices.service.ts + webhook enum tolerance (recon `invoices`). — sonnet
- [ ] R4 Delete /sales dashboard page + /api/sales-dashboard backend + trim sales-intelligence report (quotation KPIs out; cockpit SalesIntelligencePanel removed); OrgDashboard minimal (drop fabricated WorkspaceHealth/WeeklyGoal/TopAccountsCard-fake). — opus (shared wire schema surgery)
- [ ] R5 Delete RFP-Agent cluster (agents pages/routes/services/models/nocobase client/schemas) + decouple dust-agent.service + schemas/agent.ts + mutation-audit prefix + rbac seeds + palette/nav. RfpPipelinePage stays. — opus (cross-imports)
- [ ] R6 Schema: drop Quote/QuoteLine/QuoteVersion/Product/ProductCategory/SalesOrder/SalesOrderLine/Invoice/InvoiceLine/Payment/Agent/AgentRun/RfpAgentAssignment + enums; generated drop migration via migrate diff; db:generate; shared build. — opus (destructive, generated-only)
- [ ] R7 CRM-wording purge (~45 strings: logo tagline, demo hero, Enter-CRM button, manifest, tour, error copy, API brief/Slack/Dust copy) → "bid piloting" vocabulary; 4 pinned test files updated in lockstep. — sonnet
- [ ] R8 Wave-R gates: typecheck+lint+API/web tests touched-suites green; commit. — sonnet

### Wave M — MODIFY (account core)
- [ ] M1 Cockpit split: "External Intelligence" block (Apollo: tech stack/employees/revenue/financial health + "Last updated" + stale badge) vs "Internal Data" block (projects/opportunities/won-lost); never mixed. `CompanyFieldOverride` model + PATCH endpoint; edited field renders in Internal with "manually overridden" flag. — opus
- [ ] M2 Signal Coverage real scoring: server-side 4-factor function (firmographic coverage, contact coverage, engagement recency, pipeline data quality) each with band+label+what-it-measures+recommended action; expandable panel UI; replaces hardcoded 72. — opus
- [ ] M3 Revenue+evolution block behind SHOW_REVENUE_BLOCK (default false ⇒ hidden entirely, no empty state); ABC-API data source stub documented. — sonnet
- [ ] M4 Win/Loss block behind WIN_LOSS_DATA_AVAILABLE (default false ⇒ hidden). — sonnet
- [ ] M5 Top Accounts curation: admin Settings editor writes topAccountRank (top-10), /accounts/top serves curated list (auto fallback labeled); Top vs Key visual distinction (badges) everywhere both appear. — sonnet
- [ ] M6 ABC opportunity filter rules in Settings: org-scoped config (first GET/PUT /api/v1/org-settings route; expertise-vs-solution type, framework/agreement type rules), filters applied to opportunity pulls. — opus (new org-settings surface)
- [ ] M7 Access-scoping layer: UserGroup/UserGroupMember/GroupScopeRule models + read-filter middleware on accounts+opportunities lists + admin Settings groups editor + seeds + negative tests. — opus (security)
- [ ] M8 Bid/No-Bid upgrade: shared criteria registry (payment_terms, deal_size, resource_avail, strategic_fit, financial_risk, competitive); composite+per-criteria breakdown on opportunity detail; below-threshold override w/ mandatory justification, persisted+audit-logged+director-visible; fix divisor/threshold divergences. — opus
- [ ] M9 Wave-M gates + commit. — sonnet

### Wave A — ADD
- [ ] A1 Feature-flag spine: env.ts additions + GET /api/v1/config/features + web useFeatureFlags hook; flags wired. — sonnet (FIRST — M3/M4/A5/A6 depend)
- [ ] A2 Cross-sell action log: model+routes+page+nav+account section (account, description, requesting/assigned country-team, assignee, due date, status, notes). — sonnet
- [ ] A3 Sector/Industry view: aggregation endpoint (industry × country, account count, FTE volume) + page + nav + data-quality warning banner. — sonnet
- [ ] A4 Comitology log: GovernanceMeeting + actions models+routes+account section+page (meeting type/date/participants/outcomes/actions w/ owner+due+status). — sonnet
- [ ] A5 Spotlight Ref receiving end: ProjectReference model+display section per account+ingestion stub with TODO. — sonnet
- [ ] A6 InfoSearch MCP integration: client (odoo-mcp-client pattern), INFOSEARCH_MCP_URL/INFOSEARCH_API_KEY/INFOSEARCH_ENABLED, account-page leads section, activity webhook event on account view, graceful hide. — opus (external integration)
- [ ] A7 Sales Toolkits LMS: 360Learning client (dust-client pattern), LMS_360L_API_KEY/LMS_360L_BASE_URL + LMS_360L_ENABLED, nav section, live course grid filtered by sector tag, new-tab links, "Connect LMS" prompt + Settings config when unset. — opus (external integration)
- [ ] A8 Schema migration for A2–A5 models (one generated migration); seeds for demo. — sonnet
- [ ] A9 Wave-A gates + commit. — sonnet

### Wave V — VERIFY + SHIP
- [ ] V1 Full gates: pnpm typecheck · lint · test (≥600s, db:generate preflight) · build:demo.
- [ ] V2 Senior panel (PM/UIUX/FullStack/Security/Growth) on the program diff; fix vetoes.
- [ ] V3 Terminal audit (fresh adversarial pass, brief-trace: every feedback line → task/report-only).
- [ ] V4 Azure-readiness: env-var config documented (infra/azure notes honest), mock/seed-data posture stated; update _relay/BATON.md + honest final report.

## Definition of Done
Every brief line traces to a ☑ task or a signed OUT line · gates green with fresh output shown · no empty-state blocks where flags are OFF · org-scoping on every new query · dark mode + a11y states on every new component · known gaps stated honestly.
