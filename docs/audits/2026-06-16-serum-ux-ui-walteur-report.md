# 2026-06-16 SERUM UX/UI WALTEUR Report

## Scope

Implemented the first safe SERUM foundation slice from `C:/Users/Tony/Downloads/Codex Master Prompt v3.pdf`:

- Read-only SERUM control plane route: `/serum`.
- Admin settings entry: `/settings?tab=serum`.
- Real backend status endpoint: `GET /api/v1/serum/status`.
- Global click sound coverage, still governed by the existing Appearance setting.
- Premium SERUM Glass visual language using app-native CSS tokens and restrained motion.
- Global shell polish found during QA: 44px sidebar targets and warning-free mobile nav drawer animation.

This is not the full SERUM platform. Durable event ledgers, editable versioned config, tool registry execution, autonomous loops, memory promotion, approvals, and SERUM-specific eval suites remain future work.

## PDF Guardrails Applied

- No fake production activity, confidence, sources, or demo telemetry.
- `SERUM_ENABLED` defaults to `false`.
- `SERUM_DEMO_MODE_ENABLED` defaults to `false` and is blocked in production.
- No autonomous actions exposed.
- No legal, pricing, or client commitments generated.
- Server returns only boolean/status signals for sensitive integration state.
- Status responses use `Cache-Control: no-store`.

## Implementation Map

- Shared schemas: `packages/shared/src/schemas/serum.ts`.
- Feature flags: `packages/shared/src/schemas/feature-flags.ts`, `apps/api/src/routes/config-features.ts`.
- API env and route: `apps/api/src/env.ts`, `apps/api/src/routes/serum.ts`, `apps/api/src/server.routes.ts`.
- SERUM UI system: `apps/web/src/components/serum/SerumGlass.tsx`, `apps/web/src/index.css`.
- SERUM page and hook: `apps/web/src/pages/SerumMissionControlPage.tsx`, `apps/web/src/hooks/useSerumStatus.ts`.
- Settings page: `apps/web/src/components/settings/SerumControlPlaneSection.tsx`.
- Navigation: `apps/web/src/components/layout/navConfig.ts`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/routes/lazyPages.tsx`.
- Sound: `apps/web/src/components/sound/GlobalInteractionSound.tsx`, `apps/web/src/components/ui/Button.tsx`, `apps/web/src/components/ui/Tabs.tsx`, `apps/web/src/components/settings/AppearanceSection.tsx`.
- Segmented view switch QA fix: `apps/web/src/components/opportunity/PipelineViewSwitch.tsx`.

## QA Results

- `pnpm --filter @bidstack/shared exec tsc --noEmit`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit`: pass.
- `pnpm --filter @bidstack/shared exec vitest run src/schemas/serum.test.ts --reporter=dot`: 2 pass.
- `pnpm --filter @bidstack/web exec vitest run src/components/sound/GlobalInteractionSound.test.tsx src/hooks/useUiSound.test.ts src/lib/soundEngine.test.ts --reporter=dot`: 7 pass.
- `pnpm --filter @bidstack/web test -- --reporter=dot`: 290 pass.
- `pnpm --filter @bidstack/api test -- --reporter=dot`: 623 pass, 2 skipped due stub auth mode.
- `pnpm --filter @bidstack/shared test -- --reporter=dot`: 86 pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/critical-controls.spec.ts --project=chromium-desktop --reporter=line`: 2 pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/critical-controls.spec.ts e2e/flows/pipeline.spec.ts --project=chromium-desktop --reporter=list`: after the view-switch fix, critical controls pass independently; pipeline flow passed 7 tests with 1 skipped in the combined run.

Rendered QA used local Chrome automation because the in-app Browser tool was not exposed in this session:

- Desktop `/serum`: loaded, no horizontal overflow, no unnamed buttons, API `200`, `Cache-Control: no-store`.
- Desktop `/settings?tab=serum`: loaded, publish and rollback disabled, no horizontal overflow, no unnamed buttons.
- Mobile `/serum`: loaded, mobile drawer opens and closes, no horizontal overflow, no console warnings.
- Screenshots saved under `D:/BIDCRM/.forge/qa/`.

## Findings Fixed During QA

- SERUM route initially required `agents:read`, which blocked the settings/control-plane read in stub admin QA. Changed to `settings:read`.
- Mobile drawer ref-warning fix first left the drawer off-canvas. Replaced the Framer/Radix bridge with Radix parts plus CSS keyframes.
- Desktop sidebar links were 36px tall. Raised `.sb-item` to 44px.
- Critical controls could not find the board switch because the view switch used `role=tab` for navigation. Converted it to a segmented button group with `aria-pressed` and a descriptive board action name.

## Residual Risk

- `GET /api/v1/serum/status` N+1 read amplification was fixed in Follow-Up 6 with a guarded aggregate query and query-count regression coverage.
- SERUM settings are intentionally read-only in this slice. Versioned persistence, diffing, approvals, rollback, and audit events are not implemented yet.
- Full drag/drop QA was not expanded in this slice; existing web tests still pass, but a dedicated Playwright pass should cover pipeline drag/drop and editor flows before release.

## WALTEUR Slice Score

- Functional: 24/25.
- Code: 24/25.
- Design: 24/25.
- Infra/QA: 23/25.
- Total: 95/100 for this safe foundation slice.

Full SERUM is not certified yet because autonomous loops, durable event storage, approvals, and config persistence remain deliberately disabled.

---

## 2026-06-16 Follow-Up: SERUM Availability, Sector, Accounts

### Trigger

Tony reported:

- `SERUM status is unavailable. The control plane could not read backend signals. Refresh or check API health.`
- Industry and account sections needed to feel more dynamic and premium.
- The app appeared to get stale after staying on a page, requiring logout/login.
- Functional QA needed to cover buttons, drag/drop, and launch-facing UX quality.

Also reviewed `C:/Users/Tony/Downloads/bitstack-backlog-validation.md`. This pass directly improves the dynamic sector/account experience and signal explainability surface from that backlog. Provenance badges, editable tech stack persistence, MSA intake, access-level visibility, and Azure/security sign-off remain separate product/security slices.

### Issues Fixed

- SERUM unavailable in dev/preview: API CORS allowed `localhost` but not equivalent loopback origins such as `127.0.0.1` on shifted Vite ports. Added a shared CORS origin helper and applied it to Fastify CORS and pipeline SSE responses.
- Stale data after idle/reload: persisted React Query hydration was marking old cached data fresh. Hydration now preserves the original `updatedAt`, and live control-plane keys such as SERUM and CRM integrations are excluded from persisted cache.
- Sector view static feel: sector rows now include coverage and top account drill-down data from the API. The page now supports sector selection, country filters, account rows, coverage bars, and stronger visual hierarchy.
- Accounts page shallow filtering: added data-health segmentation, technology filtering, coverage sorting, portfolio health distribution, top data gaps, richer search, tech pills, and account coverage bars.
- Pointer navigation focus artifact: route focus is now applied for keyboard navigation only, avoiding a visible full-page focus outline after mouse/touch route changes.
- SERUM badge contrast: adjusted the light-mode SERUM blue token to pass blocking axe contrast checks.
- CORS edge hardening: loopback detection now also covers IPv6 loopback origins.

### Implementation Map

- CORS: `apps/api/src/lib/cors-origins.ts`, `apps/api/src/server.ts`, `apps/api/src/routes/rfp-pipeline-stream.ts`.
- Sector data/API: `apps/api/src/routes/sector-view.ts`, `apps/web/src/hooks/useSectorView.ts`, `apps/web/src/pages/SectorViewPage.tsx`.
- Accounts UX: `apps/web/src/pages/AccountsPage.tsx`, `apps/web/src/pages/accountsPage/AccountCard.tsx`, `apps/web/src/pages/accountsPage/accountUtils.ts`.
- Cache recovery: `apps/web/src/lib/queryCache.ts`.
- Route focus: `apps/web/src/components/layout/RouteAnnouncer.tsx`.
- Visual system: `apps/web/src/index.css`.

### Verification

- `pnpm --filter @bidstack/api exec vitest run src/lib/cors-origins.test.ts`: 2 pass.
- `pnpm --filter @bidstack/web exec vitest run src/pages/accountsPage/accountUtils.test.ts src/lib/queryCache.test.ts`: 6 pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit`: pass.
- API targeted lint for touched files: pass.
- Web targeted lint for touched files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- CORS probe from `Origin: http://127.0.0.1:5175` to `GET http://localhost:4101/api/v1/serum/status`: 200 with `Access-Control-Allow-Origin: http://127.0.0.1:5175`.
- Selected Playwright desktop QA: `accounts.spec.ts`, `critical-controls.spec.ts`, and `intake.spec.ts`: 7 pass.
- Axe critical/serious pass on `/serum`, `/sector-view`, and `/accounts`: 0 blocking violations.

### Screenshots

- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/01-serum-desktop.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/02-sector-desktop.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/03-sector-selected.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/04-accounts-desktop.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/05-accounts-tech-filter.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/06-accounts-search.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts/07-accounts-mobile.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts-rerun/sector-no-main-outline.png`
- `D:/BIDCRM/docs/audits/screenshots/2026-06-16-serum-industry-accounts-rerun/accounts-search-mantu.png`

### WALTEUR Score For This Follow-Up

- Functional: 24/25.
- Code: 24/25.
- Design: 24/25.
- Infra/QA: 24/25.
- Total: 96/100 for this follow-up slice.

### Remaining Launch Risks

- Full Salesforce equivalence is not certified. The app still needs field-level provenance, editable tech stack persistence, access-tier proofs, MSA intake/review, and security sign-off from the backlog before that claim is defensible.
- This was focused functional QA, not a full regression pass across every role, browser, locale, and integration.
- Existing local dev logs still show a Vite manifest preload warning unrelated to this pass.
- Pipeline drag/drop has prior coverage and intake drop-zone was checked in this pass, but a dedicated release run should still cover every drag/drop surface with real seed data.

---

## 2026-06-16 Follow-Up 2: Account Provenance And Cockpit A11y

### Trigger

Continued the 100k-company deployment goal against the backlog P0 account-provenance requirement. The account cockpit already had the external/internal KPI split and backend field overrides, so this slice focused on making that contract reliable in the live UI.

### Issues Fixed

- Field override writes used `cockpit.company.id`, while the backend stores and reads overrides by normalized company name. Verified/enriched accounts can have UUID ids, causing a saved override not to reappear in the cockpit. The UI now keys override writes by `cockpit.company.name`.
- Overridden external KPIs moved to Internal Data but lost their edit/revert controls because only the External block was editable. Overridden internal KPIs now keep edit/revert affordances.
- Account cockpit axe scan found two blocking file upload issues: an unlabeled hidden file input and a nested interactive dropzone. The input now has an accessible name and sits beside the role-button dropzone.

### Implementation Map

- `apps/web/src/components/cockpit/KpiRow.tsx`
- `apps/web/src/components/cockpit/KpiRow.test.tsx`
- `apps/web/src/components/files/FilesPanel.tsx`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/KpiRow.test.tsx`: 2 pass.
- `pnpm --filter @bidstack/api exec vitest run src/services/crm/dashboard.cockpit.test.ts src/routes/crm/companies.test.ts`: 21 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/KpiRow.tsx src/components/cockpit/KpiRow.test.tsx src/components/files/FilesPanel.tsx`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit`: pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/account-detail.spec.ts --project=chromium-desktop`: 3 pass.
- Custom axe scan on the real account cockpit route: `blocking=0` for critical/serious issues.
- `pnpm --filter @bidstack/web build`: pass.

### Remaining Launch Risks

- Backlog item 1 is improved but not fully closed: every account/company detail field still needs visible source metadata, not only cockpit KPIs and source receipts.
- Backlog item 2 remains open: editable tech stack with provider delta accept/reject is not implemented.
- MSA intake/review, access-tier proofing, Azure/security sign-off, and full regression/load/security certification remain required before a Salesforce-equivalence or company-wide deployment claim.

---

## 2026-06-16 Follow-Up 3: Account Detail Field Provenance

### Trigger

Continued the P0 field-level provenance requirement from `C:/Users/Tony/Downloads/bitstack-backlog-validation.md`. The KPI row already carried source badges and manual overrides, but the Business Snapshot details and technical stack still read as plain values.

### Issues Fixed

- Business Snapshot rows now render a source badge per displayed field, including company registry receipts, external sync/strategic-intel sources, CRM-derived fields, missing-source states, and manual override state for revenue/headcount when carried by the KPI source model.
- Technical stack pills now expose source and confidence metadata for each vendor, with visible labels such as Apollo, Manual, Meeting, OM, or Template.
- The shared `SourceBadge` component provides a consistent cockpit badge shape for new provenance surfaces without changing the existing KPI override behavior.
- Dense row/pill CSS was tightened so source badges wrap or truncate without page-level horizontal overflow.

### Implementation Map

- `apps/web/src/components/cockpit/SourceBadge.tsx`
- `apps/web/src/components/cockpit/BusinessSnapshotCard.tsx`
- `apps/web/src/components/cockpit/BusinessSnapshotCard.test.tsx`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/index.css`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/account-field-provenance-badges.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/KpiRow.test.tsx src/components/cockpit/BusinessSnapshotCard.test.tsx src/components/cockpit/TechStackCard.test.tsx`: 4 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/KpiRow.tsx src/components/cockpit/KpiRow.test.tsx src/components/cockpit/BusinessSnapshotCard.tsx src/components/cockpit/BusinessSnapshotCard.test.tsx src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/components/cockpit/SourceBadge.tsx src/components/files/FilesPanel.tsx`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit`: pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/account-detail.spec.ts --project=chromium-desktop`: 3 pass.
- Live Chromium account cockpit axe scan: 0 critical/serious violations; page-level horizontal overflow false.
- `pnpm --filter @bidstack/web build`: pass.

### Remaining Launch Risks

- Backlog item 1 is substantially improved but still not fully closed: field provenance is visible on cockpit KPIs, Business Snapshot, tech stack, and source receipts, but not every downstream account-intel/card field has a persisted `FieldMeta` model.
- Backlog item 2 remains open: editable tech stack with provider delta accept/reject needs a backend model/API, not just UI controls.
- MSA intake/review, access-tier proofing, Azure/security sign-off, load/security regression, and full role/browser certification remain blockers for the 100k-user/Salesforce-equivalence claim.

---

## 2026-06-16 Follow-Up 4: Persisted Editable Technical Stack

### Trigger

Continued backlog P0 item 2 from `C:/Users/Tony/Downloads/bitstack-backlog-validation.md`.
The cockpit now needed a real curated technology-stack workflow rather than
source badges only.

### Issues Fixed

- Account technical stack is now editable and persisted through the existing
  `CompanyFieldOverride` audit path under the `technicalStack` field key.
- Provider-only stack values now appear as deterministic suggestions that can
  be accepted into the manual stack or dismissed without erasing the provider
  trail.
- The account cockpit now respects the curated stack after reload and provider
  refreshes, while still falling back to the visible cockpit/provider stack
  before any saved override exists.
- Technical-stack editing now includes add, remove, save, cancel, disabled,
  loading, toast, keyboard-focus, and responsive states.
- A live cockpit axe issue in the company logo fallback was fixed by making the
  labeled fallback a real image role.

### Implementation Map

- `packages/shared/src/schemas/crm.base.ts`
- `apps/api/src/services/crm/technical-stack.service.ts`
- `apps/api/src/services/crm/technical-stack.service.test.ts`
- `apps/api/src/services/crm/dashboard.cockpit.ts`
- `apps/api/src/services/crm/dashboard.cockpit.test.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/routes/crm/companies.test.ts`
- `packages/db/prisma/schema.prisma`
- `apps/web/src/hooks/useCompanyTechnicalStack.ts`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/components/company/CompanyLogo.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/editable-technical-stack-provider-deltas.md`

### Verification

- `pnpm --filter @bidstack/api test -- technical-stack.service.test.ts dashboard.cockpit.test.ts companies.test.ts`: 27 pass.
- `pnpm --filter @bidstack/web test -- TechStackCard.test.tsx`: 5 pass.
- API targeted ESLint for touched stack/company/cockpit files: pass.
- Web targeted ESLint for touched stack/logo/hook files: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- Live browser QA on `http://127.0.0.1:5175/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d`: edit/save persisted after reload; add/remove/cancel behaved correctly; manual badge rendered.
- Playwright axe scan on the live account cockpit route: 0 violations.

### Remaining Launch Risks

- Backlog item 2 is now functionally closed for the cockpit stack, but a future
  migration may still be warranted if technical-stack curation needs per-item
  history, approval, or cross-source merge analytics beyond the shared override
  ledger.
- The remaining Salesforce-equivalence blockers are still MSA intake/review,
  access-tier proofing, Azure/security sign-off, downstream `FieldMeta`
  expansion, full role/browser regression, and load/security certification.

---

## 2026-06-16 Follow-Up 5: Account Scope, SERUM Resilience, And Freshness

### Trigger

Tony reported `SERUM status is unavailable`, stale page behavior that required
logging out/in, and asked for a deeper Salesforce-grade account/industry
experience with working buttons, files, notes, drag/drop, and access controls.

### Issues Fixed

- SERUM status now reads backend signals fail-soft, so one missing optional
  signal table no longer takes down the whole control-plane status response.
- CRM dashboard snapshots and dashboard in-process cache keys now include the
  current access scope, preventing restricted users from seeing a stale
  unrestricted account snapshot after an idle period or auth refresh.
- Company/account, cockpit, tier, notes, files, and account-intel surfaces now
  reuse account-level visibility checks derived from access groups, country
  scope, key-account ownership, and visible opportunities.
- Key account, industry, top account, company search, company lookup, company
  cockpit, notes, files, file download/delete, and account-intel mutations now
  reject out-of-scope account data.
- Files and notes now preserve `companyId` and show account-group trust cues in
  the cockpit right rail.
- Local browser QA can point the Vite proxy at a fresh API with
  `BIDSTACK_DEV_API_URL` without forcing direct browser CORS requests.
- CRM dashboard query freshness now avoids long-lived stale data with bounded
  stale time, periodic foreground refresh, and conservative retry behavior.

### Implementation Map

- `apps/api/src/lib/account-access.ts`
- `apps/api/src/lib/access-scope.ts`
- `apps/api/src/routes/accounts.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/routes/crm/dashboard.ts`
- `apps/api/src/routes/files.ts`
- `apps/api/src/routes/notes.ts`
- `apps/api/src/routes/account-intel.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/routes/user-groups.integration.test.ts`
- `apps/api/src/services/crm/dashboard.queries.ts`
- `apps/api/src/services/crm/dashboard.service.ts`
- `apps/web/src/hooks/useCrmDashboard.ts`
- `apps/web/src/components/files/FilesPanel.tsx`
- `apps/web/src/components/notes/NotesPanel.tsx`
- `apps/web/src/components/settings/AccessGroupsSection.tsx`
- `apps/web/vite.config.ts`
- `docs/solutions/account-access-scope-and-dev-proxy-verification.md`

### Verification

- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api test -- user-groups.integration.test.ts`: 5 pass.
- `pnpm --filter @bidstack/api test -- files.test.ts account-intel.integration.test.ts`: 13 pass.
- `pnpm --filter @bidstack/web test -- DashboardPage.test.tsx`: 5 pass.
- `pnpm --filter @bidstack/api test -- serum.integration.test.ts`: 1 pass.
- Playwright smoke on fresh same-origin proxy pair `4001/5180`: `/serum`
  renders with `SERUM status is unavailable` count 0; `/accounts/mantu`
  renders Notes/Files access cues; console/page/500 issues 0.
- Screenshots: `D:\BIDCRM\.codex-serum-5180.png` and
  `D:\BIDCRM\.codex-account-mantu-5180.png`.

### Remaining Launch Risks

- `git diff --check` still fails on pre-existing trailing whitespace in
  `packages/dust-client/src/index.ts:269`; it was not part of this slice.
- This closes a major access-proof slice, but final Salesforce-equivalence still
  requires MSA intake/review, Azure/security sign-off, full role/browser
  regression, load/security certification, and downstream `FieldMeta` coverage.

---

## 2026-06-16 Follow-Up 6: SERUM Status Query Consolidation

### Trigger

The previous SERUM status implementation returned `200` but still triggered the
request query guard with `N+1 detected: unknown.queryRaw executed 15 times in
one request`. For a 100k-user deployment, a control-plane health endpoint cannot
fan out into many raw reads per refresh.

### Issues Fixed

- Scalar SERUM counts now run through a table-availability probe plus one
  guarded aggregate query instead of many independent raw count/sum/max reads.
- Optional-table safety remains: if a signal table is absent, the aggregate uses
  zero or `NULL` without referencing the missing table.
- Provider health and queue health stay as bounded list queries because the UI
  needs row detail and both are limited.
- Query diagnostics are now exposed in `test` as well as `development`, so route
  tests can fail if the query guard threshold regresses.

### Implementation Map

- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/plugins/query-guard.ts`
- `docs/solutions/serum-control-plane-safe-foundation.md`

### Verification

- `pnpm --filter @bidstack/api test -- serum.integration.test.ts`: 1 pass.
  The test now asserts `X-Query-Count` is finite, `<= 10`, and has no
  `N+1 detected` warning.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `git diff --check -- apps/api/src/plugins/query-guard.ts`: pass.
- Manual trailing-whitespace scan for untracked
  `apps/api/src/routes/serum.ts` and
  `apps/api/src/routes/serum.integration.test.ts`: pass.

### Remaining Launch Risks

- Full API/web regression, full role/browser matrix, load/security
  certification, MSA intake/review, Azure/security sign-off, and downstream
  `FieldMeta` coverage remain required before a 99%/Salesforce-equivalence
  claim.
- `git diff --check` for the whole repo still fails on pre-existing trailing
  whitespace in `packages/dust-client/src/index.ts:269`.

---

## 2026-06-16 Follow-Up 7: MSA Extraction Review Gates + Premium Contract UX

### Trigger

Backlog item #7/#8 requires account-level MSA intake, extraction, human review,
and contractual-block population. The existing route could queue extraction,
but saved agreements could carry arbitrary `sourceExtractionId` values and the
UI still felt like a plain form rather than a governed review workflow.

### Issues Fixed

- Contract agreement reads/writes now enforce visible account access, matching
  the account-intel/files route pattern.
- Manual `sourceFileId` links are validated against org and normalized account
  key, preventing cross-account provenance mistakes.
- `sourceExtractionId` is now accepted only when the extraction is same
  org/account, `done`, and contains a valid `ContractExtractionDraft`.
- Added explicit approval API:
  `POST /api/v1/contract-agreements/extractions/:id/approve`.
- Extraction polling now returns review metadata:
  `reviewStatus`, `approvedAgreementId`, `confidenceBps`, `warnings`, `source`,
  `sourceFileName`, and `extractedAt`.
- Contract card UX now has a compact agreement summary, drag/drop document
  attach, icon actions, extraction confidence/source/review badges, and
  approve-save behavior for extracted drafts.

### Implementation Map

- `packages/shared/src/schemas/contract-agreement.ts`
- `apps/api/src/routes/contract-agreements.ts`
- `apps/api/src/routes/contract-agreements.integration.test.ts`
- `apps/web/src/hooks/useContractAgreements.ts`
- `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`
- `docs/solutions/contract-extraction-review-gates.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api test -- contract-agreements.integration.test.ts`:
  6 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api test -- serum.integration.test.ts`: 1 pass.
- Browser QA on existing `5173/4000`:
  account contractual section renders, Add agreement opens, rate-line add
  creates controls, inputs accept values, Cancel resets, mobile-width DOM check
  exposes reference/drop-zone/save/cancel controls. Console showed only existing
  Framer reduced-motion warnings.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.

### Remaining Launch Risks

- Screenshot capture in the in-app Browser timed out during this pass; DOM and
  build checks passed, but a visual screenshot artifact was not captured.
- This closes the first enforceable MSA review slice, but not full legal
  operations parity. Still required: complete document upload E2E with real OCR
  worker, role/browser matrix, load/security certification, Azure/security
  sign-off, and downstream `FieldMeta` coverage.
- `git diff --check` for the whole repo still fails on pre-existing trailing
  whitespace in `packages/dust-client/src/index.ts:269`.

---

## 2026-06-16 Follow-Up 8: Idle Auth Hardening + Account Ranking Dynamics

### Trigger

Browser QA reproduced Tony's "SERUM status is unavailable" message on the
existing local app at `5173/4000`, while the focused SERUM route test still
passed. The `4000` API process had started on 2026-06-15, so the browser was
hitting a stale backend that did not reflect the current route table.

### Issues Fixed

- Clerk mode no longer treats a stale `bidstack:session` local-storage marker
  as valid auth. Provider state is now source of truth; the marker only drives
  cache cleanup.
- Same-tab sign-in/sign-out and Clerk state changes now emit the same session
  marker event, so React Query cache cleanup is not dependent on a hard reload.
- Persisted query cache now clears when the auth identity changes, not only on
  explicit logout. This covers demo workspace switches and stale-tab auth
  transitions.
- SMS consent/send now use the shared `api()` wrapper, so long-lived tabs get
  bearer token refresh/retry instead of raw cookie-only `fetch`.
- `api()` now surfaces legacy `{ error }` response payloads as user-facing
  `ApiError.message`.
- Key Accounts now has instant client-side industry filtering, an animated
  industry signal strip, reset control, opportunity stat, and layout animation.
- Top Accounts now has a leaderboard command panel, stats strip, animated
  industry mix controls, reset control, and layout animation.

### Implementation Map

- `apps/web/src/lib/auth.tsx`
- `apps/web/src/lib/queryCache.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/sms/SmsComposerModal.tsx`
- `apps/web/src/lib/auth.test.tsx`
- `apps/web/src/lib/queryCache.test.ts`
- `apps/web/src/lib/api.test.ts`
- `apps/web/src/pages/KeyAccountsPage.tsx`
- `apps/web/src/pages/TopAccountsPage.tsx`

### Verification

- `pnpm --filter @bidstack/web test -- src/lib/auth.test.tsx`: 7 pass.
- `pnpm --filter @bidstack/web test -- src/lib/queryCache.test.ts`: 5 pass.
- `pnpm --filter @bidstack/web test -- src/lib/api.test.ts`: 5 pass.
- `pnpm --filter @bidstack/web test -- src/lib/auth.test.tsx src/lib/queryCache.test.ts src/lib/api.test.ts`: 17 pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- Started fresh QA servers without touching existing stale processes:
  API `http://localhost:4001`, web `http://localhost:5176`.
- `GET http://localhost:4001/health`: `{"ok":true,"db":true,"redis":true}`.
- `GET http://localhost:5176/api/v1/serum/status`: 200 with live SERUM JSON.
- Browser QA on `5176`:
  - `/settings?tab=serum`: no unavailable state; live backend copy and
    Validation section present.
  - `/key-accounts`: industry signal renders; `Testing 1` chip is unique,
    filter applies, Reset appears, Reset clears.
  - `/top-accounts`: leaderboard signal, stats, and industry mix render;
    `Testing $0` chip is unique, filter applies, Reset appears.
  - `/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d`: contractual agreements
    section renders; Add agreement opens form; source document and rate-card
    controls exist; Cancel restores Add agreement.
- Browser logs on the fresh pass showed only expected Vite/React dev messages
  plus the existing Framer reduced-motion warning.

### Remaining Launch Risks

- The stale `4000`/`5173` processes were left running untouched; use the fresh
  `4001`/`5176` pair for this QA pass or restart local dev servers before
  rechecking SERUM.
- Full role/browser regression, load/security certification, real document
  upload/OCR worker E2E, Azure/security sign-off, and downstream `FieldMeta`
  coverage remain required before a 99%/Salesforce-equivalence claim.
- `git diff --check` for the whole repo still fails on pre-existing trailing
  whitespace in `packages/dust-client/src/index.ts:269`.

---

## 2026-06-16 Follow-Up 9: SERUM + Account Experience Browser Regression

### Trigger

The previous fixes were verified manually, but a Salesforce-grade release needs
the exact user-facing controls guarded in CI: live SERUM status, industry
filter/reset panels, drag/drop source-document upload, rate-card editing, and
contract save/cleanup.

### Issues Fixed

- Key Account industry cards now expose explicit action labels such as
  "Filter key accounts by Testing", so the premium visual card is also clear to
  assistive tech and resilient E2E.
- Top Account industry cards now expose explicit action labels and distinguish
  unclassified/clear-filter behavior.
- Contract source-document upload now has a named hidden file input and a
  stable drop-zone target for browser regression.
- Key/Top account item arrays are memoized, eliminating hook dependency churn
  warnings on the new dynamic panels.
- Added a focused Playwright spec that starts a fresh API/web pair and verifies:
  live SERUM status has no unavailable state, Key Accounts industry click/reset,
  Top Accounts industry click/reset, contract drag/drop PDF upload, rate-line
  add/fill, contract save, document link visibility, and API cleanup for the
  created agreement/file.

### Implementation Map

- `apps/web/e2e/serum-account-experience.spec.ts`
- `apps/web/src/pages/KeyAccountsPage.tsx`
- `apps/web/src/pages/TopAccountsPage.tsx`
- `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`

### Verification

- `pnpm --filter @bidstack/web exec eslint e2e/serum-account-experience.spec.ts src/pages/KeyAccountsPage.tsx src/pages/TopAccountsPage.tsx src/components/account-intel/ContractAgreementsCard.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=132 E2E_WORKERS=1 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list`: 2 pass.
- The final Playwright run booted fresh API `127.0.0.1:4142` and fresh web
  preview via the normal webServer build path; it did not reuse stale
  `4000/5173`.
- The contract E2E verified real local storage upload/finalize, real agreement
  POST, and successful DELETE cleanup for both created rows.

### Remaining Launch Risks

- This closes a focused browser regression gap, not the whole 100k-user gate.
  Still required: full role/browser matrix, real OCR worker extraction E2E,
  Azure/security sign-off, load/security certification, and downstream
  `FieldMeta` coverage.
- Full E2E TypeScript compile remains blocked by pre-existing unrelated E2E
  suite errors in files such as `e2e/fixtures/test-data-cleanup.ts` and
  `e2e/flows/pipeline.spec.ts`; the focused spec lint and browser run pass.

---

## 2026-06-16 Follow-Up 10: E2E Type Gate + Performance Budget Cleanup

### Trigger

Continuation toward 100k-user/Salesforce-grade readiness. The previous browser
regression pass was green, but the broad web E2E TypeScript gate was still
blocked and the performance-budget suite had noisy measurement semantics.

### Issues Fixed

- Broad web E2E TypeScript now compiles. Fixed CommonJS-safe fixture path
  resolution, a cleanup helper variable typo, nullable pipeline-card metadata,
  an invalid Playwright matcher, and Event Timing observer typing.
- Bundle budget coverage now measures the actual Vite manifest entry/import
  graph for first-load JavaScript instead of summing every lazy route chunk in
  `dist/assets`. The per-chunk gzip cap remains in place.
- Sidebar collapse no longer animates layout/grid track properties in the dense
  CRM shell. The shell now prioritizes interaction latency over decorative
  reflow.
- Core Web Vitals INP now enforces the documented launch requirement of
  `<200ms` and annotates runs that miss the stricter `<100ms` headroom target.

### Implementation Map

- `apps/web/e2e/fixtures/auth.fixture.ts`
- `apps/web/e2e/fixtures/test-data-cleanup.ts`
- `apps/web/e2e/flows/migration.spec.ts`
- `apps/web/e2e/flows/pipeline.spec.ts`
- `apps/web/e2e/pages/LeadsPage.ts`
- `apps/web/e2e/performance/bundle-size-budget.spec.ts`
- `apps/web/e2e/performance/core-web-vitals.spec.ts`
- `apps/web/src/index.css`

### Verification

- `pnpm --filter @bidstack/web exec tsc -p e2e/tsconfig.json --noEmit`: pass.
- `pnpm --filter @bidstack/web exec eslint e2e/fixtures/auth.fixture.ts e2e/fixtures/test-data-cleanup.ts e2e/flows/migration.spec.ts e2e/flows/pipeline.spec.ts e2e/pages/LeadsPage.ts e2e/performance/bundle-size-budget.spec.ts e2e/performance/core-web-vitals.spec.ts`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=144 E2E_WORKERS=1 playwright test e2e/flows/pipeline.spec.ts e2e/flows/migration.spec.ts --project=chromium-desktop --reporter=list`: 6 passed / 4 skipped.
- `pnpm --filter @bidstack/web exec cross-env E2E_BASE_URL=http://127.0.0.1:1 playwright test e2e/performance/bundle-size-budget.spec.ts --project=chromium-desktop --reporter=list`: 4 passed.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=199 E2E_WORKERS=1 playwright test e2e/performance/core-web-vitals.spec.ts --project=chromium-desktop --reporter=list`: 10 passed.

### Remaining Launch Risks

- Full role/browser matrix is still required before a company-wide rollout.
- Real OCR worker extraction approval E2E remains open.
- Azure/security sign-off, load/security certification, and downstream
  `FieldMeta` coverage remain open.
- INP `<100ms` headroom can still be optimized further; the hard documented
  launch threshold passes.

---

## 2026-06-16 Follow-Up 11: Contract Worker Extraction Proof

### Trigger

The backlog requires MSA upload/analysis with human approval, and the SERUM
master prompt requires real document jobs, source-backed answers, human
approval, and no fake intelligence. The API/browser tests covered upload and
approval, but the worker lane itself was still skipped in route tests.

### Issues Fixed

- Added a direct worker processor seam so tests can execute the same contract
  extraction code path BullMQ uses, without Redis timing or queue flake.
- Added a worker integration test that writes a real stored MSA document,
  creates a tenant-scoped `FileAttachment` and `DocumentExtraction`, runs the
  contract extraction lane, and verifies the resulting reviewable draft.
- The worker test proves contract-lane extraction does not accidentally write
  account intelligence artifacts (`AccountSolution` / `AccountProduct`).
- API approval tests still prove completed extraction approval, duplicate
  approval rejection, pending extraction rejection, same-account source-file
  enforcement, and tenant isolation.

### Implementation Map

- `apps/worker/src/queues/document-extract.ts`
- `apps/worker/src/queues/document-extract.contract.test.ts`
- `docs/solutions/contract-extraction-review-gates.md`

### Verification

- `pnpm --filter @bidstack/worker exec vitest run src/queues/document-extract.contract.test.ts --pool=threads --no-file-parallelism --isolate=false`: 1 passed.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker exec eslint src/queues/document-extract.ts src/queues/document-extract.contract.test.ts`: pass.
- `pnpm --filter @bidstack/api test -- contract-agreements.integration.test.ts`: 6 passed.
- `C:\Users\Tony\Downloads\Codex Master Prompt v3.pdf` sampled with `pypdf`; relevant pages mention document intelligence, MSA/legal visibility, source-backed answers, human approval, legal review, and no fake production data.

### Remaining Launch Risks

- This proves the stored-document worker contract lane, not a full live
  browser-to-BullMQ-to-worker-to-approval flow.
- Scanned-PDF OCR with OCRmyPDF/Tesseract remains environment-dependent and
  still needs a dedicated runtime/CI proof before claiming complete OCR
  readiness.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-17 Follow-Up 18: Root Load Gate Certification

### Trigger

The repo-level `pnpm load-test` gate was still a launch-readiness gap because
the workstation did not have a local `k6` binary and the script skipped
authenticated CRM routes without an API token.

### Issues Fixed

- Added `scripts/run-k6-load-test.mjs`, which runs local `k6` when present and
  otherwise falls back to pinned Docker image `grafana/k6:2.0.0`.
- Rewrites loopback `API_BASE_URL` values to `host.docker.internal` for the
  Docker runner so Windows-hosted APIs remain reachable from the container.
- Exercises authenticated CRM read paths by default under local dev-stub auth.
- Added `K6_DURATION_PROFILE=smoke` and a strict `checks >99%` threshold.
- Treats search `429` as graceful only for the search request, preserving strict
  `2xx` checks elsewhere.

### Verification

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `pnpm exec eslint --no-ignore scripts/run-k6-load-test.mjs scripts/load-test.js`: pass.
- Smoke k6: `80/80` checks, p95 `18.64ms`.
- Full pinned Docker k6: `100` max VUs, `5,870` HTTP requests,
  `11,740/11,740` checks, p95 `12.78ms`, `0.00%` failed HTTP responses.

### Remaining Launch Risks

- This proves local/dev-stub CRM read-path load, not distributed 100k-user
  production scale.
- Clerk-backed staging auth proof and production-scale distributed load design
  remain open.

---

## 2026-06-17 Follow-Up 19: Dependency And Secret Hygiene Gate

### Trigger

Enterprise readiness required dependency, secret, and scan gates after the load
work. `pnpm audit` reported known advisories, the Bash secret scanner initially
failed due CRLF line endings, and gitleaks found historical credential-shaped
material.

### Issues Fixed

- Upgraded Vite, DOMPurify, Sentry, OpenTelemetry, and affected transitive
  packages through direct dependency bumps and `pnpm.overrides`.
- Restored `scripts/check-secrets.sh` to LF-compatible Bash.
- Re-enabled worker Vitest isolation after mock leakage surfaced in the full
  worker suite.
- Sanitized the tracked `.claude/settings.json` MCP API key value to a
  placeholder. Real keys belong in `.claude/settings.local.json` or the user
  environment.

### Verification

- `pnpm audit`: pass, no known vulnerabilities.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- Current commit gitleaks snapshot: pass.
- Untracked source regex sweep: clean.
- `pnpm lint`: pass with existing warnings only.
- `pnpm typecheck`: pass.
- `pnpm test`: full workspace test suite passed.
- `pnpm build`: pass.
- Bundle-size Playwright gate: 4/4 passed.

### Remaining Launch Risks

- Full git history gitleaks still reports 11 redacted historical findings across
  1187 commits. Those require credential rotation and an explicit owner decision
  on whether to rewrite history.
- Broad local Dockerized Semgrep scans timed out before a usable report. Run a
  CI-tuned Semgrep/SAST profile or a tightly scoped local config before final
  security sign-off.
- Azure/security sign-off, Clerk-backed staging auth proof, downstream
  `FieldMeta` coverage, and production-scale load certification remain open.

---

## 2026-06-17 Follow-Up 20: Bounded SAST Gate And AES-GCM Hardening

### Trigger

The previous security slice left SAST sign-off open because broad Dockerized
Semgrep scans timed out locally. A reproducible enterprise gate needed to scan
current shipped source/config, including untracked work-in-progress files,
without walking local worktrees, generated dependencies, screenshots, and other
machine state.

### Issues Fixed

- Added `scripts/run-semgrep-sast.mjs` and root `pnpm security:scan`.
- The runner mirrors only selected source/config files into a temporary
  directory, then runs pinned `semgrep/semgrep:1.165.0` with
  `p/owasp-top-ten`, `p/javascript`, and `p/typescript`.
- Default blocking severity is `ERROR`; reviewed warning noise currently comes
  from Express-specific Fastify JSON-send false positives and a whitelisted SSE
  CORS pattern.
- Fixed Semgrep ERROR findings by adding explicit 16-byte `authTagLength` to
  AES-256-GCM cipher/decipher calls across Yjs persistence/compaction,
  integration-token encryption, OAuth token encryption, and PII field
  encryption.
- Added a non-root `bidstack` user to the Docker `migrate` target before its
  `CMD`.

### Verification

- `node --check scripts/run-semgrep-sast.mjs`: pass.
- Targeted ESLint on Semgrep runner and touched crypto files: pass.
- `pnpm security:scan`: pass on 1379 mirrored files, 35 blocking rules, 0
  findings.
- `pnpm --filter @bidstack/api test -- src/services/yjs-persistence.service.test.ts --reporter=dot`: 10/10 passed.
- `pnpm --filter @bidstack/shared test -- --reporter=dot`: 86/86 passed.
- `pnpm --filter @bidstack/worker test -- --reporter=dot`: 243/243 passed.
- `pnpm --filter @bidstack/shared typecheck`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm audit`: pass, no known vulnerabilities.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- Alpine command probe for `addgroup/adduser/USER bidstack` behavior: pass.

### Remaining Launch Risks

- Full Docker `migrate` image build probe timed out locally because that target
  still depends on the expensive full builder path. Source-level Dockerfile SAST
  is green, but deploy-image runtime proof should run in CI or a longer local
  Docker window.
- Full-history gitleaks still requires credential rotation/history disposition.
- Final security sign-off still needs a CI-tuned SAST/container scan, Azure
  review, and Clerk-backed staging auth proof before 100k/Salesforce-equivalent
  deployment claims.

---

## 2026-06-17 Follow-Up 21: Fast Non-Root Migration Deploy Image

### Trigger

The bounded SAST slice fixed the Docker `migrate` target source-level warning,
but the full image build probe timed out because the target still copied from
the expensive full `builder` stage.

### Issues Fixed

- Removed `COPY --from=builder` from the root Docker `migrate` target.
- The migration image now copies only `packages/db/prisma` from the build
  context and no longer depends on web/API/worker build outputs.
- The `migrate` `CMD` now runs the workspace-local Prisma binary directly:
  `./packages/db/node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma`.
- Kept the non-root `bidstack` runtime user.
- Avoided runtime `pnpm`/Corepack bootstrapping in the migration job.

### Verification

- `docker build --pull=false --progress=plain --target migrate -f Dockerfile -t bidcrm-migrate:nonroot-probe .`: pass in seconds; build log used cached `base` and `migrate` layers only.
- Image id: `sha256:6d50927a122d6048cfae95b32d5e94f86c358c9f22323c5bdaa6d070d738c1e7`.
- Image inspect: user `bidstack`, workdir `/app`, CMD uses `packages/db/node_modules/.bin/prisma`.
- `docker run --rm bidcrm-migrate:nonroot-probe id`: non-root `uid=100(bidstack)`.
- `docker run --rm -e DATABASE_URL=postgres://example:example@example.invalid:5432/example bidcrm-migrate:nonroot-probe ./packages/db/node_modules/.bin/prisma validate --schema packages/db/prisma/schema.prisma`: schema valid.
- `docker run --rm --network bidcrm_default -e DATABASE_URL=postgres://bidstack:bidstack@postgres:5432/bidstack bidcrm-migrate:nonroot-probe`: 65 migrations found, no pending migrations to apply.
- `pnpm security:scan`: pass after Dockerfile change, 0 blocking findings.

### Remaining Launch Risks

- This certifies the local one-shot migration deploy image path, not the full
  Azure job wiring.
- Full-history gitleaks rotation/history disposition, CI container scanning,
  Clerk-backed staging auth proof, Azure security review, production-scale load
  proof, and downstream `FieldMeta` coverage remain open before a 100k/Salesforce
  deployment claim.

---

## 2026-06-16 Follow-Up 19: Worker Docker Artifact Certified, Root Runtime Still Gated

### Trigger

The previous slice proved the OCR browser flow but left the standalone worker
Docker artifact uncertified. This slice rebuilt and probed the exact worker
artifact, then followed the same OCR packaging issue into the root multi-target
Dockerfile.

### Issues Fixed

- Reduced Docker build context from `8.78GB` to `135.63kB` by excluding generated
  Prisma client output and local tool/test artifacts from `.dockerignore`.
  `packages/db/generated` had accumulated many stale Windows Prisma engine
  `.old` files; Docker regenerates this folder inside the image with
  `pnpm db:generate`.
- Rebuilt `bidcrm-worker:e2e-current-osd` from the current standalone worker
  Dockerfile with the slim context.
- Probed the exact standalone worker image and verified OCRmyPDF, Tesseract, and
  both `eng` and `osd` language data are present.
- Ran the scanned MSA fixture through `extractTextFromBuffer` inside
  `bidcrm-worker:e2e-current-osd`; it extracted `MASTER SERVICES AGREEMENT`,
  `MSA-OCR-E2E-001`, `FR, DE, ES`, and `Fullstack Architect`.
- Added `tesseract-ocr-osd` to the Debian-based root `Dockerfile` worker target.
- Added a root `worker-builder` stage so `docker build --target worker` does not
  need to build web/API/MCP artifacts before producing a worker image.

### Verification

- `docker build --pull=false --progress=plain --target builder -f apps/worker/Dockerfile -t bidcrm-worker:builder-probe-slimcontext .`:
  pass. Build context was `135.63kB`; `COPY . .` completed in `3.4s`.
- `docker build --pull=false --progress=plain -f apps/worker/Dockerfile -t bidcrm-worker:e2e-current-osd .`:
  pass. Final image tag created with image id prefix `6d4729a85424`.
- `docker run --rm --entrypoint tesseract bidcrm-worker:e2e-current-osd --list-langs`:
  listed `eng` and `osd`.
- `docker run --rm --entrypoint ocrmypdf bidcrm-worker:e2e-current-osd --version`:
  `16.11.1`.
- `docker run --rm --entrypoint qpdf bidcrm-worker:e2e-current-osd --version`:
  `qpdf version 12.3.2`.
- `docker run --rm -e BIDSTACK_OCR_ENABLED=true ... bidcrm-worker:e2e-current-osd --input-type=module -e "<extract fixture>"`:
  OCR extracted the expected scanned MSA terms.
- `docker build --pull=false --progress=plain --target worker-builder -f Dockerfile -t bidcrm-worker:root-worker-builder-probe .`:
  pass. Root worker-only builder stage compiles the worker lane.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm --filter @bidstack/worker test -- src/lib/extract-text.test.ts src/lib/extract-text-sandbox.test.ts`:
  13 passed.
- `git diff --check -- ...`: pass; Git reported only LF-to-CRLF warnings.

### Remaining Launch Risks

- The standalone/Railway-style worker artifact is now OCR-certified.
- The root multi-target `Dockerfile --target worker` runtime image is still not
  certified. Even after adding `worker-builder`, local builds timed out before
  producing `bidcrm-worker:root-current-osd`; the likely remaining cost is the
  Debian runtime layer, especially apt plus the Python/XGBoost venv path.
- Root worker release remains gated until `docker build --target worker -f Dockerfile`
  creates a tag and that exact image passes the same `eng`/`osd` and scanned
  fixture extraction probes.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-16 Follow-Up 18: OCR Browser Gate Passed, Docker Artifact Still Gated

### Trigger

Docker recovered enough to run an OCR-capable external document worker against
the full browser/API/BullMQ/approval path. The same slice also rechecked the
standalone worker image artifact so the runtime proof would not stop at local
browser success.

### Issues Fixed

- Proved the scanned-PDF OCR browser gate green with a Dockerized external
  worker binding health to `0.0.0.0`, shared API upload storage, isolated Redis
  DB 15, and OCR enabled.
- Proved the entire focused SERUM/account suite green with OCR enabled, not only
  the scanned-PDF test.
- Proved a wider product-control regression slice green across toolbar/topbar
  controls, experience settings, account cockpit, account detail, and settings
  persistence.
- Cleaned up the temporary OCR worker container and env file after the run.

### Verification

- `docker run --rm --pull=never redis:7-alpine sh -lc "echo docker-run-ok"`:
  pass (`docker-run-ok`).
- External OCR worker `bidcrm-ocr-e2e-5413` reached health on port `5413` with
  `DOCUMENT_EXTRACT_WORKER_HEALTH_HOST=0.0.0.0`, `BIDSTACK_OCR_ENABLED=true`,
  and `REDIS_URL=redis://host.docker.internal:6380/15`.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=503 E2E_WORKERS=1 E2E_DOCUMENT_WORKER=1 E2E_DOCUMENT_WORKER_EXTERNAL=1 E2E_DOCUMENT_WORKER_OCR=1 BIDSTACK_OCR_ENABLED=true E2E_REDIS_URL=redis://localhost:6380/15 REDIS_URL=redis://localhost:6380/15 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list --grep "OCR-scanned PDF"`:
  1 passed.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=503 E2E_WORKERS=1 E2E_DOCUMENT_WORKER=1 E2E_DOCUMENT_WORKER_EXTERNAL=1 E2E_DOCUMENT_WORKER_OCR=1 BIDSTACK_OCR_ENABLED=true E2E_REDIS_URL=redis://localhost:6380/15 REDIS_URL=redis://localhost:6380/15 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list`:
  4 passed.
- External worker logs showed `document-extract e2e worker ready` and completed
  all OCR extraction jobs with `contract extraction completed`.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=521 E2E_WORKERS=1 playwright test e2e/critical-controls.spec.ts e2e/experience.spec.ts e2e/accounts.spec.ts e2e/account-detail.spec.ts e2e/settings.spec.ts --project=chromium-desktop --reporter=list`:
  14 passed.

### Remaining Launch Risks

- The product-level OCR browser path is now green, but the standalone worker
  Docker artifact is still not certified. The existing
  `bidcrm-worker:e2e-current-osd` tag only exposed `eng` in
  `tesseract --list-langs`; it did not expose `osd`.
- Fresh `docker build --pull=false --progress=plain -f apps/worker/Dockerfile`
  attempts for the standalone worker hung silently with no fresh tag/log output
  and had to be stopped by killing only the orphaned Docker client process.
- Before production release, rebuild the worker image cleanly and probe the
  artifact directly for `ocrmypdf`, `tesseract`, `eng`, and `osd`, then rerun
  the OCR browser gate using that exact rebuilt image.
- `.github/workflows/ci.yml` remains untouched per repo rules. CI wiring for the
  OCR browser gate still needs explicit coordination.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-17 Follow-Up 20: Root Deploy Images Certified

### Trigger

Follow-Up 19 certified the standalone OCR worker image but left the root
multi-target `Dockerfile --target worker` runtime uncertified. The root API
target also timed out while probing the accidental footprint of Dockerfile
ownership edits, exposing the same recursive ownership-layer issue outside the
worker target.

### Issues Fixed

- Replaced the root worker target's Debian/Python venv runtime with the same
  Alpine OCR runtime family as the certified standalone worker. XGBoost remains
  opt-in in code and falls back when the Python sidecar is unavailable.
- Kept the root `worker-builder` stage worker-only, then shipped the builder's
  resolved workspace with `COPY --chown=bidstack:bidstack --from=worker-builder
/app ./` instead of running a second runtime `pnpm install --prod`.
- Removed recursive `chown -R /app` from root API, worker, and MCP runtime
  stages. Each target now creates the `bidstack` runtime user before artifact
  copies and uses `COPY --chown` for built artifacts, avoiding giant ownership
  rewrite layers while still running as non-root.
- Rebuilt and probed the exact final root worker image after all Dockerfile
  edits, not an earlier near-current tag.

### Verification

- `docker build --pull=false --progress=plain --target worker -f Dockerfile -t bidcrm-worker:root-current-osd .`:
  pass. Final image id `sha256:203d59ef813e053b79b5a0a8e0aa2e184323d8b872f7c8288b7c54cb44dbe79d`.
- `docker run --rm --entrypoint sh bidcrm-worker:root-current-osd -lc "id && node --version && ocrmypdf --version && qpdf --version && tesseract --list-langs"`:
  non-root `uid=100(bidstack)`, Node `v24.16.0`, OCRmyPDF `16.11.1`,
  qpdf `12.3.2`, and Tesseract languages `eng` plus `osd`.
- `docker run --rm -e BIDSTACK_OCR_ENABLED=true ... bidcrm-worker:root-current-osd --input-type=module -e "<extract scanned fixture>"`:
  extracted `MASTER SERVICES AGREEMENT`, `MSA-OCR-E2E-001`, `FR, DE, ES`, and
  `Fullstack Architect 1100/ day` from the image-only scanned MSA fixture.
- `docker build --pull=false --progress=plain --target api -f Dockerfile -t bidcrm-api:root-api-user-probe .`:
  pass. Final image id `sha256:b29a9282b1337c0c9ffecf10b9660cc4d2a1939da35ba0cee5ad0dc2ae4c39cb`.
- `docker run --rm --entrypoint sh bidcrm-api:root-api-user-probe -lc "id && node --version && pwd"`:
  non-root `uid=100(bidstack)`, Node `v24.16.0`, working directory
  `/app/apps/api`.
- `docker build --pull=false --progress=plain --target mcp-server -f Dockerfile -t bidcrm-mcp:root-mcp-user-probe .`:
  pass. Final image id `sha256:a082bc358d0a551973587da216331cf7e2cc2a0e15a112b8e6aafe605656a9e8`.
- `docker run --rm --entrypoint sh bidcrm-mcp:root-mcp-user-probe -lc "id && node --version && pwd"`:
  non-root `uid=100(bidstack)`, Node `v24.16.0`, working directory
  `/app/apps/mcp-server`.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm --filter @bidstack/worker test -- src/lib/extract-text.test.ts src/lib/extract-text-sandbox.test.ts`:
  13 passed.
- `git diff --check -- .dockerignore Dockerfile apps/worker/Dockerfile ...`:
  pass; Git reported only LF-to-CRLF warnings.
- No orphaned `docker` / `docker-buildx` build clients remained after the final
  checks.

### Remaining Launch Risks

- Root and standalone worker Docker artifacts are now OCR-certified, and root
  API/MCP targets build and run as non-root. This closes the Docker artifact
  gate from Follow-Up 19.
- `.github/workflows/ci.yml` remains untouched per repo rules. CI wiring for the
  OCR browser/image gates still needs explicit coordination.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open. This is a strong deploy-packaging slice, not a full
  Salesforce-equivalence certification.

## 2026-06-16 Follow-Up 12: Contract BullMQ Worker Proof

### Trigger

The direct worker seam proved the contract parser/DB path, but production
still enters through BullMQ. Before treating MSA analysis as credible for
enterprise rollout, the queue-to-worker handoff needed a focused proof against
real Redis and the same stored-document fixture.

### Issues Fixed

- Added a BullMQ-backed worker test for the contract extraction lane.
- The test starts the focused `document-extract` worker, enqueues a real
  `document.extract` job, waits for the persisted `DocumentExtraction` draft,
  and validates the `ContractExtractionDraft`.
- The Redis proof defaults to isolated DB 15 and can be overridden with
  `BIDSTACK_WORKER_E2E_REDIS_URL`, avoiding accidental reliance on the live
  local app queue.
- The proof keeps the same guard as the direct worker test: contract extraction
  must not create `AccountSolution` or `AccountProduct` intelligence artifacts.

### Implementation Map

- `apps/worker/src/queues/document-extract.contract.test.ts`

### Verification

- `pnpm --filter @bidstack/worker exec vitest run src/queues/document-extract.contract.test.ts --pool=threads --no-file-parallelism --isolate=false`: 2 passed.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker exec eslint src/queues/document-extract.ts src/queues/document-extract.contract.test.ts`: pass.

### Remaining Launch Risks

- This proves the focused Redis/BullMQ worker path, not the complete
  browser-upload-to-BullMQ-to-worker-to-approval journey.
- Scanned-PDF OCR with OCRmyPDF/Tesseract still needs a runtime/CI proof.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-16 Follow-Up 13: Contract API BullMQ Producer Proof

### Trigger

The worker now proves it can consume a real BullMQ `document.extract` job, but
the API route still had only the default test-mode proof where queueing is
skipped. The producer side needed evidence that `/contract-agreements/extract`
creates the right BullMQ job when queue tests are explicitly enabled.

### Issues Fixed

- Added a test-only closer for the API document-extract queue so Redis-enabled
  integration tests do not leak queue handles.
- Added an API integration test that sets
  `BIDSTACK_ENABLE_QUEUE_IN_TESTS=true`, uses isolated Redis DB 15 by default
  through `BIDSTACK_API_E2E_REDIS_URL`, calls
  `POST /contract-agreements/extract`, and verifies the real BullMQ job.
- The test asserts the queued job name is `document.extract` and that the job
  payload carries the expected org, account, file, extraction id, storage key,
  content type, file name, and `extractionKind: contract`.

### Implementation Map

- `apps/api/src/queues/document-extract.ts`
- `apps/api/src/routes/contract-agreements.integration.test.ts`

### Verification

- `pnpm --filter @bidstack/api test -- contract-agreements.integration.test.ts`: 7 passed.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/api exec eslint src/queues/document-extract.ts src/routes/contract-agreements.integration.test.ts`: pass.

### Remaining Launch Risks

- API producer and worker consumer are now separately proven through BullMQ,
  but the complete browser-upload-to-API-queue-to-worker-to-approval journey is
  still not a single E2E proof.
- Scanned-PDF OCR with OCRmyPDF/Tesseract still needs a runtime/CI proof.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-16 Follow-Up 14: Contract Browser/API/Worker Approval E2E

### Trigger

The API producer and worker consumer were separately proven, but the user-facing
agreement workflow still needed one product-level proof: browser upload, API
finalize, extraction enqueue, BullMQ worker completion, draft review, approval,
and cleanup.

### Issues Fixed

- Reused the shared `FILE_INPUT_ACCEPT` contract for the account agreement
  source upload instead of maintaining a narrower UI-only accept list.
- Updated the contract upload fallback copy to reflect the supported PDF,
  Office, text, and image document types.
- Added a focused document-extract worker E2E harness with a health endpoint and
  explicit dotenv bootstrap so Playwright can own the service lifecycle.
- Added optional Playwright `E2E_DOCUMENT_WORKER=1` webServer wiring that starts
  web, API, and the focused document worker with an isolated Redis URL.
- Added a browser E2E that drag/drops a text MSA, uploads/finalizes the file,
  triggers extraction, waits for the worker-produced draft, applies the draft,
  approves/saves the agreement, verifies the saved terms and document link, and
  cleans up the created agreement/file.

### Implementation Map

- `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `apps/web/playwright.config.ts`
- `apps/worker/src/e2e/document-extract-worker.ts`

### Verification

- `pnpm --filter @bidstack/web exec eslint e2e/serum-account-experience.spec.ts src/components/account-intel/ContractAgreementsCard.tsx playwright.config.ts`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec tsc -p e2e/tsconfig.json --noEmit`: pass.
- `pnpm --filter @bidstack/worker exec eslint src/e2e/document-extract-worker.ts src/queues/document-extract.ts`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/document-extract.contract.test.ts --pool=threads --no-file-parallelism --isolate=false`: 2 passed.
- `pnpm --filter @bidstack/api test -- contract-agreements.integration.test.ts`: 7 passed.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=228 E2E_WORKERS=1 E2E_DOCUMENT_WORKER=1 E2E_REDIS_URL=redis://localhost:6380/15 REDIS_URL=redis://localhost:6380/15 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list`: 3 passed.

### Remaining Launch Risks

- This proves text-document MSA extraction through the real browser/API/BullMQ
  worker/approval path. Scanned-PDF OCR with OCRmyPDF/Tesseract still needs a
  runtime/CI proof.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-16 Follow-Up 15: Scanned-PDF OCR Runtime Gate

### Trigger

The browser/API/worker contract proof used a text MSA fixture. Enterprise MSA
intake also has to prove the scanned-PDF fallback: born-digital PDF parsing
returns no text, OCRmyPDF/Tesseract adds a text layer, and the worker parser
returns usable contract text.

### Issues Fixed

- Added a small image-only scanned-PDF fixture for the worker parser tests. The
  fixture has no selectable PDF text and visually contains `OCR RUNTIME READY`
  plus `MASTER SERVICES AGREEMENT`.
- Added an explicit opt-in Vitest gate behind `BIDSTACK_OCR_RUNTIME_TEST=1`.
  Normal local runs remain green with a loud skip when native OCR tools are not
  installed; OCR-capable CI/runtime jobs fail if OCRmyPDF/Tesseract cannot parse
  the fixture.
- Proved the current worker container family contains the native OCR toolchain:
  OCRmyPDF, Tesseract, Ghostscript, and qpdf.
- Proved the worker image can OCR the same fixture and return normalized text
  containing `OCR RUNTIME READY MASTER SERVICES AGREEMENT`.

### Implementation Map

- `apps/worker/src/lib/extract-text.test.ts`
- `apps/worker/src/lib/__fixtures__/ocr-smoke-scanned.pdf`

### Verification

- `pnpm --filter @bidstack/worker exec vitest run src/lib/extract-text.test.ts --pool=threads --no-file-parallelism --isolate=false`: 8 passed; OCR runtime gate loud-skipped locally because Windows PATH has no OCR tools.
- `pnpm --filter @bidstack/worker exec vitest run src/lib/extract-text.test.ts src/lib/extract-text-sandbox.test.ts --pool=threads --no-file-parallelism --isolate=false`: 13 passed.
- `pnpm --filter @bidstack/worker exec eslint src/lib/extract-text.test.ts`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `docker run --rm bidcrm-worker:latest sh -lc "node --version && ocrmypdf --version && tesseract --version | head -n 1 && gs --version && qpdf --version | head -n 1"`: Node 24.16.0, OCRmyPDF 14.0.1, Tesseract 5.3.0, Ghostscript 10.00.0, qpdf 11.3.0.
- `docker run --rm -v "D:/BIDCRM/apps/worker/src/lib/__fixtures__:/fixtures" -w /app/apps/worker -e BIDSTACK_OCR_ENABLED=true -e BIDSTACK_OCR_LANGUAGES=eng -e BIDSTACK_OCR_TIMEOUT_MS=120000 bidcrm-worker:latest ...`: OCR branch returned `OCR RUNTIME READY MASTER SERVICES AGREEMENT -- 1 of 1 --`.

### Remaining Launch Risks

- The opt-in OCR test is not yet wired into `.github/workflows/ci.yml`; project
  rules protect workflow edits without coordination. Run it in an OCR-capable
  worker-image CI job with `BIDSTACK_OCR_RUNTIME_TEST=1` before release.
- This proves the scanned-PDF parser fallback, not the full browser scanned-PDF
  upload -> BullMQ worker -> contract approval flow. That should reuse the
  existing browser/API/worker E2E once the CI runtime has OCR installed.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-16 Follow-Up 16: Scanned-PDF Browser E2E Gate

### Trigger

Follow-Up 15 proved OCR at the parser/runtime level, but enterprise MSA intake
still needed a product-level browser gate for scanned PDFs: drag/drop a scanned
PDF, finalize the file, enqueue extraction, let the worker OCR it, review the
draft, approve it, and verify the saved agreement.

### Issues Fixed

- Added `apps/web/e2e/fixtures/scanned-msa-e2e.pdf`, an image-only MSA fixture
  with no selectable PDF text. The fixture contains a real reference, countries,
  rebate, dates, rate-review schedule, and rate-card lines.
- Added a Playwright browser test that uploads that scanned PDF and asserts the
  OCR-backed draft fills `MSA-OCR-E2E-001`, `FR, DE, ES`, `7.5`, and
  `Fullstack Architect` at `1100 / day` before approval.
- Changed Playwright worker orchestration so the focused document worker no
  longer hard-disables OCR. OCR is now an explicit opt-in via
  `E2E_DOCUMENT_WORKER_OCR=1` or `BIDSTACK_OCR_ENABLED=true`.
- Added `E2E_DOCUMENT_WORKER_EXTERNAL=1` support so an OCR-capable external
  worker container can satisfy the same health URL while Playwright manages the
  API and web preview.

### Implementation Map

- `apps/web/e2e/serum-account-experience.spec.ts`
- `apps/web/e2e/fixtures/scanned-msa-e2e.pdf`
- `apps/web/playwright.config.ts`

### Verification

- PDF fixture text-layer check with bundled Python/pypdf: selectable text length
  is `0`.
- `docker run --rm -v "D:/BIDCRM/apps/web/e2e/fixtures:/fixtures" -w /app/apps/worker -e BIDSTACK_OCR_ENABLED=true -e BIDSTACK_OCR_LANGUAGES=eng -e BIDSTACK_OCR_TIMEOUT_MS=120000 bidcrm-worker:latest ...`: OCR text included `MASTER SERVICES AGREEMENT`, `Reference: MSA-OCR-E2E-001`, `Countries: FR, DE, ES`, and `Fullstack Architect 1100 / day`.
- `pnpm --filter @bidstack/web exec eslint e2e/serum-account-experience.spec.ts playwright.config.ts`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit -p e2e/tsconfig.json`: pass.
- `pnpm --filter @bidstack/worker test -- src/lib/extract-text.test.ts src/lib/extract-text-sandbox.test.ts`: 13 passed.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=371 E2E_WORKERS=1 E2E_DOCUMENT_WORKER=1 E2E_REDIS_URL=redis://localhost:6380/15 REDIS_URL=redis://localhost:6380/15 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list`: 3 passed, 1 skipped. The skipped test is the new scanned-PDF gate, because OCR was intentionally not enabled for the Windows-local worker run.

### Remaining Launch Risks

- The full scanned-PDF browser/API/BullMQ/worker/approval test is implemented
  but not yet executed green with OCR enabled. Windows PATH still lacks
  OCRmyPDF/Tesseract, and the old local worker image has package metadata drift
  when current source `dist` is mounted into it. Run this in a rebuilt/current
  OCR worker image or an OCR-capable CI job with `E2E_DOCUMENT_WORKER=1`,
  `E2E_DOCUMENT_WORKER_OCR=1`, and isolated Redis.
- `.github/workflows/ci.yml` remains untouched per repo rules. CI wiring for
  this OCR gate still needs explicit coordination.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-16 Follow-Up 17: Upload Reliability And OCR Worker Packaging QA

### Trigger

The next QA slice attempted to run the scanned-PDF browser gate against an
OCR-capable worker image. That exposed three launch-relevant issues before the
full OCR browser test could run: standalone worker image drift, missing OCR OS
detection data, and an upload-finalize transaction timeout under local DB load.

### Issues Fixed

- Updated the standalone worker Dockerfile to mirror the root workspace package
  manifest set (`apps/marketing`, `packages/integrations`) and to use frozen
  lockfile installs with a pnpm cache mount.
- Added `tesseract-ocr-data-osd` to the Alpine worker image. OCRmyPDF can invoke
  Tesseract orientation detection even when `BIDSTACK_OCR_LANGUAGES=eng`; without
  `osd.traineddata`, scanned PDFs can fail before extraction starts.
- Added `DOCUMENT_EXTRACT_WORKER_HEALTH_HOST` to the focused E2E worker harness.
  Local Playwright-managed workers still bind `127.0.0.1`; Dockerized external
  workers can bind `0.0.0.0` so Docker port publishing can expose health.
- Changed `/api/v1/files/finalize` from an interactive Prisma transaction to a
  batch transaction with a pre-generated file UUID. The endpoint still creates
  the file row and audit row atomically, but no longer trips Prisma's 5s
  interactive transaction timeout when Postgres is under IO pressure.
- Raised the drag/drop contract-card E2E timeout to match its real browser/API
  upload-save-cleanup scope.

### Implementation Map

- `apps/worker/Dockerfile`
- `apps/worker/src/e2e/document-extract-worker.ts`
- `apps/api/src/routes/files.ts`
- `apps/web/e2e/serum-account-experience.spec.ts`

### Verification

- `docker image ls bidcrm-worker:e2e-current`: fresh current-source worker image
  exists (`sha256:52b73abb...`, created 2026-06-16T22:27:58Z).
- `docker run --rm bidcrm-worker:e2e-current sh -lc "node --version && pnpm --version && ocrmypdf --version && tesseract --version | head -n 1 && test -f dist/e2e/document-extract-worker.js && test -f dist/lib/contract-extract-fields.js && test -f dist/lib/extract-text.js"`: Node 24.16.0, pnpm 10.0.0, OCRmyPDF 16.11.1, Tesseract 5.5.2, required worker files present.
- OCR smoke with `tesseract-ocr-data-osd` installed at container startup extracted
  `MASTER SERVICES AGREEMENT`, `Reference: MSA-OCR-E2E-001`, `Countries: FR, DE, ES`,
  and `Fullstack Architect 1100` from the image-only scanned MSA fixture.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm --filter @bidstack/worker test -- src/lib/extract-text.test.ts src/lib/extract-text-sandbox.test.ts`: 13 passed.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/files.test.ts`: 12 passed.
- `pnpm --filter @bidstack/web exec eslint e2e/serum-account-experience.spec.ts playwright.config.ts`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit -p e2e/tsconfig.json`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=467 E2E_WORKERS=1 E2E_DOCUMENT_WORKER=1 E2E_REDIS_URL=redis://localhost:6380/15 REDIS_URL=redis://localhost:6380/15 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list --grep "contract card supports"`: 1 passed. This reproduced and verified the file-finalize reliability fix through the browser.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=471 E2E_WORKERS=1 E2E_DOCUMENT_WORKER=1 E2E_REDIS_URL=redis://localhost:6380/15 REDIS_URL=redis://localhost:6380/15 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list`: 3 passed, 1 skipped. The skipped test is the OCR browser gate because OCR is not enabled for the Windows-local worker run.

### Remaining Launch Risks

- The full scanned-PDF browser/API/BullMQ/worker/approval gate still has not run
  green with OCR enabled. Local Docker `run` became unhealthy after the large
  image work and now hangs even for `docker run --rm --pull=never redis:7-alpine
sh -lc "echo docker-run-ok"`. Existing containers and `docker ps` still answer,
  but new container starts are blocked until Docker Desktop is restarted or the
  environment is moved to CI.
- The patched standalone worker Dockerfile itself still needs a clean rebuild
  after the `tesseract-ocr-data-osd` change; the OCR smoke used the current image
  plus startup install as proof of the missing package.
- Slow-query warnings remain visible in local E2E logs for audit-heavy writes.
  The finalize endpoint no longer fails, but 100k-user readiness still needs
  load testing and DB index/query review outside this focused gate.
- `.github/workflows/ci.yml` remains untouched per repo rules. CI wiring for the
  OCR browser gate still needs explicit coordination.
- Full role/browser matrix, Azure/security sign-off, load/security
  certification, downstream `FieldMeta` coverage, and INP `<100ms` headroom
  remain open.

---

## 2026-06-17 Follow-Up 24: Deploy Image Vulnerability Gate

### Trigger

The local dependency/SAST gates were green, but deploy images still needed a
container-layer vulnerability gate. A workspace `pnpm audit` cannot see base OS
packages, global npm trees from Node images, or nginx runtime packages.

### Issues Fixed

- Added `scripts/run-container-vulnerability-scan.mjs` and root
  `pnpm container:scan`, using pinned Dockerized Trivy
  `aquasec/trivy:0.71.1`.
- Included all local deploy images in the default scan set: API, web, worker,
  MCP, and migrate.
- Upgraded Docker/Corepack pnpm from `10.0.0` to `10.27.0`.
- Removed global npm/Corepack/pnpm trees and shims from Node runtime images
  after package installation. API, worker, MCP, and migrate start through
  `node` or a package-local Prisma binary, not package-manager launchers.
- Added `apk upgrade --no-cache` to the nginx web stage, fixing HIGH Alpine
  findings in OpenSSL/libxml2 packages.
- Kept the migration target schema-only, non-root, and independent from the
  full product builder.

### Verification

- `docker build --target migrate -f Dockerfile -t bidcrm-migrate:nonroot-probe .`: pass.
- `docker run --rm --network bidcrm_default -e DATABASE_URL=postgres://bidstack:bidstack@postgres:5432/bidstack bidcrm-migrate:nonroot-probe`: pass, `65 migrations found`, `No pending migrations to apply`.
- `docker build --target api -f Dockerfile -t bidcrm-api:root-api-user-probe .`: pass.
- `docker build --target web -f Dockerfile -t bidcrm-web:root-web-probe .`: pass.
- `docker build --target worker -f Dockerfile -t bidcrm-worker:root-current-osd .`: pass.
- `docker build --target mcp-server -f Dockerfile -t bidcrm-mcp:root-mcp-user-probe .`: pass.
- Runtime probes: API, worker, MCP, and migrate run as `bidstack`; global npm
  tree removed; worker still has Node `24.16.0`, OCRmyPDF `16.11.1`, qpdf
  `12.3.2`, and Tesseract `eng` + `osd`.
- `pnpm container:scan`: pass across API, web, worker, MCP, and migrate;
  every image reported `CRITICAL:0 HIGH:0`.
- `pnpm audit`: pass, no known vulnerabilities.
- `pnpm security:scan`: pass, 1381 mirrored source/config files, 35 blocking
  Semgrep rules, 0 findings.
- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `pnpm exec eslint --no-ignore scripts/run-container-vulnerability-scan.mjs`: pass.
- `git diff --check -- Dockerfile package.json scripts/run-container-vulnerability-scan.mjs pnpm-lock.yaml`: pass, with only Windows LF-to-CRLF warnings.

### Remaining Launch Risks

- Follow-Up 25 closed the BuildKit ARG/ENV warning residual and the web nginx
  default-runtime residual.
- Full-history gitleaks still requires credential rotation/history disposition.
- Clerk-backed staging auth proof, Azure/security sign-off, production-scale
  distributed load proof, downstream `FieldMeta` coverage, and INP `<100ms`
  headroom remain open. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 25: Web Container Hardening Residuals

### Trigger

The deploy-image vulnerability gate was clean, but two hardening residuals were
still open: BuildKit warned on secret-like build arg/env names, and the web
image still used the official nginx default runtime model.

### Issues Fixed

- Renamed Docker build args to non-secret-like names:
  `PUBLIC_CLERK_PUBLISHABLE` and `BIDSTACK_WEB_BUILD_MODE`.
- Removed the Dockerfile `ENV VITE_CLERK_PUBLISHABLE_KEY=...` layer. The Vite
  build still receives the publishable Clerk key only as an inline build-time
  environment value for the web build command.
- Removed unused web build args from the API compose target.
- Updated production compose and the Azure workflow draft so only the web
  target receives the Clerk publishable build value.
- Switched the web image to `nginxinc/nginx-unprivileged:alpine`, serving on
  container port `8080`.
- Updated Azure Container Apps web ingress from target port `80` to `8080`.
- Moved the web healthcheck to `http://127.0.0.1:8080/health`, avoiding
  ambiguous `localhost` resolution inside the unprivileged nginx image.
- Changed nginx API proxying to a variable upstream with Docker resolver and
  bounded timeouts. This lets the static web image start and serve `/health`
  and `/` even when the backend DNS name is absent; `/api` fails fast instead
  of preventing nginx startup.

### Implementation Map

- `Dockerfile`
- `apps/web/nginx.conf`
- `docker-compose.prod.yml`
- `infra/azure/deploy.workflow.yml.draft`
- `infra/azure/main.bicep`
- `infra/azure/README.md`

### Verification

- `docker build --pull=false --progress=plain --target web -f Dockerfile --build-arg BIDSTACK_WEB_BUILD_MODE=clerk --build-arg PUBLIC_CLERK_PUBLISHABLE=pk_test_dummy --build-arg VITE_API_URL=/api -t bidcrm-web:root-web-probe .`:
  pass. No `SecretsUsedInArgOrEnv` BuildKit warning appeared.
- Final web image id:
  `sha256:25fe4e70133316b0c8e1a6102c74ed79d4289171e5cabc5e5982c3c945f5c8a2`.
- `docker image inspect bidcrm-web:root-web-probe`: `User=nginx`,
  `Exposed={"8080/tcp":{}}`, healthcheck uses
  `http://127.0.0.1:8080/health`.
- Runtime probe on `127.0.0.1:18083`: Docker health became `healthy`; inside
  `id` returned `uid=101(nginx)`; `nginx -t` exited 0; inside
  `127.0.0.1:8080/health` returned `healthy`; host `/health` and `/` returned
  HTTP 200.
- Runtime API-proxy negative proof: host `/api/v1/health` returned HTTP 502 in
  `2.03s` when the backend DNS name was absent, and the web container remained
  `State=running Health=healthy`.
- `docker compose -f docker-compose.prod.yml config --quiet`: pass with the
  required production env contract populated by dummy values.
- `pnpm container:scan`: pass across API, web, worker, MCP, and migrate;
  every image reported `CRITICAL:0 HIGH:0`.
- `pnpm security:scan`: pass, 1380 files scanned by Semgrep, 35 blocking rules,
  0 findings.
- `pnpm audit`: pass, no known vulnerabilities.
- `git diff --check -- Dockerfile apps/web/nginx.conf docker-compose.prod.yml infra/azure/deploy.workflow.yml.draft infra/azure/main.bicep infra/azure/README.md ...`:
  pass, with only Windows LF-to-CRLF warnings.

### Remaining Launch Risks

- Full-history gitleaks still requires credential rotation/history disposition.
- Clerk-backed staging auth proof, Azure/security sign-off, production-scale
  distributed load proof, downstream `FieldMeta` coverage, and INP `<100ms`
  headroom remain open. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 26: Contract Field Provenance UX

### Trigger

Continued the downstream `FieldMeta`/provenance launch blocker from
`C:/Users/Tony/Downloads/bitstack-backlog-validation.md`. The cockpit business
snapshot and technical stack already exposed source badges, but legal/MSA
agreement terms still displayed reference, coverage, rebate, rate-review, and
rate-card values without an obvious source trail.

### Issues Fixed

- Added `ContractFieldProvenance` and `fieldSources` to the shared
  `ContractAgreement` response schema.
- Contract agreement API serialization now returns field-level provenance for
  manual entries, document-linked entries, and human-reviewed extraction entries.
- Reviewed extraction provenance distinguishes `derived:llm` from
  `derived:deterministic`, carries confidence, source document id/name,
  extraction id, and a human-readable hint.
- The account contract card now renders compact source badges beside the
  contract reference, summary field group, review dates when present, expiry
  when present, and rate-card table.
- Added runtime-compatible fallback provenance in the UI so old cached rows do
  not render source-less legal data.

### Implementation Map

- `packages/shared/src/schemas/contract-agreement.ts`
- `apps/api/src/routes/contract-agreements.ts`
- `apps/api/src/routes/contract-agreements.integration.test.ts`
- `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`
- `apps/web/src/components/account-intel/ContractAgreementsCard.test.tsx`
- `docs/solutions/account-field-provenance-badges.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/shared typecheck`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/contract-agreements.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/web test -- src/components/account-intel/ContractAgreementsCard.test.tsx`: 1 pass.
- Targeted ESLint for touched API, web, and shared files: pass.
- Live in-app browser QA on `http://127.0.0.1:5173/accounts/mantu`: created a
  temporary agreement for the cockpit company id, verified the contract card
  rendered manual badges for reference, field group, and rate card with no
  console errors, then deleted both temporary QA agreements and verified zero
  remaining temp rows.

### Remaining Launch Risks

- This closes the legal/MSA contract-card provenance gap, but not every
  downstream account-intel field has a persisted `FieldMeta` model yet.
- Full role/browser matrix, Azure/security sign-off, production-scale
  distributed load proof, full-history gitleaks disposition, Clerk-backed
  staging auth, and INP `<100ms` headroom remain open. Still not
  Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 27: Key Account Industry Pagination

### Trigger

Continued Tony's account/industry UX request after the performance gates passed.
The `GET /api/v1/accounts/key` endpoint was already cursor-paginated and
supported server-side `industry`, but the web hook/page only consumed the first
page and filtered industry locally. At 100k-user/account scale, that can make an
industry filter look empty or undercounted even when matching key accounts exist
past the first slice.

### Issues Fixed

- `useKeyAccounts` now exposes the backend `{ items, nextCursor }` envelope
  instead of dropping `nextCursor`.
- The hook sends `industry`, `limit`, `cursor`, and the React Query abort
  `signal`, so quick filter changes do not keep stale in-flight requests alive.
- The Key Accounts page now uses server-side industry filtering with bounded
  page size instead of filtering only the current client slice.
- The page uses the shared `CursorPager` convention, matching Companies, Leads,
  Contacts, and Opportunities.
- The industry signal panel keeps a wider bounded sample so the interactive
  industry cards remain useful after a filter is selected.

### Implementation Map

- `apps/web/src/hooks/useKeyAccounts.ts`
- `apps/web/src/hooks/useKeyAccounts.pagination.test.tsx`
- `apps/web/src/pages/KeyAccountsPage.tsx`
- `docs/solutions/account-cursor-pagination-contract.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/hooks/useKeyAccounts.pagination.test.tsx`: 2 pass.
- `pnpm --filter @bidstack/web exec eslint src/hooks/useKeyAccounts.ts src/hooks/useKeyAccounts.pagination.test.tsx src/pages/KeyAccountsPage.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=617 E2E_WORKERS=1 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --reporter=list --grep "SERUM status and industry panels"`: 1 pass.
- The Playwright run built the production web bundle and proved:
  - `/settings?tab=serum` returned live SERUM JSON with no unavailable state.
  - `/key-accounts` rendered the industry signal, clicked an industry, issued
    `/api/v1/accounts/key?industry=Testing&limit=50`, and reset successfully.
  - `/top-accounts` kept its industry panel interaction green.

### Remaining Launch Risks

- This closes the first-page-only Key Accounts filter gap, but not the broader
  launch blockers: full role/browser matrix, Azure/security sign-off,
  production-scale distributed load proof, full-history gitleaks disposition,
  Clerk-backed staging auth, remaining downstream `FieldMeta` coverage, and INP
  `<100ms` headroom. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 28: Account Intel Source Confidence Badges

### Trigger

Continued the downstream `FieldMeta`/provenance launch blocker after closing
Key Accounts pagination. The legal/MSA contract card had explicit source badges,
but Account Intelligence solution/product cards still showed only a plain
`From:` line when a source document was available and did not expose exact
confidence for every card.

### Issues Fixed

- Solutions and products now render shared cockpit `SourceBadge` components for
  source and exact confidence.
- Document-derived records show the source document name with an accessible hint
  such as `Extracted from solution-brief.pdf with 85% confidence.`
- Manual/non-document records show a safe `Manual` source fallback plus exact
  confidence, so old or non-extracted rows are not source-less.
- Removed the binary high-confidence-only treatment; every row now exposes its
  actual confidence percentage.

### Implementation Map

- `apps/web/src/components/account-intel/IntelTabs.tsx`
- `apps/web/src/components/account-intel/IntelTabs.test.tsx`
- `docs/solutions/account-intel-source-confidence-badges.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/account-intel/IntelTabs.test.tsx`: 2 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/account-intel/IntelTabs.tsx src/components/account-intel/IntelTabs.test.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=621 E2E_WORKERS=1 playwright test e2e/accounts.spec.ts --project=chromium-desktop --reporter=list`: 1 pass, including production build and account cockpit `/api/v1/accounts/:id/intel` request.

### Remaining Launch Risks

- This improves the account-intel display layer for solutions/products, but a
  persisted cross-surface `FieldMeta` model is still incomplete. Broader launch
  blockers remain: full role/browser matrix, Azure/security sign-off,
  production-scale distributed load proof, full-history gitleaks disposition,
  Clerk-backed staging auth, and INP `<100ms` headroom. Still not
  Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 29: Viewer Persona RBAC Browser Matrix

### Trigger

The E2E fixture layer already advertised a `viewer` persona, but the full
role/browser matrix did not assert it. At Salesforce-grade scale, a defined but
untested persona is a permission-risk smell, especially because `viewer` maps
onto the canonical `Read-Only` system role rather than a separate product role.

### Issues Fixed

- Added an API integration test proving `x-bidstack-e2e-role: viewer` resolves
  to `legacyRole=member`, the `Read-Only` system role, `accounts:read`, no
  `audit-log:read`, and no `*:write` permissions.
- Added a web E2E test proving the browser `viewer` persona is read-only and
  cannot reach the admin-only Audit Log route.
- Fixed the stub auth identity collision where `viewer` and `read-only` both
  derived `clerkUser=e2e_read_only` from the shared system role name. E2E
  persona `clerkUser` values are now explicit and stable.

### Implementation Map

- `apps/api/src/plugins/auth.ts`
- `apps/api/src/routes/users.roles.integration.test.ts`
- `apps/web/e2e/flows/rbac.spec.ts`
- `docs/solutions/rbac-e2e-viewer-persona.md`

### Verification

- `pnpm --filter @bidstack/api exec eslint src/plugins/auth.ts src/routes/users.roles.integration.test.ts`: pass.
- `pnpm --filter @bidstack/web exec eslint e2e/flows/rbac.spec.ts`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/users.roles.integration.test.ts`: 6 pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=629 E2E_WORKERS=1 playwright test e2e/flows/rbac.spec.ts --reporter=list`: 16 pass / 2 expected skips across Chromium, Firefox, and WebKit.

### Remaining Launch Risks

- This closes the local role/browser matrix gap, but not Clerk-backed staging
  auth proof. Production launch still needs real Clerk/Azure authorization
  proof, Azure/security sign-off, production-scale distributed load proof,
  full-history gitleaks disposition, remaining downstream `FieldMeta` coverage,
  and INP `<100ms` headroom. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 30: Account Signal Coverage Explainability

### Trigger

Backlog item #9 requires Signal Coverage to explain why a score is weak and
what the next action should be. The Accounts page computed coverage gaps and
showed aggregate top gaps, but each account card still mostly exposed a
percentage. That made the account section feel decorative instead of
operational.

### Issues Fixed

- `deriveAccount` now returns deterministic coverage explainability:
  `present`, `missing`, `reason`, and `nextAction`.
- Account cards now render compact signal guidance below the confidence and
  coverage metrics, with accessible labels such as `Missing Industry, Tech
stack, and FTE. Next: Assign an industry to unlock sector routing.`
- The guidance uses fixed 44px minimum height, overflow-safe text wrapping, and
  distinct warning/success treatments without adding nested cards.
- Added unit and component regressions so both the derivation contract and the
  visible card UX are protected.

### Implementation Map

- `apps/web/src/pages/accountsPage/accountUtils.ts`
- `apps/web/src/pages/accountsPage/accountUtils.test.ts`
- `apps/web/src/pages/accountsPage/AccountCard.tsx`
- `apps/web/src/pages/accountsPage/AccountCard.test.tsx`
- `apps/web/src/index.css`
- `docs/solutions/account-signal-coverage-explainability.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/pages/accountsPage/accountUtils.test.ts src/pages/accountsPage/AccountCard.test.tsx`: 4 pass.
- `pnpm --filter @bidstack/web exec eslint src/pages/accountsPage/accountUtils.ts src/pages/accountsPage/accountUtils.test.ts src/pages/accountsPage/AccountCard.tsx src/pages/accountsPage/AccountCard.test.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- In-app browser QA on `http://127.0.0.1:5173/accounts`: 13 account cards,
  coverage insights rendered, zero console errors, and no horizontal overflow.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=633 E2E_WORKERS=1 playwright test e2e/accounts.spec.ts --project=chromium-desktop --reporter=list`: 1 pass with production build.

### Remaining Launch Risks

- This closes the visible Accounts-page signal explainability slice, but not
  every signal surface in the product. Remaining blockers: Clerk-backed staging
  auth proof, Azure/security sign-off, production-scale distributed load proof,
  full-history gitleaks disposition, remaining downstream `FieldMeta` coverage,
  and INP `<100ms` headroom. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 31: Strategic Account Signal Explainability

### Trigger

After Account cards gained deterministic Signal Coverage guidance, the related
Key Accounts, Top Accounts, and Sector View surfaces still presented strategic
account and industry data mostly as counts, bars, and percentages. That left
the user asking why an account or sector mattered and what to do next.

### Issues Fixed

- Added a pure strategic-signal rules module for Key Accounts, Top Accounts,
  sector coverage, and sector account rows.
- Added a reusable `StrategicSignalInsight` component with warning/success
  treatments, 44px-safe touch sizing, accessible labels, and overflow-safe
  wrapping.
- Key Accounts now shows account-level reason plus `Next:` action below each
  strategic card's pipeline/contact metrics.
- Top Accounts now shows rank-specific reasoning for curated versus auto-ranked
  accounts, including buyer/revenue recovery actions.
- Sector View now shows selected-sector coverage gaps and row-level next
  actions for missing domain, FTE, verified source, or low confidence.

### Implementation Map

- `apps/web/src/pages/accountsPage/strategicSignals.ts`
- `apps/web/src/pages/accountsPage/strategicSignals.test.ts`
- `apps/web/src/pages/accountsPage/StrategicSignalInsight.tsx`
- `apps/web/src/pages/KeyAccountsPage.tsx`
- `apps/web/src/pages/TopAccountsPage.tsx`
- `apps/web/src/pages/SectorViewPage.tsx`
- `apps/web/src/index.css`
- `docs/solutions/strategic-account-signal-explainability.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/pages/accountsPage/strategicSignals.test.ts`: 4 pass.
- `pnpm --filter @bidstack/web exec eslint src/pages/accountsPage/strategicSignals.ts src/pages/accountsPage/strategicSignals.test.ts src/pages/accountsPage/StrategicSignalInsight.tsx src/pages/KeyAccountsPage.tsx src/pages/TopAccountsPage.tsx src/pages/SectorViewPage.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- In-app browser QA on `http://127.0.0.1:5173/key-accounts`, `/top-accounts`,
  and `/sector-view`: strategic insights rendered, key/top filters toggled,
  sector and country selectors toggled, zero console errors, and no horizontal
  overflow on desktop or 390px mobile viewport.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=641 E2E_WORKERS=1 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=645 E2E_WORKERS=1 playwright test e2e/accounts.spec.ts --project=chromium-desktop --reporter=list`: 1 pass with production build.

### Remaining Launch Risks

- This closes the Key/Top/Sector strategic explainability gap, but not the full
  Salesforce/100k certification. Remaining blockers: Clerk-backed staging auth
  proof, Azure/security sign-off, production-scale distributed load proof,
  full-history gitleaks disposition, remaining downstream `FieldMeta` coverage,
  and INP `<100ms` headroom.

---

## 2026-06-17 Follow-Up 32: Performance Evidence And Sidebar INP Headroom

### Trigger

The production Core Web Vitals gate passed, but it did not persist measured
values on successful runs. After adding measurement evidence, the dashboard
synthetic INP signal showed a real premium-headroom miss: 144ms against the
stricter 100ms target, while still passing the 200ms launch budget.

### Issues Fixed

- Core Web Vitals tests now attach per-test JSON evidence and write
  `apps/web/playwright-report/core-web-vitals-latest.json` with route, metric,
  value, unit, budget, headroom, status, and run timestamps.
- Sidebar collapse no longer routes the app-shell grid state through a React
  subscription that can re-render the dashboard page during an urgent click.
  The grid width is now driven by a document data flag while the sidebar
  component alone re-renders for its collapsed internals.
- Sidebar collapse removed layout-affecting padding/gap/max-width transitions
  from the click path; cosmetic color/opacity polish remains.
- Added a focused store regression proving the document sidebar flag updates
  immediately and section disclosure state stays scoped to the sidebar.

### Implementation Map

- `apps/web/e2e/performance/core-web-vitals.spec.ts`
- `apps/web/src/stores/ui.ts`
- `apps/web/src/stores/ui.test.ts`
- `apps/web/src/components/layout/AppShell.tsx`
- `apps/web/src/index.css`
- `docs/solutions/sidebar-collapse-inp-headroom.md`

### Verification

- `pnpm --filter @bidstack/web exec eslint src/stores/ui.ts src/stores/ui.test.ts src/components/layout/AppShell.tsx e2e/performance/core-web-vitals.spec.ts`: pass.
- `pnpm --filter @bidstack/web test -- src/stores/ui.test.ts src/lib/queryCache.test.ts`: 7 pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=656 E2E_WORKERS=1 playwright test e2e/performance/core-web-vitals.spec.ts --project=chromium-desktop --reporter=list`: 10 pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_BASE_URL=http://127.0.0.1:1 playwright test e2e/performance/bundle-size-budget.spec.ts --project=chromium-desktop --reporter=list`: 4 pass.
- Latest `core-web-vitals-latest.json`: dashboard LCP 912ms, dashboard CLS
  0.0008, pipeline LCP 588ms, leads LCP 728ms, opportunities LCP 940ms,
  dashboard INP 96ms, dashboard-to-leads SPA navigation 142ms.

### Remaining Launch Risks

- This closes the local dashboard INP headroom miss and adds durable lab
  evidence, but it is still not production RUM or distributed load proof.
  Remaining blockers: Clerk-backed staging auth proof, Azure/security sign-off,
  production-scale distributed load proof, full-history gitleaks disposition,
  and remaining downstream `FieldMeta` coverage.

---

## 2026-06-17 Follow-Up 33: Idle Auth Recovery Browser Gate

### Trigger

Tony reported that after staying on a page for a while, the app could require a
logout/login cycle. Unit coverage already proved one forced token-refresh retry,
but there was no browser-level production-preview gate proving a live page
recovers from an auth-status response without showing the SERUM unavailable
state.

### Issues Fixed

- Added a focused Playwright regression that runs the app in demo auth mode,
  seeds a real browser token provider, loads SERUM Mission Control, returns one
  forced `401` on refresh, then proves the retry returns a healthy snapshot.
- The spec asserts the SERUM unavailable banner does not appear after the forced
  retry and that every SERUM request carries the expected bearer token.
- Playwright managed web builds now honor `E2E_AUTH_MODE`/`VITE_AUTH_MODE`
  instead of calling the package `build` script that hardcoded
  `VITE_AUTH_MODE=stub`.
- Default stub-auth storage remains scoped to stub mode only, so demo and Clerk
  E2E runs can prove their own auth path instead of inheriting the stub session.

### Implementation Map

- `apps/web/playwright.config.ts`
- `apps/web/e2e/flows/idle-auth-recovery.spec.ts`
- `docs/solutions/idle-auth-refresh-and-focus-refetch.md`

### Verification

- `pnpm --filter @bidstack/web exec eslint playwright.config.ts e2e/flows/idle-auth-recovery.spec.ts`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_AUTH_MODE=demo E2E_PORT_OFFSET=658 E2E_WORKERS=1 playwright test e2e/flows/idle-auth-recovery.spec.ts --project=chromium-desktop --reporter=list`: 1 pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=659 E2E_WORKERS=1 playwright test e2e/flows/auth.spec.ts --project=chromium-desktop --reporter=list --grep "stub-auth mode auto-authenticates"`: 1 pass.

### Remaining Launch Risks

- This is a production-preview browser regression for the stale-token recovery
  class, not a real Clerk staging sign-in proof. Remaining blockers:
  Clerk-backed staging auth with real Clerk credentials, Azure/security
  sign-off, production-scale distributed load proof, full-history gitleaks
  disposition, and remaining downstream `FieldMeta` coverage.

---

## 2026-06-17 Follow-Up 34: Load Certification Artifact And Non-Local Guard

### Trigger

The root k6 load gate could prove local CRM read paths, but it still left too
much room for launch overclaim: successful runs did not write a compact
certification artifact, and a staging/production target without `API_TOKEN`
could accidentally run as if unauthenticated checks were enough.

### Issues Fixed

- `pnpm load-test` now writes ignored run evidence under `load-test-report/`:
  the raw `k6-summary-latest.json` and a compact
  `production-load-latest.json` with runner, profile, target, thresholds,
  metrics, and pass/fail verdict.
- The runner now fails closed for non-local targets without `API_TOKEN` unless
  the operator explicitly sets `SKIP_AUTHENTICATED_ROUTES=true`.
- Added `pnpm load-test:certify`, which runs the new `certification` profile and
  rejects health-only mode.
- k6 now supports `smoke`, `full`, `baseline`, `stress`, `soak`, and
  `certification` profiles plus threshold overrides for p95, failure rate, and
  check rate.
- `load-test-report/` is ignored so successful evidence can be regenerated
  locally or in CI without polluting source control.

### Implementation Map

- `scripts/run-k6-load-test.mjs`
- `scripts/load-test.js`
- `package.json`
- `.gitignore`
- `docs/solutions/k6-load-gate-docker-fallback.md`

### Verification

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-k6-load-test.mjs scripts/load-test.js`: pass.
- `API_BASE_URL=http://127.0.0.1:4000 K6_DURATION_PROFILE=smoke pnpm load-test`: pass with Docker fallback, authenticated local CRM routes, `80/80` checks, p95 `15.58ms`, `0.00%` failed HTTP responses, and `production-load-latest.json` `passed: true`.
- Non-local no-token guard probe against `https://staging.bidstack.invalid`: exited `1` before k6 ran and printed the required auth-proof warning.

### Remaining Launch Risks

- This closes the local evidence/guard gap, not the real external certification.
  Remaining blockers: Clerk-backed staging auth with real Clerk credentials,
  Azure/security sign-off, production-scale distributed load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage.

---

## 2026-06-17 Follow-Up 35: Versioned SERUM Settings Spine

### Trigger

Tony supplied the Codex Master Prompt and asked for the Walteur framework to be
implemented deeply. The brief requires SERUM settings to be real, versioned,
audited, reversible, secret-safe, and honest. The existing SERUM settings panel
showed the 24-section map and live status, but Save draft, Publish, and
Rollback were not connected to durable backend state.

### Issues Fixed

- Added durable `SerumConfigVersion` persistence scoped by org, config type,
  config key, environment, and monotonic version.
- Added shared schemas for the 24 SERUM config sections, environments, statuses,
  snapshots, draft upsert, publish, and rollback payloads.
- Added settings-gated API routes to read config snapshots, save drafts,
  publish drafts, and create rollback versions.
- Config writes reject raw secret-looking fields such as API keys, passwords,
  credentials, and secrets; operators must store secret references instead.
- Config mutations run in transactions with advisory locks to prevent duplicate
  version races, and each draft/publish/rollback writes an audit-log event.
- Live config snapshots return `Cache-Control: no-store` to avoid stale
  control-plane state after idle sessions.
- The SERUM settings UI now renders a real General deployment policy editor
  with JSON validation, change-reason validation, version badges, a version
  inspector, and working Save draft / Publish / Rollback controls.
- Focused browser coverage now verifies the settings page loads both SERUM
  status and versioned config snapshot JSON before checking the editor controls
  and the dynamic industry/account filters.

### Implementation Map

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260617123000_serum_config_versions/migration.sql`
- `packages/shared/src/schemas/serum.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/web/src/hooks/useSerumConfig.ts`
- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db generate`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts`: pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 2 pass.
- `pnpm --filter @bidstack/web exec eslint e2e/serum-account-experience.spec.ts src/hooks/useSerumConfig.ts src/components/settings/SerumControlPlaneSection.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.
- `git diff --check` on touched files: pass, except Git's existing LF-to-CRLF notice for `packages/db/prisma/schema.prisma`.

### Remaining Launch Risks

- This closes the first durable SERUM settings spine, not the full 24-section
  control-plane implementation. Remaining SERUM blockers include typed config
  forms/test actions for each section, approval workflows for high-risk
  settings, agent/loop/tool/model-router backends, prompt/eval governance,
  connector rollout, and production observability/budget enforcement.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 40: SERUM Dual-Control Approval Separation

### Trigger

Follow-Up 39 added the high-risk approval gate, but it still allowed the same
admin to request and approve a high-risk SERUM draft. That is not acceptable
for enterprise change control. Industry-grade privileged changes need
separation of duties, immutable request evidence, and a publish gate that fails
closed if stored approval evidence is inconsistent.

### Issues Fixed

- Added `approvalRequestedByCurrentUser` to the shared config-version response
  so the UI can tell when the signed-in admin is the original requester.
- Request approval is now immutable after it enters `requested`; a second admin
  cannot re-request the draft to replace the original requester.
- Approve now rejects the original requester with a 409 conflict and requires a
  different admin account.
- Publish now rejects high-risk drafts when requester and approver are the same
  user, even if storage has been manually marked `approved`.
- Request, approve, and publish now acquire the config advisory lock, re-read
  the config version under lock, and only then validate state. This closes a
  stale pre-lock race where concurrent approval requests could swap requester
  evidence.
- SERUM Settings now disables self-approval for the requester and explains that
  another admin must approve the draft.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/settings/SerumControlPlaneSection.tsx src/hooks/useSerumConfig.ts e2e/serum-account-experience.spec.ts`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 6 pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=910 E2E_WORKERS=1 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.
- In-app browser smoke on `http://127.0.0.1:5173/settings?tab=serum`: Agents high-risk section rendered, Approval gate/actions present, dual-admin copy present, unavailable banner count 0, console errors 0.
- Screenshot evidence: `.forge/qa/serum-dual-control-settings-2026-06-17.png`.

### Remaining Launch Risks

- Dual-control is enforced for high-risk SERUM config publish, but live
  execution/apply paths for agents, loops, model routing, tools, connectors,
  prompts, retrieval, and eval execution remain open.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 41: SERUM Runtime Policy Apply Path

### Trigger

High-risk SERUM drafts could be typed, tested, dual-admin approved, and
published, but published policy still needed a backend authority that execution
surfaces can call before starting agent runs, invoking tools, or routing model
requests.

### Issues Fixed

- Added shared runtime policy and decision schemas for Agents, Tools, and Model
  Router.
- Added a backend runtime-policy resolver that reads the active published
  version for the runtime config keys: `agents/registry`, `tools/registry`, and
  `model_router/routing`.
- Added `GET /api/v1/serum/runtime-policy` with `Cache-Control: no-store` so
  operators and future workers can inspect the effective runtime policy.
- Added no-store runtime check endpoints:
  `/api/v1/serum/runtime-policy/agents/:configKey/check`,
  `/api/v1/serum/runtime-policy/tools/:configKey/check`, and
  `/api/v1/serum/runtime-policy/model-router/:configKey/check`.
- Runtime checks fail closed when no active policy is published, a section is
  disabled, an agent lacks approval/allowlist/concurrency, a tool is not in the
  explicit allowlist or violates dry-run rules, or a model route lacks provider,
  citation, token-budget, credential, or uncertainty safeguards.
- Added focused integration coverage that publishes approved high-risk Agents,
  Tools, and Model Router configs, then proves allowed and denied runtime
  decisions before execution.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `apps/api/src/lib/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec eslint src/lib/serum-runtime-policy.ts src/routes/serum.ts src/routes/serum.integration.test.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass after widening the runtime tool-scope map for dynamic tool names.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/web typecheck`: pass.

### Remaining Launch Risks

- This adds a real backend runtime policy read/check/apply authority. Existing
  workers, MCP execution, and future agent loops still need to be wired to call
  it before every execution path.
- Runtime policy coverage is now implemented for Agents, Tools, and Model
  Router. Loops, connectors, prompt library, retrieval, eval execution, and
  Dust/MCP gateway runtime application remain open.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 36: SERUM 24-Section Settings Workbench

### Trigger

Follow-Up 35 connected the General SERUM deployment policy to durable
versioned persistence, but Tony's prompt requires the whole SERUM control plane
to feel like a real enterprise operator experience: 24 governed sections, live
status, test actions, draft/publish/rollback controls, validation, and audit
history instead of a static map.

### Issues Fixed

- The SERUM settings page now exposes all 24 governed sections from the master
  prompt as selectable, status-aware control tiles.
- Each section opens a shared premium workbench with live snapshot loading,
  config JSON, change reason, validation, Test, Save draft, Publish, Rollback,
  version history, and audit history.
- Generic section defaults are now secret-safe by design; high-risk settings
  use secret references and policy fields rather than raw API keys/passwords.
- The config snapshot API now returns real audit trail rows for returned config
  versions, so the UI can show who changed what and when.
- Browser coverage now proves a second, non-General section (`Agents`) fetches
  its own live config snapshot and renders editable JSON.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/settings/SerumControlPlaneSection.tsx src/hooks/useSerumConfig.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 2 pass.
- `pnpm --filter @bidstack/web exec eslint e2e/serum-account-experience.spec.ts src/components/settings/SerumControlPlaneSection.tsx src/hooks/useSerumConfig.ts`: pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.

### Remaining Launch Risks

- This is a real generic 24-section versioned settings workbench, not the final
  per-domain business implementation for every SERUM subsystem. Remaining
  SERUM blockers include typed forms per section, real test actions for agents,
  loops, tools, connectors, retrieval, prompts, and model routing, approval
  workflows for high-risk production changes, and live enforcement hooks into
  each backend subsystem.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 37: SERUM Config Test Gates

### Trigger

Follow-Up 36 made every SERUM settings section selectable and editable, but the
Test button still behaved like a refresh. For a high-risk enterprise control
plane, Test has to evaluate the candidate config against backend-owned rules
before operators trust Save/Publish.

### Issues Fixed

- Added shared schemas for candidate config test requests, check rows, and
  pass/warn/fail test results.
- Added `POST /api/v1/serum/configs/:configType/:configKey/test`, gated by
  `settings:write` plus admin role, with `Cache-Control: no-store`.
- The test route does not persist config versions; it evaluates the submitted
  JSON and returns deterministic readiness checks.
- High-risk SERUM sections now have backend-owned checks for raw secrets,
  approval gates, agent allowlists, concurrency caps, durable loop events,
  source citations, token caps, write-tool dry-run requirements, connector
  connection tests, prompt injection tests, and eval release gates.
- The SERUM settings Test button now posts the current editor JSON to the API,
  shows pass/warn/fail toasts, and renders the returned checklist in the
  workbench inspector.
- Focused Playwright now proves the Agents section Test button calls the
  backend `/test` route and renders the `Config test` / `Human approval`
  readiness result.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/web/src/hooks/useSerumConfig.ts`
- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/settings/SerumControlPlaneSection.tsx src/hooks/useSerumConfig.ts e2e/serum-account-experience.spec.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 3 pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.

### Remaining Launch Risks

- These are deterministic config preflight gates, not live execution tests for
  every subsystem. Remaining SERUM blockers include typed per-section forms,
  backend-enforced apply paths, approval workflows, and real integration tests
  for agents, loops, model routing, tools, connectors, prompts, retrieval, and
  eval execution.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 38: SERUM Typed High-Risk Controls

### Trigger

The SERUM control plane had real versioning and backend test gates, but
operators still had to edit high-risk sections primarily through JSON. For a
Salesforce-grade admin experience, risky settings need direct controls for the
fields an admin reviews every day, while keeping the audited JSON contract as
the source of truth.

### Issues Fixed

- Added structured Operator controls to the high-risk SERUM sections: Agents,
  Loops, Model Router, Tools, Connectors, Prompt Library, Evals, and Dust/MCP
  Gateway.
- The controls edit the same canonical JSON textarea used by Save draft,
  Publish, Rollback, and Test, so no second persistence path was introduced.
- Agents now exposes enabled state, autonomy, concurrency, human approval, and
  allowed-agent list as accessible controls.
- Loops, Model Router, Tools, Connectors, Prompt Library, Evals, and Dust/MCP
  Gateway now expose their core enablement, allowlist, test, approval, and
  threshold fields through typed switches, selects, numeric inputs, and list
  inputs.
- The config test results panel now has an accessible `Config test results`
  region so browser QA can scope readiness assertions even when labels repeat
  elsewhere on the page.
- Focused Playwright now toggles the Agents enabled switch, edits concurrency,
  writes an allowlist, proves the JSON changed, posts to the backend `/test`
  endpoint, and then re-verifies key/top account industry filters.

### Implementation Map

- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/web exec eslint src/components/settings/SerumControlPlaneSection.tsx e2e/serum-account-experience.spec.ts`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- First focused Playwright run failed on an ambiguous `Human approval` locator
  after adding the new switch; fixed by scoping to `Config test results`.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=814 E2E_WORKERS=1 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.

### Remaining Launch Risks

- Typed controls improve operator UX, but they are still deterministic config
  controls. Live execution/apply paths for agents, loops, model routing, tools,
  connectors, prompts, retrieval, and eval execution remain open.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 39: SERUM High-Risk Approval Gate

### Trigger

Follow-Up 38 gave operators typed controls for high-risk SERUM sections, but a
high-risk draft could still be published if the operator skipped the approval
step. Salesforce-grade admin governance needs a backend-enforced request,
approve, audit, and publish gate. The UI also has to make that state visible so
operators understand why Publish is blocked.

### Issues Fixed

- Added approval state to `SerumConfigVersion`: status, requested timestamp,
  requester, approved timestamp, and approval reference.
- Added migration
  `packages/db/prisma/migrations/20260617141000_serum_config_approval_gate/migration.sql`
  and deployed it locally with `prisma migrate deploy`.
- High-risk SERUM drafts now start with `approvalStatus=required`; low-risk
  drafts remain `not_required`.
- Added admin-only `POST /api/v1/serum/configs/:id/request-approval` and
  `POST /api/v1/serum/configs/:id/approve`.
- Request and approval both re-run deterministic config tests and reject unsafe
  configs before changing approval state.
- Publish now refuses high-risk drafts unless they have a completed approval,
  approver, approved timestamp, approval reference, and a passing deterministic
  config test.
- Rollback of high-risk active configs preserves an approval reference and
  writes the new active rollback version as approved by the operator.
- SERUM Settings now shows an Approval gate tile for high-risk sections, plus
  Request approval and Approve actions wired to the backend.
- Focused browser E2E and in-app browser smoke now prove the Agents section
  exposes the approval gate/actions and does not show the SERUM unavailable
  banner.

### Implementation Map

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260617141000_serum_config_approval_gate/migration.sql`
- `packages/shared/src/schemas/serum.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/web/src/hooks/useSerumConfig.ts`
- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `apps/web/e2e/serum-account-experience.spec.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db generate`: pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/db migrate:deploy`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass after parsing the draft config type before publish preflight.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 5 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/settings/SerumControlPlaneSection.tsx src/hooks/useSerumConfig.ts e2e/serum-account-experience.spec.ts`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=836 E2E_WORKERS=1 playwright test e2e/serum-account-experience.spec.ts --project=chromium-desktop --grep "SERUM status and industry panels" --reporter=list`: 1 pass with production build.
- In-app browser smoke on `http://127.0.0.1:5173/settings?tab=serum`: Agents approval gate visible, Request approval visible, Approve visible, unavailable banner count 0.

### Remaining Launch Risks

- This is a real publish approval gate, not full separation-of-duties or an
  external CAB workflow. A future enterprise hardening pass should prevent the
  same admin from requesting and approving the same high-risk draft when the
  org policy requires dual control.
- Live execution/apply paths for agents, loops, model routing, tools,
  connectors, prompts, retrieval, and eval execution remain open.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 42: SERUM Runtime Enforcement At Execution

### Trigger

Follow-Up 41 added a runtime policy authority, but the highest-risk execution
surfaces still needed to call it before work started. A control plane that only
answers check endpoints can drift from the actual queue, worker, and MCP tool
paths. Tony also reported SERUM unavailable, so execution paths now need
fail-closed behavior that is visible and testable.

### Issues Fixed

- Moved the SERUM runtime-policy helper into `@bidstack/db` so API, worker, and
  MCP execution surfaces use one policy authority.
- Crew-run start and retry now check every task agent and hierarchical manager
  against the active Agents policy before queueing work.
- Crew-run retry remains backward-compatible with old no-body clients while
  still accepting the new `approvalConfirmed` signal.
- The worker revalidates SERUM policy after claiming a queued run and before
  any provider call, with the current run excluded from concurrency counts.
- MCP tool execution now checks the active Tools policy before invoking a tool
  handler, using a fail-closed dry-run guard.
- Agent Studio now requires the operator to check an explicit approval box
  before the Run crew action can be enabled; the API receives
  `approvalConfirmed`.
- Added focused regression coverage for SERUM-denied crew starts,
  approval-required starts, MCP tool allow/deny decisions, and the Agent Studio
  run-button gate.

### Implementation Map

- `packages/db/src/serum-runtime-policy.ts`
- `packages/db/package.json`
- `apps/api/src/routes/crews.ts`
- `apps/api/src/queues/crew-run.ts`
- `apps/api/src/routes/crews.integration.test.ts`
- `apps/worker/src/queues/crew-run.ts`
- `apps/mcp-server/src/serum-policy.ts`
- `apps/mcp-server/src/server.ts`
- `apps/mcp-server/src/serum-policy.test.ts`
- `apps/web/src/pages/AgentStudioPage.tsx`
- `apps/web/src/pages/AgentStudioPage.test.tsx`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/crews.ts src/routes/crews.integration.test.ts src/routes/serum.ts src/routes/serum.integration.test.ts src/queues/crew-run.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/crews.integration.test.ts`: 6 pass.
- `DATABASE_URL=postgresql://bidstack:bidstack@localhost:5433/bidstack pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/worker exec eslint src/queues/crew-run.ts`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/mcp-server exec eslint src/server.ts src/serum-policy.ts src/serum-policy.test.ts`: pass.
- `pnpm --filter @bidstack/mcp-server typecheck`: pass.
- `pnpm --filter @bidstack/mcp-server test -- src/serum-policy.test.ts`: 2 pass.
- `pnpm --filter @bidstack/web exec eslint src/pages/AgentStudioPage.tsx src/pages/AgentStudioPage.test.tsx`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web test -- src/pages/AgentStudioPage.test.tsx`: 1 pass.
- In-app browser smoke on `http://localhost:5173/agent-studio`: standard agents
  and RFP crew rendered, Run panel opened, Run crew button disabled with no
  input, still disabled after RFP text alone, enabled only after approval
  checkbox, console errors 0.
- In-app browser smoke on `http://localhost:5173/serum`: SERUM unavailable
  banner count 0, backend-signal error copy count 0, console errors 0.

### Remaining Launch Risks

- Agents and MCP tools now have execution-time guards on the main queue/tool
  paths. Model-router execution, loops, connectors, prompt library, retrieval,
  eval execution, and Dust/MCP gateway runtime application still need their own
  final pre-execution checks.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 43: SERUM Model Router Execution Guard

### Trigger

Follow-Up 42 guarded crew agent execution and MCP tool calls, but the shared RFP
LLM execution wrapper still selected and called direct providers without asking
the active SERUM Model Router policy. The wrapper also still had a fail-open
direct-provider-to-Dust fallback that could bypass a denied direct model route.

### Issues Fixed

- `runRfpCompletion` now calls `checkSerumModelRouterRuntimePolicy` before every
  direct provider execution.
- The worker maps low-level wire provider kinds to SERUM's brand-facing provider
  ids: `anthropic -> claude`, `moonshot -> kimi`, and `nim -> nvidia_nim`.
- The runtime check passes the requested token budget and citation requirement
  for each model call; missing `maxTokens` uses the shared default of 4096.
- A denied Model Router decision records an AI audit error and returns `null`
  without calling the direct provider or Dust.
- A Model Router read/check error also records an AI audit error and returns
  deterministic fallback without calling any model.
- When a configured direct provider fails after being allowed, the wrapper now
  returns deterministic fallback instead of silently falling through to Dust.

### Implementation Map

- `apps/worker/src/lib/rfp-llm.ts`
- `apps/worker/src/lib/rfp-llm.test.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/worker exec eslint src/lib/rfp-llm.ts src/lib/rfp-llm.test.ts`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm --filter @bidstack/worker test -- src/lib/rfp-llm.test.ts src/crew/dust-executor.test.ts`: 13 pass.
- `pnpm --filter @bidstack/worker test`: 24 files, 245 tests pass.
- `git diff --check -- apps/worker/src/lib/rfp-llm.ts apps/worker/src/lib/rfp-llm.test.ts`: pass with only LF-to-CRLF warnings.

### Remaining Launch Risks

- Direct provider execution through the shared RFP wrapper is now guarded by
  SERUM Model Router policy. Dust-only execution remains governed by the future
  Dust/MCP Gateway runtime policy rather than this model-router guard.
- Loops, connectors, prompt library, retrieval, eval execution, and any model
  calls outside `runRfpCompletion` still need final pre-execution checks.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

---

## 2026-06-17 Follow-Up 44: SERUM Dust/MCP Gateway Runtime Guard

### Trigger

Follow-Up 43 protected direct model-provider execution, but Dust-only execution
still remained a separate runtime path. Worker RFP jobs, document extraction,
Dust polling, competitor research, API assistant calls, integration status, and
CRM-to-Dust pushes could still construct or use Dust clients without an active
Dust/MCP Gateway runtime decision.

### Issues Fixed

- Added first-class shared/runtime policy shape for `dustMcpGateway`.
- Added `checkSerumDustMcpGatewayRuntimePolicy` with fail-closed decisions for:
  missing policy, disabled Dust/MCP toggles, missing secret references, missing
  tool-audit evidence, unsafe write mode, and missing write approval.
- Exposed `POST /api/v1/serum/runtime-policy/dust-mcp-gateway/:configKey/check`
  with `Cache-Control: no-store`.
- Replaced API and worker `getOrgDust` factories with guarded Dust clients that
  check SERUM before `listDocuments`, `getDocument`, `listAgents`,
  `runAgent`, `getConversation`, and `upsertDocument`.
- Removed the worker crew executor's direct `new DustClient` path.
- Routed API assistant/status/push surfaces that already use `getOrgDust` or
  `buildDustClient` through the guarded client.
- Left the admin credential-validation probe intentionally direct so operators
  can save/test credentials before publishing a gateway policy.
- Added regression coverage proving denied Dust agent runs and document upserts
  make no network request.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `packages/shared/src/schemas/serum.test.ts`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/lib/dust-credentials.ts`
- `apps/api/src/lib/dust-push.ts`
- `apps/api/src/routes/dust-integration.ts`
- `apps/api/src/routes/dust-integration.helpers.ts`
- `apps/worker/src/lib/dust-credentials.ts`
- `apps/worker/src/lib/dust-credentials.test.ts`
- `apps/worker/src/crew/dust-executor.ts`
- `apps/worker/src/crew/dust-executor.test.ts`

### Verification

- `pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts`: 3 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts src/lib/dust-credentials.ts src/lib/dust-push.ts src/routes/dust-integration.ts src/routes/dust-integration.helpers.ts`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/api test`: 95 files, 647 pass, 2 skipped.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/worker exec eslint src/lib/dust-credentials.ts src/lib/dust-credentials.test.ts src/crew/dust-executor.ts src/crew/dust-executor.test.ts src/lib/rfp-llm.ts src/lib/rfp-llm.test.ts`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker test -- src/lib/dust-credentials.test.ts src/crew/dust-executor.test.ts src/lib/rfp-llm.test.ts`: 15 pass.
- `pnpm --filter @bidstack/worker test`: 25 files, 247 tests pass.
- `pnpm --filter @bidstack/worker build`: pass.
- `rg -n "new DustClient\(" apps/api apps/worker -g "*.ts"` now finds only
  `apps/api/src/routes/dust-credentials.routes.ts`, the admin credential
  validation probe.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings.

### Remaining Launch Risks

- Dust/MCP Gateway runtime decisions now guard the shared API/worker Dust client
  factories and main direct Dust execution paths. Dedicated runtime application
  is still needed for loops, connectors, prompt library, retrieval, eval
  execution, and any future path that constructs external clients outside the
  guarded factories.
- Gateway write operations are intentionally fail-closed unless an explicit
  approval signal is supplied. Existing CRM-to-Dust auto-push paths therefore
  require a future approval/workflow design before production enablement.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, true distributed production-scale load proof,
  full-history gitleaks disposition, and remaining downstream `FieldMeta`
  coverage. Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 45: SERUM Availability, API Base, Idle Session Recovery

### Trigger

Tony saw the live SERUM error: `SERUM status is unavailable. The control plane
could not read backend signals. Refresh or check API health.` He also reported
that long-lived pages sometimes need logout/login before they recover.

### Issues Fixed

- Normalized `VITE_API_URL` so deployments configured with `/api` or `/api/v1`
  do not accidentally call duplicated paths such as `/api/api/v1/...`.
- Moved the SERUM status hook to the canonical `/api/v1/serum/status` path and
  made it always refetch on mount, focus, and reconnect with a short live
  refresh interval.
- Preserved the shared API boundary's no-store fetches and one-shot forced token
  refresh after `401` or `403`, which addresses the long-idle logout/login
  recovery class.
- Replaced the generic SERUM unavailable copy with specific operator guidance
  for unauthenticated, forbidden, missing-route, backend, and network failures.
- Bumped the app-shell/service-worker cache name so users receive the refreshed
  SERUM shell instead of a stale cached client.

### Implementation Map

- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api.test.ts`
- `apps/web/src/hooks/useSerumStatus.ts`
- `apps/web/src/components/serum/SerumGlass.tsx`
- `apps/web/src/pages/SerumMissionControlPage.tsx`
- `apps/web/src/components/settings/SerumControlPlaneSection.tsx`
- `apps/web/src/main.tsx`
- `apps/web/public/sw.js`
- `apps/web/e2e/flows/pwa-offline.spec.ts`

### Verification

- `pnpm --filter @bidstack/web test -- src/lib/api.test.ts src/lib/queryCache.test.ts src/lib/auth.test.tsx`: 18 pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec eslint src/lib/api.ts src/lib/api.test.ts src/hooks/useSerumStatus.ts src/components/serum/SerumGlass.tsx src/pages/SerumMissionControlPage.tsx src/components/settings/SerumControlPlaneSection.tsx src/main.tsx e2e/flows/pwa-offline.spec.ts`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/web e2e -- serum-account-experience.spec.ts --project=chromium-desktop`: 2 pass, 2 skipped by existing worker/OCR gates.
- `E2E_AUTH_MODE=demo pnpm --filter @bidstack/web e2e -- flows/idle-auth-recovery.spec.ts --project=chromium-desktop`: 1 pass.
- In-app browser smoke: `http://localhost:5173/serum` shows Mission Control
  and no unavailable/access/not-found state; `http://localhost:5173/key-accounts`
  shows dynamic Strategic Accounts and industry signal/filter content.
- Browser console: no app/API errors; only expected Framer Motion
  reduced-motion warnings.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings.

### Remaining Launch Risks

- This fixes the SERUM availability/auth/cache class locally and in focused
  browser gates; it is not a substitute for Clerk-backed staging proof.
- Service-worker cache versioning is manual in this slice. A release-driven
  cache version/update UX should be automated before a broad production rollout.
- External certification remains open: Azure/security sign-off, distributed
  load proof, full-history gitleaks disposition, and remaining production
  monitoring gates. Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 46: SERUM Retrieval Runtime Enforcement

### Trigger

The SERUM settings workbench already exposed a Retrieval section, but semantic
retrieval and embedding paths could still run without a live runtime decision.
For a 100k-user control plane, config UX must be tied to execution-time
enforcement or the UI becomes decorative governance.

### Issues Fixed

- Added a first-class SERUM Retrieval runtime policy to the shared schemas and
  runtime snapshot.
- Added a fail-closed API check endpoint at
  `/api/v1/serum/runtime-policy/retrieval/:configKey/check`.
- Enforced published Retrieval policy before MCP semantic reference search calls
  Cohere. Denied or errored checks now fall back to keyword search without
  making the embedding request.
- Enforced the same policy before worker requirement/reference embedding jobs
  call Cohere.
- Added regression coverage proving missing policy, excessive chunks, missing
  grounded sources, and approved retrieval paths behave deterministically.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/mcp-server/src/lib/reference-search.ts`
- `apps/worker/src/queues/rfp-embed-requirement.ts`
- `apps/worker/src/queues/rfp-embed-reference.ts`

### Verification

- `pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts`: 3 pass.
- `pnpm --filter @bidstack/mcp-server test -- src/lib/reference-search.test.ts`: 2 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass after shared declarations were rebuilt.
- `pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/mcp-server typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- Targeted ESLint for the touched API, MCP, and worker files: pass.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings.

### Remaining Launch Risks

- Retrieval is now guarded at the identified Cohere execution surfaces, but
  future retrieval clients must use the same runtime helper before network
  calls.
- Loops, connectors, prompt library, and eval execution still need equivalent
  live runtime enforcement.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, distributed load proof, full-history gitleaks
  disposition, and production monitoring proof. Still not Salesforce/100k
  certified.

## 2026-06-17 Follow-Up 47: SERUM Prompt Library Runtime Enforcement

### Trigger

The SERUM settings workbench exposed Prompt Library governance, but runtime RFP
prompt execution could still proceed without proving a published prompt policy
allowed the prompt set. For enterprise AI governance, prompt controls must be
checked directly before model execution, not only during config preflight.

### Issues Fixed

- Added a first-class SERUM Prompt Library runtime policy to the shared schemas
  and runtime snapshot.
- Added a fail-closed API check endpoint at
  `/api/v1/serum/runtime-policy/prompt-library/:configKey/check`.
- Tightened prompt-library config preflight so active high-risk prompt policies
  require explicit `allowedPromptSets`.
- Enforced Prompt Library policy before the shared worker RFP model wrapper can
  call a direct LLM provider or Dust. Denied or errored prompt checks return the
  deterministic fallback path and do not call either provider.
- Wrapped the requirement-extraction processor's legacy direct-provider/Dust
  block with the same Prompt Library check.
- Added Prompt Library checks to the legacy API Dust helpers for bid-score
  defense and proposal-section drafting.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/services/ai/dust-agent.service.ts`
- `apps/worker/src/lib/rfp-llm.ts`
- `apps/worker/src/lib/rfp-llm.test.ts`
- `apps/worker/src/queues/rfp-requirement-extract.processor.ts`
- `apps/worker/src/queues/__tests__/rfp-requirement-extract-gates.test.ts`

### Verification

- `pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts`: 3 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/worker test -- src/lib/rfp-llm.test.ts src/queues/__tests__/rfp-requirement-extract-gates.test.ts`: 13 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- Targeted ESLint for touched API and worker files: pass.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings on tracked files.
- Manual trailing-whitespace check across tracked and untracked slice files: pass.

### Remaining Launch Risks

- Prompt Library is now guarded at the central RFP model wrapper, requirement
  extraction, and legacy API Dust helpers. Future model/prompt entry points
  must pass a prompt set through the same runtime helper.
- The requirement-extraction processor still contains older duplicated provider
  logic. It is policy-wrapped now, but should be migrated fully into
  `runRfpCompletion` in a cleanup slice.
- Loops, connectors, and eval execution still need equivalent runtime
  enforcement.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, distributed load proof, full-history gitleaks
  disposition, and production monitoring proof. Still not Salesforce/100k
  certified.

## 2026-06-17 Follow-Up 48: SERUM Eval Quality-Gate Runtime Enforcement

### Trigger

SERUM settings already validated `evals_quality_gates` drafts, but the offline
RFP eval runner could still be treated as release evidence without asking the
runtime policy authority whether that suite and result were allowed.

### Issues Fixed

- Added first-class SERUM Evals Quality Gate runtime policy to shared schemas
  and policy snapshots.
- Added a fail-closed API check endpoint at
  `/api/v1/serum/runtime-policy/evals-quality-gates/:configKey/check`.
- Added runtime decisions for missing eval policy, disabled release gates,
  missing or disallowed regression suites, failing fixtures, and pass rates
  below the active threshold.
- Wired `apps/api/src/evals/run-evals.ts` through the SERUM eval policy helper.
  Heuristic local runs remain lightweight by default; `EVAL_MODE=full` always
  requires `SERUM_EVAL_ORG_ID` or `EVAL_ORG_ID` and a published eval policy
  before model-backed release evals run, even if an env override tries to mark
  eval policy optional.
- Added focused unit coverage for the eval policy helper and extended SERUM
  integration coverage for the new runtime endpoint.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `packages/shared/src/schemas/serum.test.ts`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/evals/serum-eval-policy.ts`
- `apps/api/src/evals/serum-eval-policy.test.ts`
- `apps/api/src/evals/run-evals.ts`

### Verification

- `pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts`: 3 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/api test -- src/evals/serum-eval-policy.test.ts src/evals/evals.test.ts`: 38 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- Targeted API ESLint for touched SERUM/eval files: pass.
- `pnpm --filter @bidstack/api eval:rfp`: 13 fixtures pass in heuristic mode.
- `pnpm --filter @bidstack/api build`: pass.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings on
  `apps/api/src/evals/run-evals.ts`.

### Remaining Launch Risks

- Full LLM release eval mode is policy-required, but staging still needs a real
  published `evals_quality_gates:release` policy and org id before this can be
  counted as production release evidence.
- Loops and connectors still need equivalent live runtime enforcement.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, distributed load proof, full-history gitleaks
  disposition, production monitoring proof, and remaining FieldMeta coverage.
  Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 49: SERUM Connector Runtime Enforcement

### Trigger

SERUM settings exposed Connector governance, but external connector calls still
had live egress paths through ERP/Odoo MCP and Microsoft Graph calendar sync.
For enterprise readiness, connector policy must block network calls before
egress when no active policy allows the operation.

### Issues Fixed

- Added first-class SERUM Connector runtime policy to shared schemas and policy
  snapshots.
- Added a fail-closed API check endpoint at
  `/api/v1/serum/runtime-policy/connectors/:configKey/check`.
- Added runtime decisions for missing connector policy, disabled connectors,
  missing secret references, missing connection-test evidence, unsafe connector
  modes, read-only write attempts, draft-write runtime attempts, and
  approved-write attempts without explicit approval.
- Guarded ERP/Odoo MCP API routes before external calls. Status and presales
  surfaces fail soft with a SERUM denial message; direct proxy endpoints return
  403 before network egress.
- Guarded Microsoft Graph calendar push and incremental pull before Graph
  network calls in the worker.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `packages/shared/src/schemas/serum.test.ts`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/routes/erp-integration.ts`
- `apps/api/src/routes/erp-integration.test.ts`
- `apps/worker/src/queues/calendar-sync-microsoft.ts`
- `apps/worker/src/queues/calendar-sync-microsoft.test.ts`

### Verification

- `pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts`: 3 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api test -- src/routes/serum.integration.test.ts`: 7 pass.
- `pnpm --filter @bidstack/api test -- src/routes/erp-integration.test.ts`: 10 pass.
- `pnpm --filter @bidstack/worker test -- src/queues/calendar-sync-microsoft.test.ts`: 3 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- Targeted API/worker ESLint for touched connector files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings on
  tracked ERP/Microsoft files.

### Remaining Launch Risks

- Connector runtime policy now guards ERP/Odoo MCP and Microsoft Graph calendar
  sync. Other connector families such as Gmail, Slack, Twilio, generic
  webhooks, HubSpot migration, and older plugin package tool executions still
  need a separate egress audit before a global connector-complete claim.
- SERUM loops still need equivalent runtime enforcement.
- External certification remains open: Clerk-backed staging auth proof,
  Azure/security sign-off, distributed load proof, full-history gitleaks
  disposition, production monitoring proof, and downstream FieldMeta coverage.
  Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 50: Technical Stack Source Pull UX

### Trigger

Tony asked for the Technical Stack Overview add flow to feel premium and for
MCP/source pulls to cover Apollo, Seamless, and other valid technology sources.
The existing stack card could be edited, but it did not give account teams a
clear source-refresh action or enough confidence about which provider lane had
actually contributed stack data.

### Issues Fixed

- Added a technical-stack refresh response contract with provider lanes for
  Apollo, Seamless, Tech Intel, and open data.
- Added `POST /api/v1/crm/companies/:companyKey/technical-stack/refresh`.
  Apollo is queued through the existing enrichment queue and reports MCP/API
  transport based on configured credentials; Seamless and open-data status are
  surfaced immediately from the current enrichment context.
- Preserved provider metadata and source attribution across enrichment refreshes
  so a later open-data refresh cannot erase earlier Apollo, Seamless, or
  meeting-derived technical stack signals.
- Mapped Seamless technologies from provider metadata into cockpit technical
  stack items and deduped vendors across Apollo/Seamless lanes.
- Added a source rail to the card showing Manual, Apollo, Seamless, and Open
  data status chips.
- Improved manual stack add UX with category presets, datalist category entry,
  vendor entry, compact icon actions, source-aware toasts, reduced-motion-safe
  animation, and mobile wrapping.
- Added a focused browser E2E for the source-pull button plus manual add/save
  persistence, with seeded stack restoration after the test.

### Implementation Map

- `packages/shared/src/schemas/crm.base.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/services/crm/enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.ts`
- `apps/web/src/hooks/useCompanyTechnicalStack.ts`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts --reporter=dot`: 6 tests pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/companies.test.ts --reporter=dot`: 15 tests pass.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`: 6 tests pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- Targeted API/web ESLint for touched files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/account-detail.spec.ts --project=chromium-desktop`: 3 tests pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`: 1 test pass.

### Remaining Launch Risks

- Apollo technology enrichment remains asynchronous through the queue. That is
  safer than faking a live result, but production ops still need queue/worker
  health monitoring around the Apollo lane.
- BuiltWith and Wappalyzer are valid technology-intelligence sources for a
  future lane, but they still need explicit credential/config plumbing.
- This is a focused account-cockpit technical-stack slice. It does not close
  the broader Salesforce-equivalence/100k-user certification gates: Clerk
  staging auth, Azure/security sign-off, distributed load proof, full-history
  gitleaks disposition, production monitoring proof, and remaining FieldMeta
  coverage are still open.

## 2026-06-17 Follow-Up 51: SERUM Loop Runtime Enforcement

### Trigger

SERUM Loops could be configured and validated, but live loop execution did not
yet have its own runtime policy contract. That left Crew and RFP orchestration
loops dependent on adjacent agent/tool guards instead of a loop-specific
durable-event, approval, replay, and retry decision.

### Issues Fixed

- Added a first-class Loop runtime policy to the shared SERUM runtime snapshot.
- Added `POST /api/v1/serum/runtime-policy/loops/:configKey/check`.
- Runtime checks fail closed for missing or disabled Loop policy, missing
  durable-event evidence, approval-boundary crossing, retry count above cap,
  unsafe retry caps, disabled replay, approval-required replay without approval,
  and automatic or continuous replay modes.
- Guarded RFP orchestration enqueue before BullMQ and mapped loop-policy denial
  to a 409 response instead of generic queue-unavailable copy.
- Added an RFP worker backstop before orchestration upsert and child fan-out;
  denial marks the orchestration failed and throws `doNotRetry`.
- Extended Crew API run/retry and worker execution guards so the same Loop
  policy applies to the Crew/RFP loop families currently exposed by SERUM.

### Implementation Map

- `packages/shared/src/schemas/serum.ts`
- `packages/shared/src/schemas/serum.test.ts`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `apps/api/src/queues/rfp-orchestrator.ts`
- `apps/api/src/queues/rfp-orchestrator.test.ts`
- `apps/api/src/routes/rfp-pipeline.ts`
- `apps/api/src/routes/crews.ts`
- `apps/api/src/routes/crews.integration.test.ts`
- `apps/worker/src/queues/rfp-orchestrator.ts`
- `apps/worker/src/queues/__tests__/rfp-orchestrator.test.ts`
- `apps/worker/src/queues/crew-run.ts`

### Verification

- `pnpm --filter @bidstack/shared test -- src/schemas/serum.test.ts`: 3 tests pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/serum.integration.test.ts --reporter=dot`: 7 tests pass.
- `pnpm --filter @bidstack/api exec vitest run src/queues/rfp-orchestrator.test.ts src/routes/crews.integration.test.ts --reporter=dot`: 9 tests pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/__tests__/rfp-orchestrator.test.ts --reporter=dot`: 10 tests pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- Targeted API/worker ESLint for touched files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- Touched-file `git diff --check`: pass with only LF-to-CRLF warnings.

### Remaining Launch Risks

- Loop enforcement now covers current Crew and RFP loop entry/backstop paths, but
  future loop families must call the same helper before execution.
- Child RFP phase transitions can be deepened with phase-by-phase rechecks if
  policy needs to stop already-running orchestrations mid-pipeline.
- Connector runtime policy still needs proof across Gmail, Slack, Twilio,
  generic webhook delivery, HubSpot migration, and older plugin package tools.
- External certification remains open: Clerk-backed staging auth, Azure/security
  sign-off, distributed load proof, full-history gitleaks disposition,
  production monitoring proof, and downstream FieldMeta coverage. Still not
  Salesforce/100k certified.

## 2026-06-17 Follow-Up 52: SERUM Connector Family Egress Backstops

### Trigger

Follow-Up 49 created the Connector runtime policy and guarded ERP/Odoo plus
Microsoft Graph calendar sync, but the remaining connector families still had
live egress paths. A 100k-user deployment cannot rely on connector UI policy if
Slack, Twilio, Gmail, Google Workspace, HubSpot, or webhook workers can still
call providers without a runtime decision.

### Issues Fixed

- Added shared API and worker helper boundaries for SERUM Connector runtime
  checks, including fail-closed behavior when the policy authority itself
  cannot be read.
- Guarded Slack channel posts, Slack replies, and Slack DMs before token lookup
  or Slack API calls.
- Guarded Twilio SMS send after TCPA consent and before credential lookup or
  Twilio API calls.
- Guarded Gmail and Microsoft email send/pull paths before OAuth refresh and
  provider egress.
- Guarded the older Microsoft Graph mail service before send and incremental
  pull calls.
- Guarded HubSpot migration start in the API and HubSpot page fetch in the
  worker.
- Guarded Google Workspace calendar push/update/delete, incremental pull, and
  watch-channel renewal before Google egress.
- Guarded webhook test pings and worker delivery before partner URL egress.
  Denied webhook deliveries now record a failed attempt instead of calling the
  partner endpoint.
- Audited `packages/integrations` plugin scaffolding and found no current app
  imports; it remains a wiring-time review item if those tools become runtime
  connector paths.

### Implementation Map

- `apps/api/src/lib/serum-connector-policy.ts`
- `apps/api/src/services/slack.service.ts`
- `apps/api/src/services/twilio-sms.service.ts`
- `apps/api/src/services/email-integration.service.ts`
- `apps/api/src/services/microsoft-graph.service.ts`
- `apps/api/src/routes/migrations-hubspot.routes.ts`
- `apps/api/src/routes/webhook-subscriptions.ts`
- `apps/api/src/services/serum-connector-egress.test.ts`
- `apps/worker/src/lib/serum-connector-policy.ts`
- `apps/worker/src/queues/calendar-sync-google.ts`
- `apps/worker/src/queues/calendar-sync.ts`
- `apps/worker/src/queues/migration.ts`
- `apps/worker/src/queues/webhook-delivery.ts`
- `apps/worker/src/queues/serum-connector-egress.test.ts`

### Verification

- `pnpm --filter @bidstack/api test -- serum-connector-egress.test.ts`: 3
  tests pass.
- `pnpm --filter @bidstack/worker test -- serum-connector-egress.test.ts`: 3
  tests pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker test -- calendar-sync-microsoft.test.ts calendar-sync-google.test.ts migration.helpers.test.ts serum-connector-egress.test.ts`:
  3 files / 15 tests pass.
- `pnpm --filter @bidstack/api test -- serum-connector-egress.test.ts erp-integration.test.ts`:
  2 files / 13 tests pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/worker build`: pass.

### Remaining Launch Risks

- Connector egress is now guarded across the active connector families found in
  API/worker runtime paths, but future plugin-package connector wiring must call
  the same helper before execution.
- `connectionTested` is still inferred from existing active-token or delivery
  evidence for some older connectors. A formal per-connector
  `connection_tested_at` evidence ledger is still needed for stricter audits.
- External certification remains open: Clerk-backed staging auth, Azure/security
  sign-off, distributed load proof, full-history gitleaks disposition,
  production monitoring proof, and downstream FieldMeta coverage. Still not
  Salesforce/100k certified.

## 2026-06-17 Follow-Up 53: Connector Evidence And Technical Stack QA Lock

### Trigger

Tony specifically called out the Technical Stack Overview add experience and
asked that MCPs/source pulls cover Apollo, Seamless, and any other valid
technology sources. This pass also stabilized the in-progress connector
evidence ledger work so the repo was not left in a half-open SERUM state.

### Issues Fixed

- Applied the local connector connection-test evidence migration and rebuilt
  `@bidstack/db` so API integration tests used the current runtime policy
  package instead of stale dist output.
- Updated focused connector tests to mock the new connection-test evidence
  writer and assert explicit `connectionTestProbe: false` runtime checks.
- Re-audited the Technical Stack Overview source-pull path. The product now
  exposes real provider lanes for Apollo, Seamless, Tech Intel, and open data;
  Apollo uses MCP-first enrichment when configured and falls back to API queue
  behavior; Seamless technologies map from provider metadata into cockpit stack
  items.
- Confirmed provider metadata/source attribution are preserved across open-data
  refreshes, so a new refresh cannot erase older Apollo, Seamless, or
  meeting-derived stack signals.
- Tightened the add-stack UX touch targets: compact technical-stack icon
  actions and category presets now meet the 44px target instead of looking
  premium while being hard to hit.
- Verified the live Chromium technical-stack flow end to end: source pull,
  provider ids, edit mode, add vendor, save, reload/edit recovery, cancel, and
  seeded stack rollback.
- Ran a broader Chromium control sweep for critical buttons and pipeline stage
  movement after the source-stack changes.

### Implementation Map

- `packages/db/prisma/migrations/20260617155500_serum_connector_connection_tests/`
- `packages/db/src/serum-runtime-policy.ts`
- `apps/api/src/services/serum-connector-egress.test.ts`
- `apps/api/src/routes/erp-integration.test.ts`
- `apps/worker/src/queues/serum-connector-egress.test.ts`
- `apps/worker/src/queues/calendar-sync-microsoft.test.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/services/crm/company-enrichment.service.ts`
- `apps/api/src/providers/company-seamless-enrichment.ts`
- `apps/worker/src/queues/company-enrich-apollo.ts`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/hooks/useCompanyTechnicalStack.ts`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/solutions/serum-versioned-config-control-plane.md`

### Verification

- `pnpm --filter @bidstack/db migrate:deploy`: applied
  `20260617155500_serum_connector_connection_tests` against local Postgres.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/db test -- serum-runtime-policy.test.ts`: 4 tests
  pass.
- `pnpm --filter @bidstack/api test -- serum-connector-egress.test.ts erp-integration.test.ts serum.integration.test.ts`:
  3 files / 20 tests pass.
- `pnpm --filter @bidstack/worker test -- calendar-sync-microsoft.test.ts serum-connector-egress.test.ts`:
  2 files / 6 tests pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  3 files / 21 tests pass.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  6 tests pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`: 22
  tests pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts --reporter=dot`:
  3 tests pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- Targeted API/web/worker ESLint for touched technical-stack files: pass.
- `git diff --check -- <touched technical-stack files>`: pass with only
  LF-to-CRLF warnings on tracked files.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1 test pass.
- `pnpm --filter @bidstack/web e2e -- e2e/critical-controls.spec.ts e2e/flows/pipeline.spec.ts --project=chromium-desktop`:
  8 tests pass / 1 existing gated skip.

### Remaining Launch Risks

- Apollo live stack enrichment remains asynchronous through the queue by design.
  Production still needs worker/queue health monitoring proof before this lane
  can be called operationally certified.
- BuiltWith and Wappalyzer are valid future technology-intelligence sources,
  but they should not appear as first-class lanes until credentials, rate
  limits, source attribution, and tests are implemented.
- The connector evidence ledger is now present locally, but external
  certification remains open: Clerk-backed staging auth, Azure/security signoff,
  distributed load proof, full-history gitleaks disposition, production
  monitoring proof, and remaining FieldMeta coverage. Still not Salesforce/100k
  certified.

## 2026-06-17 Follow-Up 54: Technical Stack MCP Pull + Premium Add UX

### Trigger

Tony asked for the Technical Stack Overview add experience to feel better and
for MCP/source pulls to cover Apollo, Seamless, and any other valid technology
source without faking unavailable provider lanes.

### Issues Fixed

- Made Seamless company enrichment MCP-first when `SEAMLESS_MCP_URL` is
  configured, with authenticated Streamable HTTP JSON-RPC calls, structured
  result parsing, and REST API fallback only when API credentials exist.
- Updated CRM enrichment and technical-stack refresh reporting so Seamless is
  labeled `mcp` only when the runtime can actually use MCP; otherwise it reports
  API/disabled/unavailable states.
- Improved the Technical Stack Overview interaction model with a visible `Check
sources` CTA, Apollo/Seamless/Open data/Meetings source rail, show-all stack
  expansion, provenance badges in edit mode, and a clearer `Add verified
technology` composer.
- Kept Apollo on the existing MCP-first async enrichment lane and preserved
  existing provider/source attribution so source pulls do not erase older
  Apollo, Seamless, open-data, manual, or meeting-derived stack signals.
- Verified the real app shell with browser QA: the source CTA is visible, source
  chips render correctly, the edit composer appears, primary buttons keep 44px
  geometry, and the panel does not overflow.

### Implementation Map

- `apps/api/src/providers/company-seamless-enrichment.ts`
- `apps/api/src/providers/company-seamless-enrichment.test.ts`
- `apps/api/src/services/crm/enrichment.service.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/env.ts`
- `.env.example`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`

### Verification

- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts --reporter=dot`:
  4 tests pass.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  6 tests pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  3 files / 22 tests pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- Targeted API/web ESLint for touched technical-stack files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1 test pass.
- In-app browser QA on `http://127.0.0.1:5188/accounts/approve-gate` confirmed
  visible source-pull, source rail, edit composer, 44px button height, and no
  overflow in the live shell.
- `git diff --check -- <touched technical-stack files>`: pass with only
  LF-to-CRLF warnings on tracked files.

### Remaining Launch Risks

- Browser plugin text entry could not be used for the add/save interaction
  because the virtual clipboard bridge was not installed; Playwright E2E
  verified persistence instead, while browser QA verified live layout and
  geometry.
- BuiltWith, Wappalyzer, and similar sources remain valid future lanes, but
  should not appear in the source rail until credentials, rate limits, source
  attribution, transport code, and tests are implemented.
- External certification remains open: Clerk-backed staging auth,
  Azure/security signoff, distributed load proof, full-history gitleaks
  disposition, production monitoring proof, and remaining FieldMeta coverage.
  Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 55: PII-Safe Sentry Observability Gate

### Trigger

Continuing the 100k-company deployment-readiness goal, the next local blocker
was production monitoring proof. The audit found that Sentry existed, but the
real API init path and auth request context could leak PII into telemetry.

### Issues Fixed

- Added `apps/api/src/lib/sentry-privacy.ts` as the canonical API Sentry
  scrubber for request and extra payloads.
- Wired `apps/api/src/instrument.ts`, the actual API entrypoint init path, to
  use `beforeSend`, `sendDefaultPii: false`, and `SENTRY_RELEASE` when set.
- Removed auth-side Sentry calls from `apps/api/src/plugins/auth.ts`; auth no
  longer sets email on Sentry user context.
- Registered the Sentry request-scope plugin after auth so it can attach only a
  pseudonymous user id and org tag.
- Captured handled 5xx errors from the central error handler, where the app
  normalizes server errors, instead of relying on Fastify hook behavior for
  already-handled failures.
- Rewrote `docs/observability/sentry.md` to match the authoritative runtime
  wiring and launch gate.

### Implementation Map

- `apps/api/src/lib/sentry-privacy.ts`
- `apps/api/src/instrument.ts`
- `apps/api/src/plugins/sentry.ts`
- `apps/api/src/plugins/sentry.test.ts`
- `apps/api/src/plugins/sentry-context.test.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/plugins/error-handler.ts`
- `apps/api/src/server.ts`
- `docs/observability/sentry.md`
- `docs/solutions/sentry-pii-safe-observability.md`

### Verification

- `pnpm --filter @bidstack/api exec vitest run src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts --reporter=dot`:
  2 files / 10 tests pass.
- `pnpm --filter @bidstack/api exec vitest run src/plugins/auth.test.ts src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts --reporter=dot`:
  3 files / 14 tests pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- Targeted API ESLint for touched observability/auth/server files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `git diff --check -- <touched sentry files>`: pass with only LF-to-CRLF
  warnings.

### Remaining Launch Risks

- This is local code proof, not live monitoring certification. Staging still
  needs real `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_RELEASE`, plus an
  observed staged 5xx smoke event in the API Sentry project and a worker failure
  capture on a non-production queue.
- External certification remains open: Clerk-backed staging auth,
  Azure/security signoff, distributed load proof, full-history gitleaks
  disposition, production monitoring proof, and remaining FieldMeta coverage.
  Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 56: Deploy Evidence Hard Gate

### Trigger

Continuing the 100k-company deployment-readiness goal, the next blocker was
that the pre-deploy checklist could pass code build/test/lint gates without
fresh release evidence for the actual staging or production candidate.

### Issues Fixed

- Added a cross-platform deploy evidence verifier that fails closed for staging
  and production when load, Semgrep, container, secret-history, or Sentry smoke
  proof is missing, stale, local-only, or weaker than certification profile.
- Required production/staging load proof to use the k6 `certification` profile,
  exercise authenticated routes, pass thresholds, and target non-local
  infrastructure.
- Required deploy-image scan proof to cover the API, web, worker, MCP, and
  migrate images with zero fixed CRITICAL/HIGH vulnerabilities.
- Required explicit secret-history disposition evidence so historical
  credential rotation/revocation is not inferred from a clean current tree.
- Required explicit Sentry smoke evidence with DSN, release, environment, API
  5xx capture, worker failure capture, and privacy controls.
- Wired the verifier into root npm scripts and `scripts/ops/deploy-checklist.sh`
  so release certification is a normal deploy gate.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `scripts/ops/deploy-checklist.sh`
- `package.json`
- `.gitignore`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node scripts/verify-deploy-evidence.mjs --selftest`: pass.
- `node scripts/verify-deploy-evidence.mjs --env production`: expected
  fail-closed result because the current load artifact is local `smoke` proof
  and the deploy evidence bundle is not present.

### Remaining Launch Risks

- Production/staging certification still needs external proof artifacts:
  authenticated distributed k6 certification run, Semgrep report, Trivy
  container report, security owner secret-history disposition, and observed
  Sentry API/worker events for the release.
- External certification remains open: Clerk-backed staging auth,
  Azure/security signoff, production monitoring proof, and remaining FieldMeta
  coverage. Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 57: Contract Summary Provenance

### Trigger

Continuing the 100k-company readiness goal, the next local blocker was weak
provenance coverage on derived legal/account-intel facts. Row-level MSA fields
had source badges, but the legal summary tiles still rendered Active, Coverage,
and Next as bare facts.

### Issues Fixed

- Added compact provenance badges to the Contractual agreements summary tiles.
- Active count now traces to `status` field provenance.
- Coverage now traces to `countries` field provenance.
- Next review/expiry now traces to `nextRateReviewAt` and `expiryDate`
  provenance.
- Summary hints now explain whether the metric is derived from human-reviewed
  extraction output, linked documents, or manual CRM records.
- Extended the focused contract card test to lock the reviewed-extraction
  summary path.

### Implementation Map

- `apps/web/src/components/account-intel/ContractAgreementsCard.tsx`
- `apps/web/src/components/account-intel/ContractAgreementsCard.test.tsx`
- `docs/solutions/account-field-provenance-badges.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/account-intel/ContractAgreementsCard.test.tsx src/components/account-intel/IntelTabs.test.tsx src/components/account-intel/AccountNewsSignalCard.test.tsx --reporter=dot`:
  3 files / 4 tests pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- Targeted ESLint for touched account-intel files: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `git diff --check -- <touched contract provenance files>`: pass with only
  LF-to-CRLF warnings.

### Remaining Launch Risks

- This is local UI/source-provenance proof, not live account/legal workflow
  certification. Full role/browser regression, external staging auth, Azure
  signoff, distributed load proof, secret-history disposition, and Sentry smoke
  proof remain open. Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 58: Technical Stack Premium Composer

### Trigger

Tony called out that adding technologies in Technical Stack Overview still felt
too manual and that MCP-backed sources such as Apollo, Seamless, and other valid
signals must feed the experience.

### Issues Fixed

- Reworked the add flow into an intelligence composer with `Auto` category as
  the default instead of forcing users to pre-sort every technology.
- Added edit-mode source suggestions that let users accept provider-detected
  Apollo, Seamless, open-data, and meeting signals without retyping them.
- Preserved accepted-source provenance as `manual:accepted:<source>` so curated
  additions remain traceable to the lane that found them.
- Added multi-vendor paste support for comma, semicolon, and newline-separated
  entries.
- Added duplicate prevention across saved vendors, pasted vendors, and source
  suggestions.
- Added quick-add chips for common enterprise technologies after filtering out
  already known or source-suggested items.
- Improved provider status language so reachable providers with no stack data
  say `No signal` instead of creating false urgency.
- Kept provider-lane integrity: Apollo remains MCP-first with API/queue fallback,
  Seamless remains MCP-first with REST fallback only when configured, and
  BuiltWith/Wappalyzer were not shown as fake lanes because they do not yet have
  credential/rate-limit/attribution/test coverage in this repo.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  1 file / 8 tests pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  3 files / 22 tests pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  1 file / 22 tests pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1 Chromium E2E pass.
- `git diff --check -- <touched technical-stack files>`: pass with only
  LF-to-CRLF warnings.

### Remaining Launch Risks

- This is local code, component, build, and browser proof for the technical
  stack flow, not full external certification.
- Apollo technology refresh can still be asynchronous through the existing
  enrichment queue and needs production worker/queue monitoring proof.
- BuiltWith, Wappalyzer, and other technology-intelligence sources remain valid
  future providers, but they need real credentials, attribution, rate limits,
  failure-mode handling, and tests before becoming first-class lanes.
- External certification remains open: Clerk-backed staging auth,
  Azure/security signoff, distributed load proof, full-history gitleaks
  disposition, Sentry API/worker smoke proof, and remaining FieldMeta coverage.
  Still not Salesforce/100k certified.

## 2026-06-17 Follow-Up 59: Technical Stack In-Editor Source Pull Hardening

### Trigger

Tony asked for the Technical Stack Overview add experience to feel more premium
and for MCP-backed sources such as Apollo, Seamless, and other valid providers
to actually feed the flow instead of forcing manual entry.

### Issues Fixed

- Moved source pull into the edit/add experience so provider intelligence,
  source review, and manual entry live in one workflow.
- Added provider metrics, provider-lane statuses, individual accept/dismiss
  controls, and bulk `Accept all` for detected technologies.
- Made read-only source pulls open the editor when provider suggestions arrive,
  landing the user directly in the review state.
- Preserved accepted-source provenance as `manual:accepted:<source>`.
- Fixed the live refresh POST path by sending an explicit `{}` JSON body from
  the web hook and accepting an empty body schema on the API route.
- Fixed open-data refresh failures caused by incomplete Wikidata dates such as
  unknown month/day precision.
- Verified local provider truth: Apollo and Seamless show disabled when
  credentials or MCP endpoints are not configured, while Open data can sync.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/hooks/useCompanyTechnicalStack.ts`
- `apps/web/src/hooks/apiMutationBodies.test.tsx`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/providers/company-open-enrichment.ts`
- `apps/api/src/providers/company-open-enrichment.test.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx src/hooks/apiMutationBodies.test.tsx --reporter=dot`:
  2 files / 14 tests pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-open-enrichment.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts --reporter=dot`:
  4 files / 14 tests pass.
- Targeted web/API ESLint for touched files: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- Direct live API smoke for CI Financial source refresh returned HTTP 200 after
  the fix with Apollo/Seamless disabled and Open data synced.
- In-app browser QA verified the provider panel, source rail, source-pull
  action, accept-all flow, 44px control geometry, no console errors, and no
  mobile overflow at 390 x 844.

### Remaining Launch Risks

- Apollo and Seamless need real credentials or MCP endpoints configured before
  live customer technology signals can appear locally.
- BuiltWith, Wappalyzer, and other valid technology sources remain future lanes
  until credentialing, attribution, rate limits, failure modes, and tests are
  implemented.
- This is local UX/API/browser proof, not full 100k-user external
  certification. Clerk-backed staging auth, Azure/security signoff, distributed
  load proof, full-history gitleaks disposition, Sentry API/worker smoke proof,
  and remaining FieldMeta coverage remain open. Still not Salesforce/100k
  certified.

## 2026-06-17 Follow-Up 60: Account Intel Solution/Product FieldSources

### Trigger

Continued the remaining downstream FieldMeta/provenance launch blocker after
the technical-stack source-pull work. Legal/MSA fields had a real `fieldSources`
map, but account-intel solutions/products still relied on the UI reconstructing
source state from `extractedFromDocumentId` and `confidenceBps`.

### Issues Fixed

- Added a shared `AccountIntelFieldProvenance` contract and `fieldSources` maps
  to `AccountSolution` and `AccountProduct` API payloads.
- Persisted document-extraction source metadata on worker-created
  account-intel solution/product rows, including extraction id, source document
  id, extractor kind, and Dust run id when present.
- Updated account-intel API serialization to prefer stored field-source
  metadata and safely derive legacy fallbacks from source document, confidence,
  and update date.
- Updated the solution/product UI badges to render from `fieldSources.name`
  first while keeping the old document/confidence fallback for cached rows.
- Added regression coverage for worker metadata persistence, API field-source
  serialization, and UI rendering from the API field-source contract.

### Implementation Map

- `packages/shared/src/schemas/account-intel.ts`
- `apps/api/src/routes/account-intel.ts`
- `apps/api/src/routes/account-intel.integration.test.ts`
- `apps/worker/src/queues/document-extract.ts`
- `apps/worker/src/queues/document-extract.contract.test.ts`
- `apps/web/src/components/account-intel/IntelTabs.tsx`
- `apps/web/src/components/account-intel/IntelTabs.test.tsx`
- `docs/solutions/account-intel-source-confidence-badges.md`
- `docs/solutions/account-field-provenance-badges.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/web test -- src/components/account-intel/IntelTabs.test.tsx --reporter=dot`:
  1 file / 3 tests pass.
- `pnpm --filter @bidstack/api test -- src/routes/account-intel.integration.test.ts --reporter=dot`:
  1 file / 2 tests pass.
- `pnpm --filter @bidstack/worker test -- document-extract.contract.test.ts`:
  1 file / 3 tests pass.
- Targeted API/web/worker ESLint for touched files: pass.
- API/web/worker `tsc --noEmit --pretty false`: pass.
- API/web/worker package builds: pass.
- `git diff --check -- <touched provenance files>`: pass with only LF-to-CRLF
  warnings.
- In-app browser smoke on `http://127.0.0.1:5174/accounts/ci-financial`
  confirmed the account detail page and Account Intelligence panel mount with
  no console errors. CI Financial currently has zero solution/product rows, so
  visible badge rendering is proven by component/API/worker tests.

### Remaining Launch Risks

- This closes another downstream provenance gap, but it is still local proof.
- The repo still needs a full cross-role browser regression, Clerk-backed
  staging auth, Azure/security signoff, distributed load proof, full-history
  gitleaks disposition, Sentry API/worker smoke proof, and remaining FieldMeta
  coverage before Salesforce/100k certification.

## 2026-06-17 Follow-Up 61: Generic Technical Stack MCP Source

### Trigger

Tony asked for Technical Stack Overview to pull richer stack intelligence from
MCP-backed sources such as Apollo, Seamless, and any other valid provider
without making the add experience feel manual.

### Issues Fixed

- Added a typed `tech_intel` provider lane to the CRM technical-stack refresh
  contract.
- Implemented a configurable Streamable HTTP MCP provider for technology
  intelligence through `TECH_STACK_MCP_URL` and related env options.
- Parsed JSON and server-sent event MCP tool responses while only accepting
  explicit technology fields as source evidence.
- Merged Tech Intel MCP stack evidence into company serialization with item
  provenance preserved.
- Updated the refresh provider status rail so Tech Intel is visible, disabled
  when not configured, unavailable when configured without signals, and synced
  when stack evidence exists.
- Improved the cockpit copy and source rail so pulling stack data clearly names
  Apollo, Seamless, Tech Intel, and open data.
- Kept BuiltWith, Wappalyzer, and private aggregators honest: they can be wired
  through the generic Tech Intel MCP path now, but they are not shown as named
  first-class lanes until credentials, attribution, limits, failure semantics,
  and tests exist.
- Fixed the generic MCP parser guard so absent optional fields cannot recurse
  into undefined values.

### Implementation Map

- `packages/shared/src/schemas/crm.base.ts`
- `apps/api/src/providers/company-tech-stack-mcp.ts`
- `apps/api/src/providers/company-tech-stack-mcp.test.ts`
- `apps/api/src/env.ts`
- `.env.example`
- `apps/api/src/services/crm/enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.test.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/routes/crm/companies.test.ts`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/services/crm/company-enrichment.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  3 files / 21 tests pass.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  1 file / 12 tests pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- Targeted API/web ESLint for touched files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1 Chromium E2E pass.
- `git diff --check -- <touched technical-stack files>`: pass with only
  LF-to-CRLF warnings.

### Remaining Launch Risks

- Real Apollo, Seamless, and Tech Intel stack quality still requires live
  credentials or MCP endpoints in staging/production.
- This is local contract, component, build, and browser proof. Full
  Salesforce-level certification still needs cross-role browser regression,
  Clerk-backed staging auth, Azure/security signoff, distributed load proof,
  secret-history disposition, and Sentry API/worker smoke proof.

## 2026-06-17 Follow-Up 62: Account Intel Secondary Field Proof

### Trigger

Continuing the FieldMeta/provenance launch blocker, the API already returned
field-level source metadata for all account-intel solution/product fields, but
the UI only rendered the primary `name` source badge.

### Issues Fixed

- Added a compact field-proof rail to account-intel solution cards for
  description, category, and status.
- Added the same compact field-proof rail to account-intel product cards for
  description, category, price, currency, and status.
- Kept the primary source/confidence badges intact so legacy rows without
  `fieldSources` still render the previous manual/document confidence fallback.
- Used field names as visible labels and API provenance hints as accessible
  labels/title text, keeping cards scannable while preserving audit detail.
- Added regression coverage for solution category/status provenance and product
  price/currency provenance.

### Implementation Map

- `apps/web/src/components/account-intel/IntelTabs.tsx`
- `apps/web/src/components/account-intel/IntelTabs.test.tsx`
- `docs/solutions/account-intel-source-confidence-badges.md`
- `docs/solutions/account-field-provenance-badges.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/account-intel/IntelTabs.test.tsx --reporter=dot`:
  1 file / 3 tests pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/account-intel/IntelTabs.tsx src/components/account-intel/IntelTabs.test.tsx`:
  pass.
- `pnpm --filter @bidstack/web build`: pass.
- `git diff --check -- apps/web/src/components/account-intel/IntelTabs.tsx apps/web/src/components/account-intel/IntelTabs.test.tsx`:
  pass with only LF-to-CRLF warning.

### Remaining Launch Risks

- This closes a UI visibility gap for already-serialized field metadata, but it
  is still local component/build proof.
- Full certification still needs cross-role browser regression,
  Clerk-backed staging auth, Azure/security signoff, distributed load proof,
  full-history gitleaks disposition, Sentry API/worker smoke proof, and live
  customer/provider credentials where relevant.

## 2026-06-17 Follow-Up 63: Cross-Role Browser Deploy Evidence Gate

### Trigger

The audit repeatedly listed cross-role browser regression and Clerk-backed
staging auth as launch blockers, but the deploy evidence verifier only required
load, SAST, container, secret-history, and Sentry artifacts.

### Issues Fixed

- Added a required `deploy-evidence/browser-regression-latest.json` artifact to
  the strict staging/production deploy evidence gate.
- Required the browser artifact to prove a non-local target, production build,
  Clerk-backed auth, passing command exit, and zero failed browser tests.
- Required explicit coverage for the release personas already used by
  `apps/web/e2e/flows/rbac.spec.ts`: `admin`, `manager`, `read-only`, and
  `viewer`.
- Required cross-browser project coverage for `chromium-desktop`,
  `firefox-desktop`, and `webkit-desktop`.
- Required `e2e/flows/rbac.spec.ts` spec coverage by default, with env overrides
  only when the release evidence plan explicitly changes.
- Extended deploy evidence selftest with a poisoned fixture that omits the
  `viewer` persona and must fail the strict gate.
- Updated the deploy evidence solution doc with the new browser artifact schema
  and strict requirements.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs`:
  pass.
- `node scripts/verify-deploy-evidence.mjs --env production`: expected
  fail-closed result. It now includes:
  `FAIL Cross-role browser regression artifact is missing`.

### Remaining Launch Risks

- This is a stronger gate, not the external proof itself.
- The release still needs the real browser-regression artifact from a non-local
  staging/production target with Clerk-backed test users, plus the existing load,
  Semgrep, container, secret-history, Sentry, Azure/security, and provider
  credential evidence before any Salesforce/100k certification claim.

## 2026-06-17 Follow-Up 64: Browser Regression Evidence Writer

### Trigger

The strict deploy gate now required cross-role browser evidence, but the repo
still lacked a deterministic way to create that compact artifact from a
Playwright release run.

### Issues Fixed

- Added `scripts/write-browser-regression-evidence.mjs`.
- Added root scripts:
  - `pnpm deploy:evidence:browser`
  - `pnpm deploy:evidence:browser:selftest`
- The writer parses Playwright JSON output and derives roles, browser projects,
  specs, and test counts from the actual report instead of relying on a
  hand-written release note.
- Strict evidence generation fails for local targets, stub auth, missing
  required personas, missing required browser projects, missing required specs,
  failed command exit, failed tests, unknown test states, or non-production
  build evidence.
- Added selftest poisoned fixtures for missing `viewer`, failed WebKit, and
  local/stub-auth evidence.
- Updated deploy evidence docs with the Playwright JSON reporter flow and
  writer command.

### Implementation Map

- `scripts/write-browser-regression-evidence.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `node --check scripts/write-browser-regression-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:browser:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-browser-regression-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `node scripts/verify-deploy-evidence.mjs --env production`: expected
  fail-closed result including:
  `FAIL Cross-role browser regression artifact is missing`.
- Direct trailing-whitespace scan across touched files: pass.

### Remaining Launch Risks

- The writer makes evidence generation deterministic, but the real
  staging/production Playwright run with Clerk-backed test accounts is still
  needed.
- Full Salesforce/100k certification still requires the external deploy bundle:
  authenticated certification k6 report, Semgrep artifact, container scan,
  secret-history disposition, Sentry smoke proof, Azure/security signoff, and
  live provider credentials where relevant.

## 2026-06-17 Follow-Up 65: Secret Scan Evidence Writer

### Trigger

The strict deploy gate required `deploy-evidence/secret-scan-latest.json`, but
the release operator still had to hand-author the artifact after running local
secret checks.

### Issues Fixed

- Added `scripts/write-secret-scan-evidence.mjs`.
- Added root scripts:
  - `pnpm deploy:evidence:secrets`
  - `pnpm deploy:evidence:secrets:selftest`
- The writer runs `bash scripts/check-secrets.sh --full`, scans untracked
  source files with the same secret regex family, and runs a current-commit
  gitleaks snapshot before writing the deploy artifact.
- Optional `--run-full-history` / `BIDSTACK_SECRET_RUN_FULL_HISTORY=true` runs
  full-history gitleaks and records the findings count.
- Historical rotation, revocation, owner approval, and reviewer remain explicit
  required inputs because code cannot prove those governance facts.
- Updated deploy evidence docs with the command flow and strict requirements.

### Implementation Map

- `scripts/write-secret-scan-evidence.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- Direct trailing-whitespace scan across touched files: pass.
- Actual writer smoke with a temp output path failed loud, as expected on this
  machine, because `gitleaks` is not installed. Tracked tree and untracked scans
  were clean; current-commit gitleaks proof was blocked.
- `node scripts/verify-deploy-evidence.mjs --env production`: expected
  fail-closed result including:
  `FAIL Secret scan disposition artifact is missing`.

### Remaining Launch Risks

- This creates the evidence factory, not the external security approval itself.
- `gitleaks` must be installed in the release runner before
  `pnpm deploy:evidence:secrets` can create a passing artifact.
- The release still needs real security-owner disposition for the 11 known
  redacted historical gitleaks findings, plus authenticated certification load,
  Semgrep, container, Sentry smoke, browser regression, Azure/security signoff,
  and live provider credential evidence before any Salesforce/100k certification
  claim.

## 2026-06-17 Follow-Up 66: Web Sentry Privacy Init Alignment

### Trigger

While preparing the Sentry smoke evidence writer, the web entrypoint was found
initializing Sentry directly instead of using the documented privacy-safe browser
helper.

### Issues Fixed

- Replaced direct `Sentry.init(...)` and direct `browserTracingIntegration`
  wiring in `apps/web/src/main.tsx` with `initSentry()` from
  `apps/web/src/lib/sentry.ts`.
- Kept browser capture calls routed through the helper export so future
  entrypoint changes do not bypass the shared Sentry boundary.
- Added `scrubSentryBrowserEvent()` as the tested browser privacy boundary.
- Added focused tests proving:
  - no DSN means no Sentry initialization;
  - default init uses tracing, release/environment values, and no session replay;
  - replay is opt-in and masks inputs;
  - request, extra, and breadcrumb PII are redacted before send;
  - user context remains id-only with org tag.
- Updated the Sentry observability solution note with the web-entrypoint
  prevention rule.

### Implementation Map

- `apps/web/src/main.tsx`
- `apps/web/src/lib/sentry.ts`
- `apps/web/src/lib/sentry.test.ts`
- `docs/solutions/sentry-pii-safe-observability.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/lib/sentry.test.ts --reporter=dot`:
  5/5 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/main.tsx src/lib/sentry.ts src/lib/sentry.test.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `rg -n "Sentry\\.init|browserTracingIntegration|replayIntegration|beforeSend\\(event\\)|sendDefaultPii" apps\\web\\src\\main.tsx apps\\web\\src\\lib\\sentry.ts`:
  direct init is present only in the helper.

### Remaining Launch Risks

- This fixes browser Sentry privacy/config drift, but it is still local code
  proof.
- Production/staging certification still needs a real Sentry smoke artifact
  proving API 5xx and worker failure events for the release, plus authenticated
  certification load, Semgrep, container, secret-history, browser regression,
  Azure/security signoff, and live provider credentials.

## 2026-06-17 Follow-Up 67: Sentry Smoke Evidence Writer

### Trigger

The deploy verifier required `deploy-evidence/sentry-smoke-latest.json`, but the
release process still depended on a hand-authored Sentry artifact.

### Issues Fixed

- Added `scripts/write-sentry-smoke-evidence.mjs`.
- Added root scripts:
  - `pnpm deploy:evidence:sentry`
  - `pnpm deploy:evidence:sentry:selftest`
- The writer uses the installed `sentry` CLI, not raw token-printing API calls,
  to query release/environment-scoped Sentry issues.
- Default queries require explicit smoke markers:
  - `bidstack-api-sentry-smoke`
  - `bidstack-worker-sentry-smoke`
- The artifact records DSN/release/environment, API and worker issue evidence,
  privacy source proof, replay status, and legal approval when replay is on.
- Strict validation fails when either Sentry query fails, either smoke marker is
  missing, release/DSN/env is missing, privacy controls are not proven, or replay
  lacks legal approval.
- Updated deploy evidence docs with the Sentry CLI command flow and query
  override controls.

### Implementation Map

- `scripts/write-sentry-smoke-evidence.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `node --check scripts/write-sentry-smoke-evidence.mjs`: pass.
- `pnpm deploy:evidence:sentry:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-sentry-smoke-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.

### Remaining Launch Risks

- This creates the evidence factory, not the live Sentry proof itself.
- The release still needs authenticated Sentry CLI context plus actual API and
  worker smoke issues for the release. Full certification also still needs
  authenticated certification load, Semgrep, container, secret-history,
  browser regression, Azure/security signoff, and live provider credentials.

## 2026-06-17 Follow-Up 68: Premium Technical Stack MCP Add UX

### Trigger

Adding technology in the Technical Stack Overview still felt too form-like for
an enterprise CRM surface, and the source-pull language did not make the Apollo,
Seamless, and Tech Intel MCP lanes explicit enough.

### Issues Fixed

- Rebuilt edit mode into a premium add workbench with manual curation and source
  review side by side.
- Upgraded manual add from a single-line input to a batch-paste textarea with
  category preview chips, duplicate signaling, and auto-categorization.
- Expanded quick-add coverage for common enterprise vendors across cloud, data,
  CRM, ERP, security, AI, DevOps, collaboration, ITSM, marketing, and commerce.
- Kept the source review queue visible even when there are no suggestions, with
  empty-state copy naming Apollo MCP, Seamless MCP, Tech Intel MCP, and open
  data.
- Made source suggestion cards clearer by showing technology, inferred category,
  and provenance before the user accepts them.
- Updated source-pull labels and provider status language to distinguish
  MCP-backed lanes from API/open-data lanes.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  12/12 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  28/28 pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  22/22 pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- Direct trailing-whitespace scan across touched implementation/test/style files:
  pass.

### Remaining Launch Risks

- This verifies the local UX, API contract, and browser path, but it is not live
  Salesforce-equivalent certification.
- Apollo, Seamless, and Tech Intel source quality still requires real
  staging/production MCP credentials, provider responses, rate-limit behavior,
  monitoring, and security approval evidence.

## 2026-06-17 Follow-Up 69: Semgrep and Container Evidence Writers

### Trigger

The deploy verifier required Semgrep and container-scan artifacts, but the
scanner scripts depended on release operators remembering report-path
environment variables. That made the release evidence path easier to skip than
the gate itself.

### Issues Fixed

- `pnpm security:scan` now writes
  `deploy-evidence/semgrep-latest.json` by default.
- `pnpm container:scan` now writes
  `deploy-evidence/container-scan-latest.json` by default.
- Added explicit aliases:
  - `pnpm deploy:evidence:semgrep`
  - `pnpm deploy:evidence:container`
- Semgrep evidence now includes generated timestamp, scanner metadata, mirrored
  file count, command exit code, pass/fail status, errors, results, and blocking
  finding count.
- Container evidence now includes generated timestamp, Trivy metadata,
  requested image coverage, command exit code, pass/fail status, missing images,
  and per-image vulnerability lists.
- The strict deploy verifier now fails container evidence when the scan did not
  pass, when requested images were missing, or when strict image coverage is
  absent.
- The Semgrep verifier no longer allows a compact `passed` artifact to bypass
  recorded scanner errors.

### Implementation Map

- `scripts/run-semgrep-sast.mjs`
- `scripts/run-container-vulnerability-scan.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/security-scan-local-gates.md`
- `docs/solutions/container-vulnerability-scan-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `node --check scripts/run-semgrep-sast.mjs`: pass.
- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including the new strict
  missing-container-coverage failure case.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-semgrep-sast.mjs scripts/run-container-vulnerability-scan.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- Direct trailing-whitespace scan across touched scripts/docs/package metadata:
  pass.

### Remaining Launch Risks

- These changes create deterministic local release artifacts; they do not run
  the live scanners in this summary by themselves.
- Actual certification still needs fresh scanner artifacts from the release
  runner, authenticated load proof, Sentry smoke, cross-role Clerk browser
  regression, secret-history owner disposition, Azure/security signoff, and live
  provider credentials.

## 2026-06-17 Follow-Up 70: Gated Sentry Smoke Triggers

### Trigger

The Sentry evidence writer could query for API and worker smoke markers, but the
release process still lacked a controlled in-product way to create those markers
through the real API error handler and BullMQ worker failure listener.

### Issues Fixed

- Added shared `SENTRY_SMOKE` BullMQ queue configuration.
- Added a producer-side queue helper for controlled worker smoke jobs.
- Added disabled-by-default ops routes:
  - `POST /api/v1/ops/sentry-smoke/api`
  - `POST /api/v1/ops/sentry-smoke/worker`
- The smoke routes are public only in the auth-plugin sense, but require
  `SENTRY_SMOKE_ENABLED=true`, real Sentry DSN/release env, and a dedicated
  `SENTRY_SMOKE_TOKEN` of at least 24 characters.
- The API smoke route intentionally returns HTTP 500 so the central error
  handler captures a real API 5xx Sentry event with
  `bidstack-api-sentry-smoke`.
- The worker smoke route queues a job that fails in the real worker process with
  `bidstack-worker-sentry-smoke`.
- Worker startup now initializes worker Sentry and attaches the Sentry failure
  listener to every BullMQ worker.
- The smoke-token header is now included in API logger redaction.
- Monitoring queue depth snapshots now include `sentry.smoke`.

### Implementation Map

- `packages/shared/src/queue-config.core.ts`
- `apps/api/src/queues/sentry-smoke.ts`
- `apps/api/src/routes/ops-sentry-smoke.ts`
- `apps/api/src/routes/ops-sentry-smoke.test.ts`
- `apps/api/src/server.routes.ts`
- `apps/api/src/server.ts`
- `apps/api/src/env.ts`
- `apps/api/src/routes/monitoring.ts`
- `apps/worker/src/main.ts`
- `apps/worker/src/queues/sentry-smoke.ts`
- `apps/worker/src/queues/sentry-smoke.test.ts`
- `.env.example`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/observability/sentry.md`
- `docs/solutions/sentry-pii-safe-observability.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/ops-sentry-smoke.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/sentry-smoke.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/worker exec tsc --noEmit --pretty false`: pass.
- Targeted ESLint for touched shared/API/worker files: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm deploy:evidence:sentry:selftest`: pass.
- Direct trailing-whitespace scan across touched implementation/test/env/docs
  files: pass.

### Remaining Launch Risks

- This creates the controlled trigger path. It is not live Sentry proof until
  staging or production is deployed with real `SENTRY_DSN`, `SENTRY_RELEASE`,
  `SENTRY_SMOKE_ENABLED=true`, and a release-only smoke token, then both smoke
  routes are triggered and `pnpm deploy:evidence:sentry` observes both markers.
- External certification still needs authenticated certification load,
  Semgrep/container/secret/browser evidence, Azure/security signoff, and live
  provider credentials.

## 2026-06-17 Follow-Up 71: Category-Aware Technical Stack Intake

### Trigger

The Technical Stack Overview add flow still felt like a form when users pasted
structured account intelligence. It also showed provider provenance but hid the
actual confidence score until hover/tooltips.

### Issues Fixed

- Added category-aware paste parsing for entries such as
  `Security: Okta, CrowdStrike` and `Data - Databricks`.
- Added a compact intake summary showing ready items, category spread,
  duplicates, and auto/manual classification posture.
- Kept the parser fail-safe by only accepting category hints that match known
  stack categories or aliases.
- Sorted provider suggestions by confidence and provider precedence.
- Added visible confidence percentages to source suggestion cards before
  acceptance.
- Changed bulk source acceptance to operate on the full eligible suggestion
  set, not only the rendered review-card slice.
- Kept source pull copy explicit for Apollo MCP, Seamless MCP, Tech Intel MCP,
  and open data without adding fake BuiltWith/Wappalyzer lanes.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  13/13 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  28/28 pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  22/22 pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Remaining Launch Risks

- This proves local UX, API/provider contracts, and browser behavior. It is
  not live Salesforce/100k certification.
- Real Apollo, Seamless, and Tech Intel quality still depends on staging or
  production MCP/API credentials, real provider responses, rate-limit
  monitoring, and security approval evidence.

## 2026-06-17 Follow-Up 72: Technical Stack Bulk Intake + Provider Review

### Trigger

Tony called out that adding technologies in the Technical Stack Overview could
feel better and asked that Apollo, Seamless, and any valid MCP/source lanes pull
stack intelligence.

### Issues Fixed

- Changed the compact source CTA from `Check sources` to `Pull sources`.
- Added a drag/drop-capable bulk intake shell for pasted or dropped text-like
  stack lists while keeping the textarea as the accessible keyboard path.
- Reused the existing category-aware parser for dropped text, so inputs such as
  `Security: CrowdStrike` and `Data: Databricks` land in the right draft
  categories.
- Added a `Review all` command when read-only provider updates exceed the
  compact rendered slice, preventing hidden Apollo/Seamless/Tech Intel signals
  from being stranded.
- Added provider review counts in edit mode so the queue communicates how many
  suggestions came from Apollo, Seamless, Tech Intel MCP, or other sources.
- Kept provider trust honest: Apollo remains queued through the enrichment
  worker, Seamless and Tech Intel MCP sync only when configured, and no fake
  BuiltWith/Wappalyzer first-class lanes were added.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  15/15 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  28/28 pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  22/22 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Remaining Launch Risks

- Browser plugin control was not exposed in this Codex session, so visual
  verification used the repo Playwright Chromium flow instead of the in-app
  Browser tool.
- This is still local/stub-auth proof. Live Apollo, Seamless, and Tech Intel
  MCP/API quality requires staging or production credentials, real provider
  responses, rate-limit evidence, monitoring, and security approval.

## 2026-06-18 Follow-Up 73: Browser Evidence Runner + Idle Auth Proof

### Trigger

Tony had previously reported a long-lived page/session recovery problem and
the strict deploy gate still required cross-role browser evidence. The browser
evidence writer existed, but the default command expected a pre-generated
Playwright JSON report, which made release execution easy to skip or run
incorrectly.

### Issues Fixed

- Changed `pnpm deploy:evidence:browser` to run the required Playwright RBAC
  regression before writing evidence.
- Preserved `pnpm deploy:evidence:browser:write` for CI jobs that already
  generated the JSON report separately.
- Fixed Windows execution for the runner by using the Windows shell boundary
  required by the `pnpm.cmd` shim.
- Updated the Playwright JSON parser to treat real `status: "expected"` entries
  with passing results as passed tests, and to normalize report paths such as
  `flows/rbac.spec.ts` back to `e2e/flows/rbac.spec.ts`.
- Re-verified the idle-auth recovery path in demo-token mode: a forced
  SERUM 401 is retried and the unavailable state does not appear.

### Implementation Map

- `package.json`
- `scripts/write-browser-regression-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/lib/api.test.ts src/lib/queryCache.test.ts --reporter=dot`:
  11/11 pass.
- `pnpm --filter @bidstack/web e2e -- e2e/flows/idle-auth-recovery.spec.ts --project=chromium-desktop`:
  skipped in default stub mode, as expected.
- `E2E_AUTH_MODE=demo VITE_AUTH_MODE=demo pnpm --filter @bidstack/web e2e -- e2e/flows/idle-auth-recovery.spec.ts --project=chromium-desktop`:
  1/1 pass.
- `pnpm deploy:evidence:browser:selftest`: pass; expected negative fixtures
  still print `FAIL` lines while confirming weak evidence is rejected.
- `node scripts/write-browser-regression-evidence.mjs --run-playwright --report deploy-evidence/playwright-browser-regression-codex-local.json --out deploy-evidence/browser-regression-codex-local.json --auth-mode stub --production-build --no-strict`:
  initial run exposed parser issues; after the parser fix, re-parsing the real
  report passed with admin, manager, read-only, viewer, Chromium, Firefox,
  WebKit, and `e2e/flows/rbac.spec.ts`.
- `pnpm deploy:evidence:selftest`: pass.
- `node --check scripts/write-browser-regression-evidence.mjs`: pass.
- `git diff --check -- package.json scripts/write-browser-regression-evidence.mjs`:
  pass, with the existing CRLF warning for `package.json`.
- `pnpm deploy:evidence:production`: still blocked by 5 strict evidence gaps:
  certification load is local smoke, secret disposition latest is missing,
  Sentry smoke latest is missing, and production/staging browser latest is
  missing.

### Remaining Launch Risks

- `deploy-evidence/browser-regression-latest.json` was intentionally not
  populated with local/stub proof. It must be generated against staging or
  production with Clerk-backed auth.
- The 100k/Salesforce-level release gate still requires non-local
  certification load, security-owner secret-history disposition, Sentry smoke
  observation, and live provider credential evidence.

## 2026-06-18 Follow-Up 74: Sentry Smoke Trigger Evidence Flow

### Trigger

The strict deploy verifier required `deploy-evidence/sentry-smoke-latest.json`.
The Sentry evidence writer could query Sentry, and the API/worker had controlled
smoke routes, but the normal release path still depended on a manual
pre-trigger step. That made the gate too easy to run against stale or unrelated
events.

### Issues Fixed

- Added `--trigger-smoke` to `scripts/write-sentry-smoke-evidence.mjs`.
- Added `pnpm deploy:evidence:sentry:trigger` for the release flow.
- The trigger path POSTs to:
  - `/api/v1/ops/sentry-smoke/api`, expecting the controlled HTTP 500.
  - `/api/v1/ops/sentry-smoke/worker`, expecting the queued worker failure.
- The writer records trigger response status and marker evidence in the compact
  artifact, waits for Sentry ingestion, then queries Sentry for the
  release/environment-scoped API and worker issues.
- The smoke token is sent only as `x-bidstack-sentry-smoke-token` and is not
  persisted in the artifact.
- Docs now point release ops at the trigger-capable command while preserving
  the query-only command for separately triggered events.

### Implementation Map

- `scripts/write-sentry-smoke-evidence.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/observability/sentry.md`
- `docs/solutions/sentry-pii-safe-observability.md`

### Verification

- `node --check scripts/write-sentry-smoke-evidence.mjs`: pass.
- `pnpm deploy:evidence:sentry:selftest`: pass.
- `Get-Command sentry`: local CLI present at
  `C:\Users\Tony\.local\bin\sentry.exe`, version `24.16.0.0`.
- `pnpm --filter @bidstack/api exec vitest run src/routes/ops-sentry-smoke.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/sentry-smoke.test.ts --reporter=dot`:
  2/2 pass.

### Remaining Launch Risks

- This does not create live Sentry evidence without staging/production
  `SENTRY_DSN`, `SENTRY_RELEASE`, `SENTRY_ENVIRONMENT`, Sentry CLI auth, a real
  API target, and a release-only `SENTRY_SMOKE_TOKEN`.
- `pnpm deploy:evidence:production` still blocks until
  `deploy-evidence/sentry-smoke-latest.json` is produced from live observed
  Sentry issues, alongside the remaining load, secret, browser, and live
  provider proof.

## 2026-06-18 Follow-Up 75: Strict Load Evidence Preflight

### Trigger

The strict deploy verifier rejected the current load artifact because it was a
local smoke run. `pnpm load-test:certify` could still be launched with default
localhost settings, which wastes release time and produces proof the strict gate
must reject.

### Issues Fixed

- Added strict load-evidence preflight to `scripts/run-k6-load-test.mjs`.
- Added `pnpm deploy:evidence:load`, which sets
  `BIDSTACK_LOAD_EVIDENCE_STRICT=true` and
  `K6_DURATION_PROFILE=certification`.
- Added `pnpm load-test:selftest`.
- Strict load evidence now fails before k6 starts when:
  - the profile is not `certification`,
  - the target is local or invalid,
  - `API_TOKEN` is missing,
  - `SKIP_AUTHENTICATED_ROUTES=true`.
- The compact load artifact now records `strictEvidence`.
- Local/dev `pnpm load-test` behavior remains available for fast regression
  checks.

### Implementation Map

- `scripts/run-k6-load-test.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/k6-load-gate-docker-fallback.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `pnpm load-test:selftest`: pass.
- `pnpm deploy:evidence:load`: expected fail before k6 with local-target and
  missing-token errors when no staging target/token is configured.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-k6-load-test.mjs scripts/load-test.js scripts/verify-deploy-evidence.mjs`:
  pass.

### Remaining Launch Risks

- No non-local load artifact was generated in this session because staging or
  production API target and short-lived bearer token are required.
- `pnpm deploy:evidence:production` still blocks until
  `load-test-report/production-load-latest.json` is a fresh strict
  certification artifact, alongside secret, Sentry, browser, provider, and
  security/ops evidence.

## 2026-06-18 Follow-Up 76: Technical Stack Provider Inbox UX

### Trigger

Tony called out that adding tech stack entries in Technical Stack Overview
still needed a better experience and that MCP pulls must cover Apollo,
Seamless, and other valid sources.

### Issues Fixed

- Added provider filters to the edit-mode source review queue:
  - All
  - Apollo
  - Seamless
  - Tech Intel
  - Other
- Source suggestion cards now show transport posture (`MCP`, `API`, `Queue`,
  `Open data`, or an honest `MCP/API` fallback when no session transport has
  been reported).
- `Accept all` now applies to the currently reviewed provider filter, while
  All still accepts the full eligible queue.
- Kept the provider contract honest: Apollo remains queued MCP/API enrichment,
  Seamless remains MCP-first/API fallback, Tech Intel MCP remains the valid
  lane for BuiltWith/Wappalyzer/private technology sources, and open data stays
  separate.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  16/16 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx`:
  pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  28/28 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on desktop and 390px mobile found no horizontal overflow
  and no checked control below 44px.

### Remaining Launch Risks

- This proves the local UX/API/browser path. It does not certify live provider
  quality until staging/production Apollo, Seamless, and Tech Intel credentials,
  provider responses, rate-limit behavior, monitoring, and security approval
  evidence exist.

## 2026-06-18 Follow-Up 77: Release Evidence Bundle Runner

### Trigger

The strict deploy verifier correctly blocked production, but release evidence
generation was still spread across separate commands. That made the final
operator flow too manual for a 100k-user rollout.

### Issues Fixed

- Added `scripts/run-deploy-evidence-bundle.mjs`.
- Added bundle commands:
  - `pnpm deploy:evidence:bundle`
  - `pnpm deploy:evidence:bundle:staging`
  - `pnpm deploy:evidence:bundle:production`
  - `pnpm deploy:evidence:bundle:selftest`
- The bundle runner now sequences tool readiness, load, Semgrep, container,
  secret disposition, Sentry smoke, browser regression, and the strict final
  verifier.
- It writes `deploy-evidence/release-evidence-bundle-latest.json` with redacted
  output tails, preflight blockers, skipped steps, command durations, and the
  final verifier verdict.
- Dry-runs intentionally fail with `bundle.dry_run`, so planning artifacts
  cannot be mistaken for deploy approval.
- Release tool-readiness evidence now proves the bundle runner exists.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `scripts/write-release-tool-readiness.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm deploy:evidence:tools`: pass, 26 required checks, 0 blocking failures.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:production -- --dry-run`: pass as a dry-run
  command and wrote a blocked planning artifact with 17 preflight blockers plus
  `bundle.dry_run`.
- `pnpm deploy:evidence:production`: expected block with 12 pass, 0 warnings,
  5 failures.

### Remaining Launch Risks

- Production is still not certified. Remaining external proof:
  - non-local certification load artifact with `API_TOKEN`,
  - current secret-history disposition artifact,
  - live Sentry API and worker smoke observation,
  - cross-role browser regression against a non-local Clerk-backed production
    build target.

## 2026-06-18 Follow-Up 78: Secret Evidence Owner-Approver Gate

### Trigger

The default secret evidence artifact was missing from the strict production
gate. After generating honest local evidence, the gate proved current
tree/current-commit cleanliness but still depended on a boolean owner approval
field for historical findings.

### Issues Fixed

- Generated `deploy-evidence/secret-scan-latest.json` with only provable local
  facts:
  - tracked tree secret scan clean,
  - untracked source-file secret scan clean,
  - current commit Gitleaks clean through the Docker fallback,
  - full-history review/count recorded as 11 known historical findings,
  - no rotation/revocation or owner approval claimed.
- Added `ownerApprover` to `scripts/write-secret-scan-evidence.mjs`.
- Added `BIDSTACK_SECRET_OWNER_APPROVER` /
  `BIDSTACK_SECRET_SECURITY_OWNER` and `--owner-approver` /
  `--security-owner` inputs.
- Strict deploy verification now fails historical secret evidence unless a
  named owner approver is present when historical findings exist.
- Bundle preflight now includes `secrets.ownerApprover` so release operators see
  the requirement before the full evidence run.

### Implementation Map

- `scripts/write-secret-scan-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:secrets` with only local evidence env writes the default
  artifact and correctly exits non-zero on missing rotation/revocation and
  owner approval.
- `pnpm deploy:evidence:bundle:production -- --dry-run`: pass as a dry-run
  command and now reports 18 preflight blockers plus `bundle.dry_run`.
- `pnpm deploy:evidence:production`: expected block with 17 pass, 0 warnings,
  7 failures.

### Remaining Launch Risks

- Production is still not certified. Remaining external proof:
  - non-local certification load artifact with `API_TOKEN`,
  - security-owner confirmation that historical findings were rotated/revoked,
  - named owner approver for that secret-history disposition,
  - live Sentry API and worker smoke observation,
  - cross-role browser regression against a non-local Clerk-backed production
    build target.

## 2026-06-18 Follow-Up 79: Provider Quality Evidence + Tech Stack Intake Polish

### Trigger

The Technical Stack Overview add flow supported paste/drag/drop and MCP/API
source review, but the affordance still read like a textarea unless users knew
the parser existed. The release gate also documented Apollo, Seamless, and Tech
Intel source-quality risk without requiring live provider evidence.

### Issues Fixed

- Added a clearer bulk-intake target to the Technical Stack editor.
- Added a clear/reset command for staged pasted or dropped vendors.
- Added preview overflow feedback for large vendor batches.
- Added an empty-state source-pull action in the provider review queue.
- Added provider checked-count feedback to the source-pull panel.
- Added `pnpm deploy:evidence:providers` and
  `pnpm deploy:evidence:providers:selftest`.
- Added provider-quality artifact validation to the strict deploy verifier.
- Added provider-quality preflight and execution to the release evidence bundle.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `scripts/write-provider-quality-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `scripts/write-release-tool-readiness.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-provider-quality-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  17/17 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`
  against the reused local web/API pair: 1/1 pass.
- Browser QA on `http://127.0.0.1:5174/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`:
  desktop and 390px mobile edit-mode geometry had no horizontal overflow and
  scanned controls were 44px or larger.
- `pnpm deploy:evidence:providers:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-provider-quality-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:tools`: pass and includes
  `scripts/write-provider-quality-evidence.mjs` in required file proof.
- `pnpm deploy:evidence:providers` without live release env: expected block,
  writes a failed provider-quality artifact.
- `pnpm deploy:evidence:bundle:production -- --dry-run`: pass as dry-run,
  writes a blocked bundle plan with nine commands, 21 preflight blockers, and
  `bundle.dry_run`.
- `pnpm deploy:evidence:production`: expected block with 20 pass, 0 warnings,
  13 failures.

### Remaining Launch Risks

- Production is still not certified. Live staging/production evidence must prove
  non-local provider pulls with Apollo, Seamless, and Tech Intel credentials.

## 2026-06-18 Follow-Up 80: Secret History Disposition Evidence Hardening

### Trigger

The production deploy verifier correctly blocked historical secret disposition,
but the approval path still depended on separate boolean-like flags. For a
100k-user enterprise release, a security-owner disposition needs a stable
ticketed record that can be reviewed and rerun.

### Issues Fixed

- Added `BIDSTACK_SECRET_DISPOSITION_FILE` and `--disposition-file` support to
  the secret scan evidence writer.
- Added owner approval ticket/reference, ISO owner approval timestamp, and ISO
  rotation verification timestamp fields to the secret-history artifact.
- Tightened strict deploy verification so historical findings require owner
  identity, ticket/reference, owner approval timestamp, and rotation timestamp.
- Updated release bundle preflight to read the disposition file and accept it as
  the source for the secret-history checks.
- Added `docs/templates/secret-history-disposition.example.json`.

### Implementation Map

- `scripts/write-secret-scan-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/templates/secret-history-disposition.example.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:bundle:production -- --dry-run`: pass as dry-run and
  writes a blocked plan with 25 preflight blockers plus `bundle.dry_run`.
- `pnpm deploy:evidence:production`: expected block with 20 pass, 0 warnings,
  16 failures, including the new secret ticket/timestamp requirements.

### Remaining Launch Risks

- Production is still not certified. A real security owner must review the
  historical findings, confirm rotation/revocation, fill the disposition file,
  and provide staging/production release evidence for load, providers, Sentry,
  and Clerk-backed browser regression.

## 2026-06-18 Follow-Up 81: Source-Control Release Evidence Gate

### Trigger

The release evidence gate required live operational artifacts, but it did not
prove that those artifacts were generated from a clean, attributable Git
revision. A 100k-user enterprise release cannot be certified from a dirty local
worktree or an ambiguous source snapshot.

### Issues Fixed

- Added `pnpm deploy:evidence:source` and
  `pnpm deploy:evidence:source:selftest`.
- Added `deploy-evidence/source-control-latest.json` as a strict staging and
  production deploy artifact.
- Added source-control evidence to the release bundle immediately after tool
  readiness, before live provider/load/security evidence.
- Added `scripts/write-source-control-evidence.mjs` to release tool-readiness
  required file proof.
- Tightened strict verification so dirty, staged, tracked-modified, or
  untracked worktrees cannot pass release certification.

### Implementation Map

- `scripts/write-source-control-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `scripts/write-release-tool-readiness.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/release-tool-readiness-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-source-control-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-control-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:source`: expected block on the current dirty worktree,
  writing `deploy-evidence/source-control-latest.json`.
- `pnpm deploy:evidence:tools`: pass, with
  `scripts/write-source-control-evidence.mjs` in required file proof.
- `pnpm deploy:evidence:production`: expected block with 22 pass, 0 warnings,
  18 failures, including the new dirty-source failures.
- `pnpm deploy:evidence:bundle:production -- --dry-run`: pass as dry-run and
  lists ten release evidence commands.
- `pnpm deploy:evidence:bundle:production`: expected block; source-control
  evidence fails, later evidence generation is skipped, and the strict verifier
  still runs.

### Remaining Launch Risks

- Production is still not certified. The worktree must be reduced to a clean,
  reviewed release revision before live staging/production evidence can certify
  deployment readiness.

## 2026-06-18 Follow-Up 82: Source-Control Upstream Sync Gate

### Trigger

The new source-control evidence gate required a clean commit, but a clean local
commit is still not enough for enterprise release provenance. The release
candidate also needs to be on a reviewable upstream branch with no unpushed or
unpulled drift.

### Issues Fixed

- Added upstream tracking branch capture to source-control evidence.
- Added ahead/behind counts from `git rev-list --left-right --count`.
- Tightened source evidence validation so missing upstream or non-zero
  ahead/behind drift fails release evidence.
- Tightened strict deploy verification to require upstream presence and sync.
- Added selftest coverage for clean upstream-synced source and unpushed source.

### Implementation Map

- `scripts/write-source-control-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-source-control-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-control-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:source`: expected block on current dirty worktree.
- `pnpm deploy:evidence:production`: expected block with 24 pass, 0 warnings,
  18 failures. Source-control now passes upstream branch and upstream sync, but
  still fails dirty worktree.

### Remaining Launch Risks

- Production is still not certified. Current branch is synced with `origin/demo`,
  but the worktree is dirty and live external evidence/signoff is still missing.

## 2026-06-18 Follow-Up 83: Technical Stack MCP Provider UX Honesty

### Trigger

The Technical Stack Overview needed a stronger enterprise add/review
experience for Apollo, Seamless, Tech Intel MCP, and other valid source pulls.
The UX also needed to avoid implying Apollo MCP readiness when only a partial
MCP configuration was present.

### Issues Fixed

- Tightened Apollo refresh status so MCP is only reported when both the MCP URL
  and bearer token exist.
- Preserved the Apollo REST/API queue path when `APOLLO_API_KEY` is configured.
- Added an explicit partial-MCP unavailable state with a remediation message.
- Added a source-inbox overflow status when more provider suggestions are
  eligible than the dense visible review grid shows.
- Added regression coverage for hidden provider suggestions and partial Apollo
  MCP configuration.

### Implementation Map

- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/routes/crm/companies.test.ts`
- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- Web Technical Stack component tests: 18/18 pass.
- API provider/route/service tests: 29/29 pass.
- Worker Apollo enrichment tests: 22/22 pass.
- Targeted web/API ESLint: pass.
- Web/API TypeScript: pass.
- Provider evidence selftest: pass.
- Chromium Technical Stack E2E: 1/1 pass.

### Remaining Launch Risks

- Local proof still uses stub auth and local data. Production certification
  still needs live Apollo, Seamless, and Tech Intel provider evidence, plus the
  other release gates already listed in this report.

## 2026-06-18 Follow-Up 84: Release Preflight Evidence Command

### Trigger

The release evidence bundle already failed closed, but the operator path still
made staging-readiness discovery heavier than necessary. Teams needed a
first-class preflight command that checks live-input readiness without running
load, provider, Sentry, browser, scanner, or source evidence commands.

### Issues Fixed

- Added `--preflight-only` to the release evidence bundle runner.
- Added `pnpm deploy:evidence:preflight`,
  `pnpm deploy:evidence:preflight:staging`, and
  `pnpm deploy:evidence:preflight:production`.
- Added `deploy-evidence/release-preflight-latest.json` as the standalone
  preflight artifact.
- Kept preflight separate from deploy approval: preflight skips evidence
  commands and prints that evidence commands still need to run before approval.
- Added selftest coverage for clean preflight, blocked preflight, and
  `--dry-run` / `--preflight-only` mutual exclusion.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`:
  pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:staging` with dummy non-local release inputs:
  pass with zero blockers and no evidence commands executed.
- `pnpm deploy:evidence:preflight:production` on the current local environment:
  expected block with 24 missing live-input checks and no evidence commands
  executed.
- `git diff --check` for touched files: pass, with only the existing
  LF-to-CRLF warning for `package.json`.

### Remaining Launch Risks

- Preflight improves release readiness ergonomics but does not replace live
  evidence. Production is still not certified until source, provider, load,
  Sentry, browser, secret disposition, and security/ops gates all pass against
  staging or production.

## 2026-06-18 Follow-Up 85: Source Evidence Review Buckets

### Trigger

The source-control evidence gate correctly blocked the dirty worktree, but the
artifact was not helpful enough for review at the current change volume. A
100k-user release needs the source blocker to be strict and operationally
actionable.

### Issues Fixed

- Source evidence now runs `git status --porcelain=v1 -uall` so untracked
  directories expand to file-level paths.
- Dirty-source artifacts now include `sourceReview.statusKindCounts`.
- Dirty-source artifacts now include path-group counts for Web, API, Worker,
  MCP, packages, scripts, docs, infra, root config, and other files.
- Dirty-source artifacts now include review buckets for frontend UX, runtime
  code, security/auth/access, documentation, release/config, schema/migration,
  secret/env-sensitive, and uncategorized files.
- Each review group includes tracked, untracked, staged counts and a small file
  sample so reviewers can plan cleanup without file-content leakage.

### Implementation Map

- `scripts/write-source-control-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-source-control-evidence.mjs`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-control-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source`: expected block on the current dirty worktree,
  now writing a review-bucketed artifact. Current bucket summary:
  `status=372`, `tracked=240`, `untracked=132`, top review buckets
  `Frontend UX=154`, `Runtime code=149`, `Security/auth/access files=47`,
  `Documentation=37`, `Uncategorized=17`.
- `git diff --check` for touched files: pass, with only the existing
  LF-to-CRLF warning for `MISTAKES.md`.

### Remaining Launch Risks

- The source gate still correctly blocks release. The next release-readiness
  step is to review, commit, split, or intentionally discard dirty changes
  outside this automated cleanup tool, then rerun `pnpm deploy:evidence:source`.

## 2026-06-18 Follow-Up 86: Source Review Cleanup Plan

### Trigger

The source evidence artifact now exposes review buckets, but release operators
still needed an ordered, non-destructive cleanup plan before the clean-source
gate could realistically pass.

### Issues Fixed

- Added `scripts/write-source-review-plan.mjs`.
- Added `pnpm deploy:evidence:source:plan` and
  `pnpm deploy:evidence:source:plan:selftest`.
- Added release tool-readiness proof for the source review planner script.
- The planner reads `deploy-evidence/source-control-latest.json` and writes
  `deploy-evidence/source-review-plan-latest.json`.
- The plan groups dirty source into prioritized cleanup waves with samples,
  review notes, and suggested verification commands.
- The plan is advisory only and does not weaken `pnpm deploy:evidence:source`;
  it fails while active cleanup waves exist.

### Implementation Map

- `scripts/write-source-review-plan.mjs`
- `scripts/write-release-tool-readiness.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/release-tool-readiness-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-source-review-plan.mjs`: pass.
- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass.
- `pnpm deploy:evidence:source:plan`: expected block on active cleanup waves.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-review-plan.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- Package JSON parse: pass.

### Current Plan

- P0 release-critical configuration/secrets: 24 touches.
- P0 security/auth/access/observability: 47 touches.
- P1 runtime services and shared packages: 298 touches.
- P1 frontend UX and browser regression: 308 touches.
- P2 docs/runbooks/audit records: 72 touches.
- P2 uncategorized/local coordination files: 32 touches.

### Remaining Launch Risks

- Production still cannot certify until the cleanup plan is acted on and
  `pnpm deploy:evidence:source` passes from a clean reviewed release revision.

## 2026-06-18 Follow-Up 87: Exact Source Cleanup Manifests

### Trigger

The source review plan created cleanup waves, but the first version still only
showed aggregate counts and samples. Reviewers need exact paths per wave before
they can split, commit, or intentionally discard changes.

### Issues Fixed

- Added full path-only `statusManifest` entries to source-control evidence.
- Each manifest entry records status, status kind, file path, path group, and
  review bucket ids.
- Source review plans now attach exact `files` arrays and `fileCount` to each
  cleanup wave.
- Human-readable `statusEntries` remains capped for readability, while
  `statusManifest` carries the full path list for tooling.
- No file contents, secrets, staging, Git staging, commits, deletes, or resets
  are performed by these tools.

### Implementation Map

- `scripts/write-source-control-evidence.mjs`
- `scripts/write-source-review-plan.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-source-control-evidence.mjs`: pass.
- `node --check scripts/write-source-review-plan.mjs`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-control-evidence.mjs scripts/write-source-review-plan.mjs`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source`: expected block on current dirty tree, now with
  `statusManifest`.
- `pnpm deploy:evidence:source:plan`: expected block on active cleanup waves,
  now with exact file manifests.

### Current Manifest

- Source status manifest count: 373 paths.
- Release-critical P0: 24 touches, 23 exact files.
- Security/access P0: 47 touches, 47 exact files.
- Runtime P1: 298 touches, 149 exact files.
- Frontend UX P1: 308 touches, 154 exact files.
- Docs P2: 72 touches, 37 exact files.
- Uncategorized P2: 33 touches, 28 exact files.

### Remaining Launch Risks

- Exact manifests make source cleanup operationally clear, but production still
  requires a clean reviewed worktree and live staging/prod release evidence.

## 2026-06-18 Follow-Up 88: Bundle Writes Source Cleanup Plan

### Trigger

The source cleanup planner existed, but a failed production bundle still forced
operators to run a second command before they could see the exact cleanup waves.

### Issues Fixed

- Added `pnpm deploy:evidence:source:plan:write`, a write-only diagnostic mode
  that returns success after writing active cleanup waves.
- The release bundle now runs `Source review cleanup plan` automatically after
  `Source-control evidence` fails.
- The diagnostic step only follows a source-control failure, so unrelated early
  failures do not create a stale cleanup plan.
- Direct `pnpm deploy:evidence:source:plan` still exits non-zero while cleanup
  waves are active.
- The strict final verifier and clean-source release gate remain unchanged.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `scripts/write-source-review-plan.mjs`
- `package.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/release-tool-readiness-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `node --check scripts/write-source-review-plan.mjs`: pass.
- Package JSON parse: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs scripts/write-source-review-plan.mjs`:
  pass.
- `pnpm deploy:evidence:source`: expected block on the dirty worktree.
- `pnpm deploy:evidence:source:plan`: expected block on active cleanup waves.
- `pnpm deploy:evidence:source:plan:write`: pass and writes
  `deploy-evidence/source-review-plan-latest.json` while explicitly keeping
  release source evidence blocked.
- `pnpm deploy:evidence:bundle:production`: expected block. It now runs
  `Source review cleanup plan` after failed `Source-control evidence`, skips
  downstream live evidence, and still fails the strict production verifier.
- Artifact sanity check: bundle `commandCount=11`, source plan step
  `passed=true`, no `sourcePlan.*` blocking failure, cleanup plan
  `passed=false` with 6 active review waves.
- Targeted `git diff --check`: pass with only LF-to-CRLF warnings for
  `MISTAKES.md` and `package.json`.

### Remaining Launch Risks

- This improves failed-bundle recovery only. Production remains blocked until
  source cleanup is reviewed and committed, live provider/load/Sentry/browser
  evidence is captured, and security/ops approval is recorded.

## 2026-06-18 Follow-Up 89: Release Source Noise Reduction

### Trigger

The exact source manifest was counting local Forge run state and temporary i18n
sweep batch files as untracked release source, adding noise to an already-large
dirty-source blocker.

### Issues Fixed

- Added `.forge/` to `.gitignore` for local WALTEUR/Forge run notes, logs, and
  QA screenshots.
- Added `apps/web/scripts/_i18n_*` to `.gitignore` for generated i18n sweep
  batch drivers/results.
- Kept `apps/web/scripts/i18n-coverage.mts` tracked as the canonical source
  coverage tool.
- Regenerated source evidence and source review plan; scratch paths are no
  longer present in `statusManifest`.
- The clean-source release gate remains strict and still blocks the real dirty
  source/docs changes.

### Implementation Map

- `.gitignore`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `pnpm deploy:evidence:source`: expected block, now with 363 dirty entries,
  240 tracked dirty entries, and 123 untracked entries.
- `pnpm deploy:evidence:source:plan:write`: pass; review plan remains blocked
  with 6 active waves.
- Artifact sanity check: no `.forge/` or `apps/web/scripts/_i18n_*` paths remain
  in `deploy-evidence/source-control-latest.json.statusManifest`.
- `git status --short --ignored -- .forge apps/web/scripts/_i18n_*`: all target
  scratch paths reported as ignored.
- `node --check scripts/write-source-control-evidence.mjs`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:bundle:production`: expected block; bundle
  `commandCount=11`, `sourcePlan` passed, no `sourcePlan.*` blocking failure,
  `source.failed` remained blocking, and source manifest stayed at 363 entries.
- Targeted `git diff --check`: pass with only LF-to-CRLF warnings for
  `.gitignore` and `MISTAKES.md`.

### Remaining Launch Risks

- Source noise is lower, but production remains blocked until the remaining
  source/docs changes are reviewed and committed or intentionally removed, and
  live release evidence is captured.

## 2026-06-18 Follow-Up 90: Release Evidence Input Template

### Trigger

The release bundle preflight correctly reported 24 missing live inputs, but the
operator path still required collecting those variables from several evidence
sections.

### Issues Fixed

- Added `docs/templates/release-evidence.env.example`.
- The template is placeholder-only and safe to track.
- It covers non-local API/web targets, short-lived API tokens, provider quality
  inputs, Apollo/Seamless/Tech Intel MCP credentials, secret disposition file
  path, Sentry smoke settings, and Clerk-backed browser regression settings.
- Hardened the bundle preflight and secret evidence writer to accept
  BOM-prefixed UTF-8 JSON disposition files created by PowerShell.
- Updated `docs/solutions/deploy-evidence-hard-gate.md` to point staging and
  production operators to the template before running preflight.
- The template does not bypass any gate; filled values must live in CI secrets
  or ignored `deploy-evidence/` files.

### Implementation Map

- `docs/templates/release-evidence.env.example`
- `scripts/run-deploy-evidence-bundle.mjs`
- `scripts/write-secret-scan-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- Template parse: 38 unique environment keys, no duplicates.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass, including BOM-prefixed
  disposition-file preflight coverage.
- `pnpm deploy:evidence:secrets:selftest`: pass, including BOM-prefixed
  disposition-file coverage.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs scripts/write-secret-scan-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:staging` with dummy non-local template values
  and a PowerShell-written disposition JSON: pass, zero blockers,
  27 environment checks.
- Targeted `git diff --check`: pass with only the existing LF-to-CRLF warning
  for `MISTAKES.md`.

### Remaining Launch Risks

- The template makes live evidence collection explicit, but Tony/security/ops
  still need to provide real staging values, security-owner disposition, and
  Clerk-backed test accounts before preflight can pass.

## 2026-06-18 Follow-Up 91: Technical Stack Review Count Honesty

### Trigger

Tony called out that adding technologies in Technical Stack Overview still
needed to feel better and that MCP/source pulls must cover Apollo, Seamless,
and other valid sources.

### Issues Fixed

- Re-verified the existing premium source-pull flow: Apollo is reported through
  the MCP/API enrichment queue, Seamless is MCP-first with API fallback, Tech
  Intel is the generic MCP lane for valid providers such as BuiltWith or
  Wappalyzer when configured, and open data stays separate.
- Fixed a live UX honesty issue in the edit workbench. After accepting a
  provider-suggested technology into the draft, the provider panel now reduces
  the `to review` count immediately instead of showing the original server
  suggestion count until save.
- Added regression coverage so the provider metric moves from `1 to review` to
  `0 to review` as soon as an Apollo suggestion is staged.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  18/18 pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  29/29 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/providers/company-tech-stack-mcp.ts src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.ts src/routes/crm/companies.test.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Remaining Launch Risks

- Local proof still uses stub auth and local data. Live provider source quality
  still requires staging/production Apollo, Seamless, and Tech Intel MCP
  credentials, observed responses, rate-limit/monitoring evidence, and security
  approval.

## 2026-06-18 Follow-Up 92: Technical Stack Add Flow Safety + Freshness

### Trigger

Tony called out that adding technologies in Technical Stack Overview needed a
better experience and that MCP pulls must cover Apollo, Seamless, and other
valid technology sources.

### Issues Fixed

- Made capped provider queues safer. When the source inbox shows the first
  eight suggestions, the batch command now reads `Accept visible` and stages
  only the visible rows instead of hidden provider rows.
- Added regression coverage so an overflowed Apollo/Seamless queue saves only
  the visible eight staged provider technologies.
- Kept `Accept all` for uncapped or filtered queues where the full actionable
  set is visible.
- Made compact provider suggestions always expose `Review all`, even when only
  one update exists, so users can open the full provenance workbench.
- Replaced unchecked source-rail `Ready` copy with `Check MCP` for Apollo,
  Seamless, and Tech Intel lanes when no session provider evidence is present.
- Added queued-source polling after refresh. If Apollo is queued through the
  MCP/API worker lane, the card refetches technical-stack state for up to one
  minute instead of making the user leave, reload, or log back in to see
  completed source evidence.
- Added provider-specific accents and reduced-motion-safe hover/active feedback
  on source cards.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  20/20 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/providers/open-data-connectors.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  31/31 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/web exec playwright test e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on
  `http://127.0.0.1:4174/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`:
  Technical Stack mounted, editor opened, source lanes rendered, an unsaved
  technology staged, cancel exited editing, and console errors were empty.

### Remaining Launch Risks

- Local proof still uses stub auth and local data. Live source quality still
  requires staging/production Apollo, Seamless, and Tech Intel MCP credentials,
  observed provider responses, provider-quality evidence, and security/ops
  approval.

## 2026-06-18 Follow-Up 93: Release Preflight Placeholder Rejection

### Trigger

The latest release preflight artifact showed a dangerous false-green pattern:
staging preflight could pass with example infrastructure values and sample
security-owner fields. A 100k-user deploy gate cannot treat copied template
values as release-ready inputs.

### Issues Fixed

- The bundle preflight now rejects `.example` / `example.com` URLs even when
  they are non-local and syntactically valid.
- Load, provider-quality, and Sentry smoke token checks now require realistic
  length and reject known placeholder token strings.
- Provider company key, Sentry release/org/project, secret-history approver,
  reviewer, and approval ticket fields now reject angle-bracket placeholders
  and sample values such as `security-owner@example.com` or `SEC-123`.
- The bundle selftest now proves both sides: release-shaped inputs pass, copied
  template inputs block.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- Placeholder preflight probe: exit `1`; blockers included URL, token,
  provider company key, Tech Intel source labels, secret owner/reviewer/ticket,
  Sentry release/org, and browser target checks.
- Non-placeholder release-shaped preflight probe: exit `0`; zero blockers.
- `pnpm deploy:evidence:preflight:staging` in the current shell refreshed
  `deploy-evidence/release-preflight-latest.json`: expected block, exit `1`,
  25 blockers.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `git diff --check -- scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.

### Remaining Launch Risks

- This closes a false-green input readiness gap. It does not provide live
  staging evidence. Deployment still requires clean reviewed source, real
  provider-quality evidence, non-local load certification, Sentry smoke proof,
  Clerk-backed browser regression, and security/ops approval.

## 2026-06-18 Follow-Up 94: Release Bundle Preflight Fail-Fast

### Trigger

After placeholder rejection, the bundle still had a release-discipline issue:
it collected preflight blockers but the normal execution path could continue
into evidence commands. Missing live release inputs should stop the bundle
cleanly before source/tool/provider/load work starts unless the operator
explicitly asks for diagnostics.

### Issues Fixed

- `runBundle()` now fails fast when `preflight.blockingFailures` is non-empty
  and `--continue-on-error` is not set.
- Planned evidence steps are retained in the artifact for operator visibility,
  but each is marked skipped with `skipReason: "preflight blockers"`.
- The final `blockingFailures` list no longer duplicates every skipped step
  when preflight already explains the failure. It reports the `preflight.*`
  blockers as the authoritative stop reason.
- `--dry-run` remains a planning artifact and `--continue-on-error` remains the
  explicit diagnostic override.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- Blocked production bundle probe with current shell:
  `exit=1`, 25 preflight blockers, all 11 planned steps skipped for
  `preflight blockers`, and no non-preflight blocking IDs.
- `pnpm deploy:evidence:bundle:production` refreshed
  `deploy-evidence/release-evidence-bundle-latest.json` with the same
  fail-fast shape.

### Remaining Launch Risks

- This reduces release-runner noise and wasted execution. It still does not
  provide live staging evidence. Deployment remains blocked on clean reviewed
  source, live provider/load/Sentry/browser evidence, Clerk-backed auth proof,
  and security/ops approval.

## 2026-06-18 Follow-Up 95: Multiple Tech Intel MCP Sources

### Trigger

Tony asked for the Technical Stack Overview add experience to pull Apollo,
Seamless, and any other valid source. The UI already exposed a generic Tech
Intel MCP lane, but the backend still modeled it as one endpoint. That meant
BuiltWith plus Wappalyzer plus a private gateway required a custom aggregator
before users could review those sources together.

### Issues Fixed

- Kept the legacy `TECH_STACK_MCP_URL` / `TECH_STACK_MCP_LABEL` single-source
  path compatible.
- Added `TECH_STACK_MCP_SOURCE_IDS` with per-source variables such as
  `TECH_STACK_MCP_BUILTWITH_URL` and `TECH_STACK_MCP_WAPPALYZER_URL`.
- Added a plural Tech Intel MCP fetch path that calls configured MCP sources
  independently, merges unique technology names, preserves provider labels,
  and tolerates one empty/failing source when another returns evidence.
- Stored both legacy `techStackMcp` metadata and plural `techStackMcps`
  metadata, then serialized plural sources into separate provider-labeled
  stack categories for review.
- Updated the refresh provider rail so multiple Tech Intel MCP configs report
  as one honest `tech_intel` lane with a multi-source label.

### Implementation Map

- `apps/api/src/providers/company-tech-stack-mcp.ts`
- `apps/api/src/providers/company-tech-stack-mcp.test.ts`
- `apps/api/src/services/crm/enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.test.ts`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/env.ts`
- `.env.example`
- `docs/templates/release-evidence.env.example`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  9/9 pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- Targeted API ESLint for touched provider/enrichment/route/env files: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  32/32 pass.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  20/20 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- Targeted web ESLint for Technical Stack component/style/e2e files: pass.
- In-app browser smoke on `http://127.0.0.1:4174/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`:
  Technical Stack region rendered, edit-mode provider workbench opened, bulk
  intake/draft/source queue panels rendered, scoped `Pull sources` button
  updated checked lanes from 0 to 4, local config honestly reported Apollo /
  Seamless / Tech Intel not configured and Open data synced, console errors
  empty.
- `E2E_REUSE_SERVER=1 pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass against the already-running API/web preview.

### Remaining Launch Risks

- Live source quality still requires staging/production Apollo, Seamless, and
  named Tech Intel MCP credentials, observed provider responses, rate-limit
  evidence, monitoring, and security/ops approval.

## 2026-06-18 Follow-Up 96: Named Tech Intel Evidence Gate

### Trigger

After adding multiple Tech Intel MCP sources, the release gate still had one
false-green path: provider quality could prove the generic `tech_intel` lane
without proving the exact named MCP sources promised for launch, such as
BuiltWith and Wappalyzer.

### Issues Fixed

- Preserved human source labels in provider-quality evidence instead of
  lowercasing labels through the provider-id parser.
- Recorded observed Tech Intel MCP source labels and source keys in
  `provider-quality-latest.json`.
- Added `BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES` and
  `BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES` as strict source expectations.
- Updated the strict deploy verifier so a release can require BuiltWith MCP and
  Wappalyzer MCP separately, not just a generic Tech Intel signal.
- Updated bundle preflight and the release env template so missing named Tech
  Intel source expectations block before live evidence commands start.

### Implementation Map

- `scripts/write-provider-quality-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/templates/release-evidence.env.example`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-provider-quality-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:providers:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-provider-quality-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, now
  including `preflight.providers.techIntelSources`.

### Remaining Launch Risks

- This closes the named-source evidence gap only. Deployment still requires
  real staging/production Apollo, Seamless, BuiltWith/Wappalyzer/private Tech
  Intel MCP credentials, clean reviewed source, non-local load/Sentry/browser
  evidence, Clerk-backed auth proof, and security/ops approval.

## 2026-06-18 Follow-Up 97: Operational Readiness Evidence Gate

### Trigger

The release evidence gate could block weak app/source/provider proof, but
platform readiness still lived mostly in docs and human memory: Azure plan,
migration path, database backup/restore, rollback drill, monitoring alerts, and
on-call approval were not a machine-readable strict artifact.

### Issues Fixed

- Added a dedicated operational readiness evidence writer with a reviewed JSON
  input path and explicit `BIDSTACK_OPS_*` environment fallback.
- Added strict verifier checks for release id, reviewer, approver, ticket,
  approval timestamp, Bicep build, Azure what-if, private networking, storage,
  migrations, backups, restore RTO/RPO, rollback drill, alerts, and on-call.
- Added bundle preflight loading for `BIDSTACK_OPS_READINESS_FILE` so a release
  runner can fail before executing expensive live evidence when ops approval is
  missing or placeholder-shaped.
- Added `pnpm deploy:evidence:ops` and `pnpm deploy:evidence:ops:selftest`,
  then required the writer in release-tool readiness.
- Added an operational readiness JSON template for platform/ops signoff.

### Implementation Map

- `scripts/write-operational-readiness-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `scripts/write-release-tool-readiness.mjs`
- `package.json`
- `docs/templates/operational-readiness.example.json`
- `docs/templates/release-evidence.env.example`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/release-tool-readiness-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-operational-readiness-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:ops:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- Targeted ESLint for the touched deploy-evidence scripts: pass.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`,
  now including operational readiness blockers.
- `pnpm deploy:evidence:bundle:production`: expected block, exit `1`, 46
  preflight blockers, 12 planned evidence steps skipped, and no evidence
  commands executed.

### Remaining Launch Risks

- This makes operational readiness fail-closed. It does not create the live
  approval. Launch still needs a real staging/production ops signoff file,
  clean reviewed source, real provider/load/Sentry/browser evidence,
  Clerk-backed auth proof, security-owner approval for historical secrets, and
  platform/ops approval from the release owner.

## 2026-06-18 Follow-Up 98: Tenant-Safe Idle Cache Recovery

### Trigger

Tony reported the app can feel stuck after staying on a page for a while and
recover only after logging out and back in. The shared API boundary already
forced one token refresh on `401`/`403`, but the persisted React Query cache
still had one enterprise-grade identity gap: demo sessions and Clerk org
switches could keep a stable local session marker while the tenant/workspace
changed underneath it.

### Issues Fixed

- `watchAuthForCacheClear` now listens for a same-tab
  `bidstack:auth-fingerprint-change` event in addition to browser `storage`
  events.
- Auth writes emit that fingerprint event even when `bidstack:session` keeps
  the same value, so a new demo email/workspace clears cached CRM snapshots.
- Clerk session markers now include the active organization id
  (`userId:orgId`), so switching organizations clears user-scoped query data.
- Existing forced-token-refresh behavior remains bounded to one retry and
  still surfaces real permission failures.

### Implementation Map

- `apps/web/src/lib/queryCache.ts`
- `apps/web/src/lib/queryCache.test.ts`
- `apps/web/src/lib/auth.tsx`
- `apps/web/src/lib/auth.test.tsx`
- `docs/solutions/idle-auth-refresh-and-focus-refetch.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/lib/queryCache.test.ts src/lib/auth.test.tsx src/lib/api.test.ts --reporter=dot`:
  20/20 pass.
- Targeted web ESLint for touched auth/cache files: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `E2E_AUTH_MODE=demo E2E_PORT_OFFSET=80 pnpm --filter @bidstack/web e2e -- e2e/flows/idle-auth-recovery.spec.ts --project=chromium-desktop`:
  1/1 pass against a fresh production-preview build.

### Remaining Launch Risks

- This closes a local stale-cache/tenant-switch class. Full launch still needs
  real Clerk-backed staging browser evidence, load/Sentry/provider evidence,
  source cleanup, security-owner approval, and platform/ops approval.

## 2026-06-18 Follow-Up 99: Pipeline Drag-And-Drop QA Gate

### Trigger

Tony asked for all functionality, buttons, drag-and-drop, and critical controls
to be QA-tested before a 100k-user rollout. The pipeline board already had
keyboard movement and mutation coverage, but pointer/native drag-and-drop did
not have a dedicated browser proof that created data, moved it, and checked the
API persisted the move.

### Issues Fixed

- Added an API-backed Playwright fixture for pipeline opportunities so board
  tests no longer depend only on seeded data.
- Added native `DataTransfer` dragover/drop coverage for stage movement.
- Added API polling after the drop to prove the persisted stage id matches the
  target column, not only the optimistic UI.
- Added stage-mutation rollback coverage for rejected moves across list,
  detail, and count React Query caches.
- Removed React act warning noise from the focused mutation test, so green
  output stays trustworthy.
- Tightened keyboard-path cleanup so temporary test opportunities are deleted
  even when the test skips early.

### Implementation Map

- `apps/web/e2e/flows/pipeline.spec.ts`
- `apps/web/src/hooks/useStageMutation.test.tsx`
- `docs/solutions/pipeline-drag-drop-qa-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/hooks/useStageMutation.test.tsx --reporter=dot`:
  3/3 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/hooks/useStageMutation.ts src/hooks/useStageMutation.test.tsx src/pages/PipelinePage.tsx src/pages/pipelineBoard/PipelineCard.tsx src/pages/pipelineBoard/StageColumn.tsx e2e/flows/pipeline.spec.ts e2e/pages/PipelinePage.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `$env:E2E_PORT_OFFSET='131'; pnpm --filter @bidstack/web e2e -- e2e/flows/pipeline.spec.ts --project=chromium-desktop`:
  fresh production-preview run, 7 passed / 1 skipped.

### Remaining Launch Risks

- This proves the local/stub-auth critical pipeline drag-and-drop and keyboard
  paths. Full launch still needs cross-browser release evidence against the
  final reviewed source, real Clerk-backed staging auth, live provider evidence,
  load/Sentry proof, security-owner approval, and platform/ops approval.

## 2026-06-18 Follow-Up 100: Pipeline Outcome Buttons QA Gate

### Trigger

Tony asked for buttons, drag-and-drop, and more to be fully QA-tested before a
100k-user rollout. During the pipeline QA pass, the mark-won browser test was
still seed-dependent and could skip when the first rendered deal was already
terminal. The opportunity detail page also lacked explicit `Mark Won` and
`Mark Lost` controls even though the E2E page object expected them.

### Issues Fixed

- Added explicit `Mark Won` and `Mark Lost` buttons to the opportunity detail
  header, making terminal revenue actions first-class controls.
- Wired those buttons through the stage-transition route so custom pipeline
  `pipelineStageId` values remain coherent with terminal outcome state.
- Added disabled terminal states for already won or lost opportunities.
- Added a user-facing failure toast if an outcome move fails.
- Scoped optional confirmation clicks in the E2E page object to actual dialogs.
- Replaced the seed-dependent mark-won test with deterministic fixture-backed
  won and lost browser tests.
- Changed outcome assertions to verify durable pipeline semantics
  (`pipelineStageId` plus `pipelineStage.isWon` or `pipelineStage.isLost`)
  instead of brittle display labels.

### Implementation Map

- `apps/web/src/pages/OpportunityDetailPage.tsx`
- `apps/web/e2e/pages/DealDetailPage.ts`
- `apps/web/e2e/flows/pipeline.spec.ts`
- `docs/solutions/pipeline-outcome-buttons-qa-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/hooks/useStageMutation.test.tsx --reporter=dot`:
  3/3 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/pages/OpportunityDetailPage.tsx src/hooks/useStageMutation.ts e2e/flows/pipeline.spec.ts e2e/pages/DealDetailPage.ts e2e/pages/PipelinePage.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `$env:E2E_PORT_OFFSET='133'; Remove-Item Env:E2E_AUTH_MODE -ErrorAction SilentlyContinue; pnpm --filter @bidstack/web e2e -- e2e/flows/pipeline.spec.ts --project=chromium-desktop`:
  fresh production-preview run, 9/9 pass.
- `$env:E2E_PORT_OFFSET='134'; Remove-Item Env:E2E_AUTH_MODE -ErrorAction SilentlyContinue; pnpm --filter @bidstack/web e2e -- e2e/flows/pipeline.spec.ts --project=chromium-desktop --grep "mark deal as (won|lost)"`:
  fresh production-preview run, 2/2 pass after adding the failure toast.

### Remaining Launch Risks

- This proves the local/stub-auth terminal revenue controls and pipeline board
  paths. Full launch still needs cross-browser release evidence against the
  final reviewed source, real Clerk-backed staging auth, live Apollo/Seamless
  and Tech Intel provider evidence, load/Sentry proof, security-owner approval,
  and platform/ops approval.

## 2026-06-18 Follow-Up 101: Source Review Plan Currency Gate

### Trigger

The deploy source cleanup plan was generated before later Technical Stack,
operational readiness, idle-cache, and pipeline QA slices. During a long
100k-readiness push, a stale source plan can make the worktree cleanup look
more actionable than it is.

### Issues Fixed

- `scripts/write-source-review-plan.mjs` now compares the source-control
  artifact against the current Git worktree before allowing active cleanup
  waves.
- The currency check compares commit, branch, upstream, and the full normalized
  `statusManifest`.
- Stale source evidence writes the diagnostic artifact but exits non-zero with
  `source_evidence_stale`, even when `--allow-active` is set.
- The plan artifact now records `sourceEvidenceCurrent` and `sourceCurrency`
  with mismatch reasons and manifest deltas.
- After rerunning source evidence, the plan correctly resumes write-mode for
  the current dirty worktree.

### Implementation Map

- `scripts/write-source-review-plan.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/audits/2026-06-16-serum-ux-ui-walteur-report.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-source-review-plan.mjs`: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-review-plan.mjs`:
  pass.
- `pnpm deploy:evidence:source:plan:write` against the stale source artifact:
  expected block, exit `1`, `Source evidence current: no`,
  `status_manifest_mismatch`.
- `pnpm deploy:evidence:source`: expected block, exit `1`, wrote current source
  evidence with 371 dirty status entries.
- `pnpm deploy:evidence:source:plan:write` after fresh source evidence:
  pass, exit `0`, `Source evidence current: yes`, six active cleanup waves.

### Remaining Launch Risks

- This makes the dirty-source cleanup plan current and fail-closed. It does not
  clean or approve the 371 dirty source entries. Full launch still needs source
  review/commit or intentional cleanup, live Apollo/Seamless/named Tech Intel
  evidence, non-local load/Sentry/browser evidence, real Clerk-backed staging
  proof, security-owner historical secret disposition, and platform/ops
  approval.

## 2026-06-18 Follow-Up 102: Technical Stack Import Workbench

### Trigger

Tony called out that adding stack technologies inside Technical Stack Overview
still needed to feel better, and that provider pulls must cover Apollo,
Seamless, and any valid MCP source.

### Issues Fixed

- Added a visible import-file path to the edit-mode stack intake surface.
- CSV, TSV, TXT, and MD files now use the same category-aware parser as paste
  and drag/drop.
- The intake surface shows the imported file/drop label and parsed preview
  before a user stages vendors into the curated stack.
- Updated source-pull copy to the honest runtime contract: Apollo MCP/API,
  Seamless MCP/API, Tech Intel MCP sources, and open data.
- Adjusted the provider panel so dense metrics wrap cleanly under the provider
  title instead of crowding narrow cockpit columns.
- Kept BuiltWith, Wappalyzer, and other valid sources behind the configured Tech
  Intel MCP source contract rather than showing unsupported fake first-class
  lanes.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  21/21 pass.
- Targeted web ESLint for TechStack component, test, cockpit CSS, and E2E:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  20/20 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`
  against reused local preview/API: 1/1 pass.
- In-app Browser QA on `http://127.0.0.1:4174` verified the Technical Stack
  region, source pull, edit workbench, import button, MCP/API copy, provider
  panel, zero console errors, and no page-level horizontal overflow.

### Remaining Launch Risks

- Local QA still uses stub auth and local provider posture. Salesforce-grade
  release remains blocked on live Apollo, Seamless, and named Tech Intel MCP
  credentials/evidence, dirty-source review, real Clerk-backed staging proof,
  non-local load/Sentry/browser evidence, security-owner approval, and platform
  ops approval.

## 2026-06-18 Follow-Up 103: Secret Disposition Placeholder Hard Gate

### Trigger

P0 release evidence still needed a second guard against copied secret-history
approval templates. Preflight already rejected placeholder environment values,
but the secret evidence writer and strict verifier could still treat a
preexisting artifact with non-empty sample owner/reviewer/ticket strings as
meaningful evidence.

### Issues Fixed

- `scripts/write-secret-scan-evidence.mjs` now rejects placeholder
  owner/reviewer/ticket values while building the artifact.
- `scripts/verify-deploy-evidence.mjs` now rejects the same placeholder strings
  when verifying an existing artifact.
- The poisoned examples include `security-owner@example.com`,
  `release-security@example.com`, `SEC-123`, `SEC-1234`, angle-bracket values,
  `sample`, `placeholder`, `replace-me`, and `todo`.
- The writer now reports placeholder owner and ticket issues independently
  instead of stopping after the first bad approval field.

### Implementation Map

- `scripts/write-secret-scan-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 371 entries.
- `pnpm deploy:evidence:source:plan:write`: pass, `Source evidence current:
  yes`, six active cleanup waves.

### Remaining Launch Risks

- This closes one false-green evidence path. It does not certify deployment.
  Release remains blocked by 371 dirty source entries, missing real
  security-owner secret disposition, missing live Apollo/Seamless/named Tech
  Intel evidence, stale/local load evidence, missing non-local Sentry/browser
  evidence, real Clerk-backed staging proof, and platform/ops approval.

## 2026-06-18 Follow-Up 104: Operational Approval Ticket Placeholder Hard Gate

### Trigger

The operational readiness gate already rejected missing approval proof and
obvious placeholders, but copied sample tickets such as `OPS-1234` could still
look release-shaped if the operator replaced the emails and release id.

### Issues Fixed

- `scripts/write-operational-readiness-evidence.mjs` now rejects exact sample
  values such as `OPS-123`, `OPS-1234`, and `ticket-123` in addition to
  angle-bracket, example, sample, placeholder, replace-me, and todo values.
- `scripts/verify-deploy-evidence.mjs` now rejects the same sample operational
  approval tickets when strict verification reads an existing artifact.
- `scripts/run-deploy-evidence-bundle.mjs` now rejects the same values during
  preflight before evidence commands run.
- `docs/templates/operational-readiness.example.json` now uses
  `MANTU-OPS-<real-ticket-id>` so the template reads as a placeholder rather
  than a usable ticket.

### Implementation Map

- `scripts/write-operational-readiness-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/templates/operational-readiness.example.json`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/write-operational-readiness-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:ops:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-operational-readiness-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, 46
  blockers.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 371 entries.
- `pnpm deploy:evidence:source:plan:write`: pass, `Source evidence current:
  yes`, six active cleanup waves.

### Remaining Launch Risks

- This closes another false-green operational readiness path. It does not
  certify deployment. Release remains blocked by 371 dirty source entries,
  missing real platform/ops approval, missing live Apollo/Seamless/named Tech
  Intel evidence, missing real security-owner secret disposition, stale/local
  load evidence, non-local Sentry/browser evidence, and real Clerk-backed
  staging proof.

## 2026-06-18 Follow-Up 105: Technical Stack Staged Add + Provider Proof

### Trigger

Tony called out that adding technologies in the Technical Stack Overview still
needed to feel better, and that the MCP/source pull must cover Apollo,
Seamless, and other valid sources rather than only looking good in the UI.

### Issues Fixed

- The add experience now presents a clear staged command instead of relying on
  a small utility-style action. It shows `Stage` / `Stage N`, preserves the
  accessible `Add vendor` name, and exposes live intake status for ready,
  duplicate, auto-route, and manual-category states.
- Duplicate staged technologies now disable the add command and update the
  duplicate counter before the user saves.
- Tech Intel provider labels now name configured MCP sources such as BuiltWith
  and Wappalyzer, rather than showing a generic `Tech Intel MCP` count.
- Provider-quality evidence now rejects fixture/local/template-shaped provider
  proof in strict mode. Apollo, Seamless, and Tech Intel source lanes must be
  proven by live release-shaped evidence before deploy verification can pass.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/api/src/routes/crm/companies.ts`
- `apps/api/src/routes/crm/companies.test.ts`
- `scripts/write-provider-quality-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  21/21 pass.
- `pnpm --filter @bidstack/api test -- src/routes/crm/companies.test.ts apps/api/src/providers/company-tech-stack-mcp.test.ts apps/api/src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  company-route coverage pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  9/9 pass.
- Targeted web/API/script ESLint: pass.
- Web/API TypeScript and builds: pass.
- `pnpm deploy:evidence:providers:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `$env:E2E_PORT_OFFSET='141'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA verified source pull, edit mode, staged add, duplicate
  guard, save/persist/restore, and mobile no-overflow behavior.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, 46
  blockers.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 371 entries.
- `pnpm deploy:evidence:source:plan:write`: pass, `Source evidence current:
  yes`, six active cleanup waves.

### Remaining Launch Risks

- This improves the workflow and closes another false-green provider evidence
  path. It does not certify deployment. Release remains blocked by 371 dirty
  source entries, missing real Apollo/Seamless/named Tech Intel evidence,
  missing real security-owner and platform/ops approvals, stale/local load
  evidence, non-local Sentry/browser evidence, and real Clerk-backed staging
  proof.

## 2026-06-18 Follow-Up 106: Integration Token Key Boot Gate

### Trigger

The P0 source-review wave included shared token crypto, API environment
validation, and secret-rotation scripts. The runtime cipher expected a 64-char
hex `INTEGRATION_TOKEN_KEY`, while production boot validation only checked that
some value existed and the rotation script generated base64.

### Issues Fixed

- `packages/shared/src/crypto/token-cipher.ts` now rejects non-hex
  64-character keys before attempting AES-256-GCM encryption/decryption.
- `apps/api/src/env.ts` now rejects malformed `INTEGRATION_TOKEN_KEY` values in
  production during boot validation.
- `.env.example` and `scripts/ops/rotate-secrets.sh` now tell operators to use
  `openssl rand -hex 32`, matching `docs/RUNBOOK.md`.
- Added focused shared tests for encrypted token round-trip, nondeterministic
  ciphertext, missing key, non-hex 64-character key, and malformed ciphertext.

### Implementation Map

- `packages/shared/src/crypto/token-cipher.ts`
- `packages/shared/src/crypto/token-cipher.test.ts`
- `apps/api/src/env.ts`
- `apps/api/src/env.test.ts`
- `.env.example`
- `scripts/ops/rotate-secrets.sh`
- `docs/solutions/agent-provider-credentials-org-secret-routing.md`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/shared test -- src/crypto/token-cipher.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/api test -- src/env.test.ts --reporter=dot`: 5/5
  pass.
- `pnpm --filter @bidstack/shared exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- Targeted shared/API ESLint: pass.
- `bash -n scripts/ops/rotate-secrets.sh scripts/ops/deploy-checklist.sh scripts/check-secrets.sh`:
  pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api build`: pass.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 374 entries.
- `pnpm deploy:evidence:source:plan:write`: pass, `Source evidence current:
  yes`, six active cleanup waves.
- `pnpm deploy:evidence:preflight:production`: expected block, exit `1`, 46
  blockers.
- `pnpm deploy:evidence:production`: expected block, exit `1`, 20 failures.

### Remaining Launch Risks

- This closes one production-secret misconfiguration path. It does not certify
  deployment. Release remains blocked by 374 dirty source entries, missing real
  Apollo/Seamless/named Tech Intel evidence, missing real security-owner and
  platform/ops approvals, stale/local load evidence, non-local Sentry/browser
  evidence, and real Clerk-backed staging proof.

## 2026-06-18 Follow-Up 107: Service Worker and Nginx Cache Hardening

### Trigger

The user-reported "leave the page open, then need to logout/login" class was
partly addressed at the React Query/auth-cache layer, but the production PWA
edge still allowed stale app-shell behavior: the worker policy only bypassed
`/api/` and `/trpc/`, and nginx did not explicitly no-store `/sw.js` or
`index.html`.

### Issues Fixed

- Service worker cache name bumped to `bidstack-v4-network-owned-routes`.
- Service worker now treats API, auth, OAuth, tRPC, Dust webhook, export, and
  download paths as network-owned and does not call `respondWith` for them.
- The same policy purges matching cache entries on activation.
- Nginx now serves `/`, `/index.html`, `/manifest.json`, and `/sw.js` with
  `Cache-Control: no-cache, no-store, must-revalidate`.
- Nginx immutable asset cache headers now redeclare security headers so
  `add_header` inheritance cannot strip them from cached asset responses.

### Implementation Map

- `apps/web/public/sw.js`
- `apps/web/src/main.tsx`
- `apps/web/e2e/flows/pwa-offline.spec.ts`
- `apps/web/nginx.conf`
- `apps/web/src/lib/service-worker-policy.test.ts`
- `apps/web/src/lib/nginx-cache-policy.test.ts`
- `docs/solutions/service-worker-api-bypass-and-streaming-cors.md`
- `docs/solutions/browser-http-cache-and-api-freshness.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/lib/service-worker-policy.test.ts src/lib/nginx-cache-policy.test.ts --reporter=dot`:
  5/5 pass.
- Targeted web ESLint for touched worker/cache files: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `docker run --rm -v <nginx.conf>:/etc/nginx/conf.d/default.conf:ro nginxinc/nginx-unprivileged:alpine nginx -t`:
  pass.
- `pnpm --filter @bidstack/web build`: pass.
- `E2E_PORT_OFFSET=142 pnpm --filter @bidstack/web e2e -- e2e/flows/pwa-offline.spec.ts --project=chromium-desktop`:
  3/3 pass.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 377 entries.

### Remaining Launch Risks

- This reduces stale-tab/app-shell risk. It does not certify deployment.
  Release remains blocked by dirty source, missing live provider evidence,
  real security-owner/platform ops approvals, stale/local load evidence,
  non-local Sentry/browser evidence, and real Clerk-backed staging proof.

## 2026-06-18 Follow-Up 108: Source Review Packets + Exact Counts

### Trigger

Continuing the 100k-company deployment-readiness goal, the current source gate
is still the largest local blocker: `pnpm deploy:evidence:source` reports 377
dirty source entries. The cleanup plan had exact files inside JSON, but the
operator path was still too manual for a large review and the wave totals could
double-count files that matched both a path group and a risk bucket.

### Issues Fixed

- `scripts/write-source-review-plan.mjs` now writes per-wave human review
  packets beside the JSON plan:
  `deploy-evidence/source-review-plan-latest-packets/INDEX.md`.
- Each active wave gets an exact `.paths.txt` file and a `.review.md` checklist
  with counts, notes, verification commands, and file-by-file review boxes.
- `reviewWaves[].reviewPacket` and top-level `reviewPackets` now link the JSON
  plan to the packet files.
- Wave counts now come from the de-duplicated exact file manifest, preventing
  bucket/path-group overlap from inflating counts.

### Verification

- `node --check scripts/write-source-review-plan.mjs`: pass.
- `pnpm deploy:evidence:source:plan:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-source-review-plan.mjs`:
  pass.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 377 entries.
- `pnpm deploy:evidence:source:plan:write`: pass, `Source evidence current:
  yes`, wrote review packets, and reported exact wave counts:
  release-critical 25, security/access 52, runtime 151, frontend 150,
  docs 42, uncategorized 28.
- Packet spot check:
  `deploy-evidence/source-review-plan-latest-packets/p0-security-access.review.md`
  lists exact files and the security/access verification commands.

### Remaining Launch Risks

- This makes the dirty-source cleanup path more reviewable. It does not clean,
  stage, approve, or certify the 377 source entries. Full launch still requires
  a clean reviewed worktree plus live provider, Sentry, browser, load, Clerk
  staging auth, secret-history disposition, and platform/security approval
  evidence. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 109: Standalone Worker Runtime Parity

### Trigger

The P0 release-critical source review packet includes `apps/worker/Dockerfile`.
That file claimed to mirror the root worker target, but still had deploy-path
drift: stale pnpm version, root runtime, and no container healthcheck. A
worker-only hosting path cannot be weaker than the root production worker image.

### Issues Fixed

- `apps/worker/Dockerfile` now uses the workspace-pinned `pnpm@10.27.0`.
- The standalone runtime creates and uses the non-root `bidstack` user.
- Runtime copy now uses `COPY --chown=bidstack:bidstack --from=builder /app ./`.
- Runtime package-manager/Corepack/npm/pnpm/yarn shims are pruned after copy.
- The standalone worker image now has a Docker healthcheck for
  `http://localhost:4002/health`.
- Added `apps/worker/src/lib/worker-dockerfile-policy.test.ts` to guard these
  invariants.

### Verification

- `pnpm --filter @bidstack/worker test -- src/lib/worker-dockerfile-policy.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/worker exec eslint --no-ignore --no-warn-ignored Dockerfile src/lib/worker-dockerfile-policy.test.ts`:
  pass.
- `pnpm --filter @bidstack/worker exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- `docker build --check -f apps/worker/Dockerfile .`: pass, no warnings.
- `docker build --target runtime -f apps/worker/Dockerfile -t bidcrm-worker:standalone-runtime-policy .`:
  pass.
- `docker image inspect bidcrm-worker:standalone-runtime-policy --format '{{json .Config.User}} {{json .Config.Healthcheck}}'`:
  `User="bidstack"` and the healthcheck is present.
- Runtime probe inside the image proved `uid=100(bidstack)`, Node `v24.17.0`,
  OCRmyPDF `16.11.1`, Tesseract languages `eng` and `osd`, and package-manager
  shims pruned.
- `BIDSTACK_CONTAINER_SCAN_IMAGES=bidcrm-worker:standalone-runtime-policy pnpm container:scan`:
  pass, `CRITICAL:0 HIGH:0`.

### Remaining Launch Risks

- This hardens one standalone worker deploy artifact. It does not close the
  full P0 release-critical packet or certify the platform. Full launch still
  needs clean source, live provider/Sentry/browser/load/Clerk staging evidence,
  secret-history disposition, and platform/security approval. Still not
  Salesforce/100k certified.

## 2026-06-18 Follow-Up 110: Azure Integration Token Key Policy

### Trigger

The runtime and rotation path now require `INTEGRATION_TOKEN_KEY` as a
64-character hex AES-256-GCM key, but the Azure draft still described the
`integrationTokenKey` parameter as base64. That operator hint could create a
production-only OAuth/Dust credential failure even though local app validation
was hardened.

### Issues Fixed

- `infra/azure/main.bicep` now length-gates `integrationTokenKey` with
  `@minLength(64)` and `@maxLength(64)`.
- The Bicep parameter description now tells operators to generate the key with
  `openssl rand -hex 32` and no longer calls it base64.
- `infra/azure/README.md` now documents the same generation command before the
  first deploy example and adds the Azure policy verifier to the validation
  checklist.
- Added `scripts/verify-azure-infra-policy.mjs` with poisoned selftests for
  missing length decorators, stale base64 wording, and missing container env
  wiring.
- `pnpm deploy:evidence:azure:policy` and
  `pnpm deploy:evidence:azure:policy:selftest` are now first-class release
  scripts.
- Release tool readiness now requires `scripts/verify-azure-infra-policy.mjs`
  to exist.

### Implementation Map

- `infra/azure/main.bicep`
- `infra/azure/README.md`
- `scripts/verify-azure-infra-policy.mjs`
- `scripts/write-release-tool-readiness.mjs`
- `package.json`
- `docs/solutions/agent-provider-credentials-org-secret-routing.md`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/verify-azure-infra-policy.mjs`: pass.
- `pnpm deploy:evidence:azure:policy:selftest`: pass.
- `pnpm deploy:evidence:azure:policy`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-azure-infra-policy.mjs`:
  pass.
- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-azure-infra-policy.mjs scripts/write-release-tool-readiness.mjs`:
  pass.
- `pnpm deploy:evidence:tools`: pass, 27 required checks and zero blockers.
- `az bicep version`: not run; Azure CLI is not installed on this machine.
- `pnpm deploy:evidence:source`: expected block, exit `1`, refreshed current
  dirty-source evidence with 379 entries.
- `pnpm deploy:evidence:source:plan:write`: pass, `Source evidence current:
  yes`, six active cleanup waves. Exact counts: release-critical 25,
  security/access 54, runtime 152, frontend UX 150, docs 42, uncategorized 28.

### Remaining Launch Risks

- This closes one Azure operator footgun. It does not validate the full Azure
  draft. `az bicep build`, `az deployment group what-if`, private networking,
  live provider evidence, Sentry/browser/load evidence, Clerk staging proof,
  secret-history disposition, and platform/security approval remain required.

## 2026-06-18 Follow-Up 111: Technical Stack Guided Add UX + Cockpit Geometry

### Trigger

Tony called out that adding tech stack items in Technical Stack Overview still
felt weaker than the rest of the account experience, and that Apollo,
Seamless, and other valid sources must be pulled through MCP/provider lanes
without overstating source truth.

### Issues Fixed

- Manual, quick-suggestion, single-provider, and visible bulk-provider add
  paths now show a `Recently staged stack entries` tray before save.
- The staged tray names the newly added technology and source/category so the
  user gets instant proof that the add worked.
- Quick suggestions now search the active comma/newline token, so a pasted
  list such as `Salesforce, tab` can still surface `Tableau`.
- The cockpit add form now stacks full-width controls in the real narrow card
  column. Browser QA caught the old desktop textarea at about 22px wide inside
  the account cockpit despite page-level no-overflow checks passing.
- Provider source truth is unchanged and explicit: Apollo is queued through
  MCP/API, Seamless is MCP-first with API fallback, Tech Intel aggregates named
  configured MCP sources, and open data remains a separate lane.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx`:
  22/22 pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts`:
  5/5 pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-seamless-enrichment.test.ts`:
  4/4 pass.
- `pnpm --filter @bidstack/api test -- src/routes/crm/companies.test.ts`:
  17/17 pass.
- `$env:E2E_PORT_OFFSET='153'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA verified the Technical Stack source lanes, provider pull
  workbench, staged feedback tray, active-token suggestion flow, desktop
  cockpit geometry, and 390px mobile no-overflow behavior.

### Remaining Launch Risks

- This upgrades one high-value account cockpit workflow. It does not certify
  live provider credentials, production MCP availability, dirty-source review,
  Sentry/browser/load evidence, Clerk staging auth, secret-history disposition,
  or platform/security approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 112: Technical Stack Source Readiness Map

### Trigger

Tony asked for the Technical Stack Overview add experience to feel better and
for Apollo, Seamless, and other valid MCP/provider sources to pull stack data
without ambiguity. The previous pass improved staging feedback, but the editor
still made users infer too much from compact provider chips.

### Issues Fixed

- The edit-mode provider panel now shows a `Source readiness map` for Apollo,
  Seamless.AI, Tech Intel MCPs, and open data.
- Each row exposes the provider label, transport posture, provider status, and
  next action: examples include `MCP first`, `API fallback`, `MCP required`,
  `Valid open data`, `Polling`, `Review N`, `Connect`, and `No new deltas`.
- Rows with reviewable provider suggestions focus the same source queue filter
  as the provider lane chips. Rows without reviewable deltas stay non-destructive
  but still communicate readiness.
- The focused Playwright flow now asserts the source readiness map and open-data
  validity, not only the broader add/save flow.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`:
  pass.
- `$env:E2E_PORT_OFFSET='163'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass. The run rebuilt `@bidstack/shared`, built the production web
  bundle, launched API on `http://127.0.0.1:4173`, and exercised the real
  account cockpit in Chromium.

### Remaining Launch Risks

- This improves source trust and add UX for one account cockpit workflow. It
  does not prove live production credentials for Apollo, Seamless, or every
  named Tech Intel MCP source. Full launch still needs clean source review,
  live provider evidence, Sentry/browser/load evidence, Clerk staging proof,
  secret-history disposition, and platform/security approval. Still not
  Salesforce/100k certified.

## 2026-06-18 Follow-Up 113: Technical Stack Observability Cleanup

### Trigger

The Technical Stack E2E passed functionally, but prior runs showed API noise
around aborted dashboard refetches (`premature close`). A later verification run
also surfaced realtime Redis timeout logs even though the tested flow was
HTTP-only.

### Issues Fixed

- Expected client disconnects are now classified centrally before the Fastify
  error handler treats them as server failures.
- Sentry capture now ignores expected client-abort signatures as a second guard.
- Dashboard route catches no longer log expected aborts or normal 4xx responses
  at error level.
- Realtime pub/sub and presence Redis clients now lazy-connect, so HTTP-only QA
  and API startup do not emit realtime Redis errors unless realtime is actually
  invoked.

### Implementation Map

- `apps/api/src/lib/http-client-abort.ts`
- `apps/api/src/lib/http-client-abort.test.ts`
- `apps/api/src/plugins/error-handler.ts`
- `apps/api/src/plugins/sentry.ts`
- `apps/api/src/plugins/sentry-context.test.ts`
- `apps/api/src/routes/crm/dashboard.ts`
- `apps/api/src/services/realtime.service.ts`
- `apps/api/src/services/presence.service.ts`
- `docs/solutions/client-abort-and-realtime-observability.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/api exec vitest run src/lib/http-client-abort.test.ts src/plugins/sentry-context.test.ts src/routes/crm/dashboard.test.ts`:
  12/12 pass.
- `pnpm --filter @bidstack/api exec vitest run src/plugins/realtime.validateChannel.test.ts src/lib/http-client-abort.test.ts src/plugins/sentry-context.test.ts src/routes/crm/dashboard.test.ts`:
  18/18 pass.
- `pnpm --filter @bidstack/api exec eslint src/services/realtime.service.ts src/services/presence.service.ts src/plugins/realtime.ts src/plugins/realtime.validateChannel.test.ts src/lib/http-client-abort.ts src/lib/http-client-abort.test.ts src/plugins/error-handler.ts src/plugins/sentry.ts src/plugins/sentry-context.test.ts src/routes/crm/dashboard.ts`:
  pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- From `apps/web`, `$env:E2E_PORT_OFFSET='178'; pnpm exec playwright test e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass. The managed API startup no longer emits realtime Redis timeout
  errors, and the technical-stack source pull/manual add flow remains green.

### Remaining Launch Risks

- This closes one observability-noise gap in the account/technical-stack path.
  It does not prove live Apollo/Seamless/MCP credentials, production Redis HA,
  full browser matrix, load evidence, Sentry staging smoke, Clerk staging auth,
  dirty-source disposition, or platform/security approval. Still not
  Salesforce/100k certified.

## 2026-06-18 Follow-Up 114: Auth + Mail PII-Safe Logs

### Trigger

The P0 security/access review scan found auth-policy and integration-success
logs that could write email identifiers into general Pino output. This violates
the company-scale observability contract already established for Sentry.

### Issues Fixed

- SSO domain rejection no longer logs the full rejected email address.
- SSO domain rejection no longer returns the configured allowlist to rejected
  callers.
- Verified-token auth policy failures now remain proper 403 application errors
  instead of being wrapped as generic Clerk-token verification failures.
- Gmail and Outlook connection logs now report `externalAccountDomain` instead
  of the external mailbox address.

### Implementation Map

- `apps/api/src/lib/email-privacy.ts`
- `apps/api/src/lib/email-privacy.test.ts`
- `apps/api/src/plugins/auth.ts`
- `apps/api/src/plugins/auth.test.ts`
- `apps/api/src/routes/integrations/gmail.ts`
- `apps/api/src/routes/integrations/microsoft-mail.ts`
- `docs/solutions/auth-integration-pii-safe-observability.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/api exec vitest run src/lib/email-privacy.test.ts src/plugins/auth.test.ts`:
  10/10 pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/user-groups.integration.test.ts src/routes/users.roles.integration.test.ts --reporter=dot`:
  11/11 pass.
- `pnpm --filter @bidstack/api exec eslint src/lib/email-privacy.ts src/lib/email-privacy.test.ts src/plugins/auth.ts src/plugins/auth.test.ts src/routes/integrations/gmail.ts src/routes/integrations/microsoft-mail.ts`:
  pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `rg -n "server\\.log\\.info\\(\\{ orgId, userId, email: externalEmail \\}|req\\.log\\.warn\\(\\{ email|Sign-in from @|Allowed domains:" apps/api/src/plugins/auth.ts apps/api/src/routes/integrations/gmail.ts apps/api/src/routes/integrations/microsoft-mail.ts`:
  no matches.
- `pnpm deploy:evidence:source`: expected-blocked, 385 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed packets with
  P0 security/access at 55 files.

### Remaining Launch Risks

- This removes one PII-log class in auth and mail integrations. It does not
  prove complete log PII coverage across every CRM export, worker queue, or
  third-party integration. Full launch still needs clean source review, live
  provider evidence, production Redis HA evidence, full browser/load/Sentry/
  Clerk staging proof, secret-history disposition, and platform/security
  approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 115: Technical Stack Source Workbench Intake

### Trigger

Tony asked for the Technical Stack Overview add experience to feel more
premium and to make sure MCP/provider sources such as Apollo, Seamless, and
other valid sources are pulled into the workflow.

### Issues Fixed

- `Pull sources` now opens the full source-assisted stack workbench immediately
  after a successful provider refresh instead of leaving the user in read-only
  mode and requiring a second edit click.
- Provider-style CSV/TSV exports now parse structured headers such as
  `technology,category,source`; headers and source columns are not staged as
  vendors.
- Freeform fast paste still supports comma/newline entries plus category hints
  such as `Security: Okta, CrowdStrike` and `Data - Databricks`.
- The focused browser E2E now asserts that source pull reveals the source
  readiness map and import controls directly.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- TechStackCard.test.tsx`: 23/23 pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/api test -- company-tech-stack-mcp.test.ts company-seamless-enrichment.test.ts companies.test.ts`:
  27/27 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_PORT_OFFSET='191'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  verified desktop and mobile source pull, workbench entry, source readiness
  map, structured source-export intake, 44px controls, no horizontal overflow,
  and empty console errors.

### Remaining Launch Risks

- This improves one account-cockpit source intake workflow. It does not prove
  live production credentials or source quality for Apollo, Seamless, every
  named Tech Intel MCP, or every open-data enrichment. Full launch still needs
  clean source review, live provider evidence, browser matrix, load/Sentry/
  Clerk staging proof, secret-history disposition, and platform/security
  approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 116: Scoped Users Cannot Mutate Global Top Accounts

### Trigger

The P0 security/access source packet still included account access and RBAC
surfaces. Review found that global top-account curation validated companies by
organization only, while user-group scoping can intentionally restrict which
accounts a writer can see.

### Issues Fixed

- `PUT /api/v1/accounts/top-list` now requires an unrestricted account scope
  before any global rank clearing or curation update can run.
- Group-scoped users with `accounts:write` now receive `403` for global
  curation instead of being allowed to replace the org-wide top-account list.
- Regression coverage proves the denied request leaves the fixture company
  ranks unchanged.

### Implementation Map

- `apps/api/src/routes/accounts.ts`
- `apps/api/src/routes/user-groups.integration.test.ts`
- `docs/solutions/account-access-scope-and-dev-proxy-verification.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/api test -- src/routes/user-groups.integration.test.ts --reporter=dot`:
  6/6 pass.
- `pnpm --filter @bidstack/api test -- src/routes/accounts.integration.test.ts --reporter=dot`:
  9/9 pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/accounts.ts src/routes/user-groups.integration.test.ts`:
  pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm deploy:evidence:source`: expected-blocked, 388 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed packets with P0
  security/access still at 56 files.

### Remaining Launch Risks

- This closes one global account-curation mutation gap. It does not prove full
  P0 source review, live provider evidence, production Redis HA, full
  browser/load/Sentry/Clerk staging proof, secret-history disposition, or
  platform/security approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 117: Production Public Origin HTTPS Gate

### Trigger

The P0 security/access packet still included CORS and production boot surfaces.
Review found that production env validation rejected literal `localhost` in
`PUBLIC_BASE_URL`, but it still accepted an insecure public web origin such as
`http://crm.example.com`.

### Issues Fixed

- Production API boot now rejects `PUBLIC_BASE_URL` unless it uses `https:`.
- Production API boot now rejects loopback public origins including
  `localhost`, `127.x.x.x`, and `::1`.
- Development and test CORS behavior still allows local loopback variants for
  shifted Vite/preview ports.

### Implementation Map

- `apps/api/src/env.ts`
- `apps/api/src/env.test.ts`
- `apps/api/src/lib/cors-origins.ts`
- `apps/api/src/lib/cors-origins.test.ts`
- `docs/solutions/service-worker-api-bypass-and-streaming-cors.md`
- `MISTAKES.md`

### Verification

- First TDD run proved the gap:
  `pnpm --filter @bidstack/api test -- src/env.test.ts --reporter=dot`
  failed because `http://crm.example.com` was accepted in production.
- `pnpm --filter @bidstack/api test -- src/env.test.ts --reporter=dot`:
  6/6 pass.
- `pnpm --filter @bidstack/api test -- src/lib/cors-origins.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/api exec eslint src/env.ts src/env.test.ts src/lib/cors-origins.ts src/lib/cors-origins.test.ts`:
  pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm deploy:evidence:source`: expected-blocked, 388 dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed packets with P0
  security/access still at 56 files.

### Remaining Launch Risks

- This closes one production-origin misconfiguration path. It does not prove
  full P0 source review, live provider evidence, production Redis HA, full
  browser/load/Sentry/Clerk staging proof, secret-history disposition, or
  platform/security approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 118: Technical Stack Provider Review Scorecards

### Trigger

Tony asked for the Technical Stack Overview add experience to feel materially
better and for MCP/provider pulls such as Apollo, Seamless, and other valid
sources to be obvious in the workflow.

### Issues Fixed

- The source review queue now shows provider scorecards with count, average
  confidence, and top vendor for each pending source lane.
- Clicking a scorecard filters the source inbox to that provider, matching the
  existing Apollo/Seamless/Tech Intel tab and readiness-map behavior.
- Bulk accept now applies to the full active provider/source filter instead of
  only the visible eight-card grid.
- Overflow copy now explains that the visible grid is a preview while bulk
  acceptance stages the full current source filter.
- Source truth remains honest: Apollo is MCP-first when fully configured and
  otherwise queues through API; Seamless is MCP-first with API fallback; Tech
  Intel aggregates configured named MCP sources; open data remains separate.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  23/23 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  34/34 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `$env:E2E_PORT_OFFSET='246'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  passed desktop and 390px mobile: workbench present, source readiness map
  present, no horizontal overflow, no region overflow, and measured Technical
  Stack buttons all at least 44px.

### Remaining Launch Risks

- Local proof still has Apollo, Seamless, and Tech Intel credentials absent, so
  live provider quality remains unproven. Production readiness still needs live
  Apollo/Seamless/named Tech Intel MCP evidence, browser matrix, load/Sentry/
  Clerk staging proof, secret-history disposition, clean source review, and
  platform/security approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 119: Sentry Request Context Scope Guard

### Trigger

The P0 security/access packet still included Sentry and telemetry files. Review
found that the API Sentry plugin registered request hooks as an encapsulated
Fastify plugin and that API/browser `orgId` tags were only set when a user/org
was present.

### Issues Fixed

- API Sentry request hooks are now wrapped with `fastify-plugin`, so the
  request context and cleanup hooks apply to sibling routes registered after the
  plugin.
- API Sentry auth scope now sets `orgId=unauthenticated` when auth is absent.
- API response cleanup now clears both the pseudonymous user and the tenant tag.
- Browser Sentry logout/anonymous context now also sets
  `orgId=unauthenticated`, preventing stale tenant attribution after sign-out.

### Implementation Map

- `apps/api/src/plugins/sentry.ts`
- `apps/api/src/plugins/sentry-context.test.ts`
- `apps/web/src/lib/sentry.ts`
- `apps/web/src/lib/sentry.test.ts`
- `docs/solutions/sentry-pii-safe-observability.md`
- `MISTAKES.md`

### Verification

- Initial API hook lifecycle test failed before the `fastify-plugin` wrap,
  proving the encapsulation gap.
- `pnpm --filter @bidstack/api exec vitest run src/plugins/sentry.test.ts src/plugins/sentry-context.test.ts --reporter=dot`:
  13/13 pass.
- `pnpm --filter @bidstack/web exec vitest run src/lib/sentry.test.ts --reporter=dot`:
  6/6 pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/plugins/sentry.ts src/plugins/sentry-context.test.ts src/plugins/sentry.test.ts src/lib/sentry-privacy.ts`:
  pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/lib/sentry.ts src/lib/sentry.test.ts`:
  pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.

### Remaining Launch Risks

- This closes one telemetry-context isolation gap. It does not prove live
  Sentry ingestion, worker smoke observation, clean source review, live provider
  evidence, browser/load/Clerk staging proof, secret-history disposition, or
  platform/security approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 120: Production Demo Mode Requires Explicit Public Acknowledgement

### Trigger

The P0 security/access review found that production could boot the public
passwordless demo door with `DEMO_MODE=true` and `DEMO_SESSION_SECRET`, but
without a second operator acknowledgement that this was intentionally public
demo infrastructure.

### Issues Fixed

- Added `DEMO_PUBLIC_DEPLOYMENT_ACK=false` to the API env schema and sample env.
- Production now fails boot when `DEMO_MODE=true` unless
  `DEMO_PUBLIC_DEPLOYMENT_ACK=true`.
- Existing safeguards remain: demo mode is still mutually exclusive with Clerk
  and still requires `DEMO_SESSION_SECRET`.

### Implementation Map

- `apps/api/src/env.ts`
- `apps/api/src/env.test.ts`
- `.env.example`
- `docs/solutions/public-demo-mode-production-ack.md`
- `MISTAKES.md`

### Verification

- Initial regression failed because production demo mode resolved instead of
  rejecting without the acknowledgement.
- `pnpm --filter @bidstack/api exec vitest run src/env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/env.ts src/env.test.ts`:
  pass.
- `git diff --check -- .env.example apps/api/src/env.ts apps/api/src/env.test.ts`:
  pass with LF/CRLF warnings only.

### Remaining Launch Risks

- This closes one demo-auth misconfiguration path. Full launch still needs
  clean source review, Clerk staging proof, live provider evidence, browser/load
  evidence, Sentry proof, secret-history disposition, and platform/security
  approval. Still not Salesforce/100k certified.

## 2026-06-18 Follow-Up 121: Technical Stack Review-Ready Source Lanes

### Trigger

Tony asked again for the Technical Stack Overview add experience to be better
and for Apollo, Seamless, and valid MCP sources to be pulled and represented
clearly.

### Issues Fixed

- Existing provider suggestions now make their provider lanes review-ready even
  when the current refresh response is not present in component state.
- Apollo and Seamless review-ready lanes show `MCP/API pull`; Tech Intel shows
  `MCP first`, preserving the truth that exact historical transport is not
  stored in the component state.
- The manual vendor textarea supports Ctrl+Enter / Cmd+Enter staging while the
  visible Stage button remains available.
- Source pull truth remains unchanged: Apollo queues through MCP/API,
  Seamless prefers MCP with API fallback, Tech Intel aggregates named MCP
  sources, and open data remains separate.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  24/24 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `$env:E2E_PORT_OFFSET='309'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  passed: desktop source map visible after source pull, open data synced while
  unconfigured paid/MCP lanes stayed honest, measured controls at 44px,
  vendor input 279px desktop / 269px mobile, no horizontal overflow, 390px
  mobile source map visible, and console errors empty.

### Remaining Launch Risks

- Local credentials for Apollo, Seamless, and named Tech Intel MCPs are absent,
  so live provider quality remains unproven. Full launch still needs live
  provider evidence, full browser matrix, load/Sentry/Clerk staging proof,
  secret-history disposition, clean source review, and platform/security
  approval. Still not Salesforce/100k certified.

## 2026-06-19 Follow-Up 122: Technical Stack Inline Source-Backed Add

### Trigger

Tony asked again that adding tech stack entries in Technical Stack Overview feel
better and that Apollo, Seamless, and valid MCP sources are pulled into the
experience.

### Issues Fixed

- The add composer now promotes provider-backed matches while the user types.
  Pending Apollo, Seamless, Tech Intel MCP, or other valid-source suggestions
  appear inline as source-backed chips instead of living only in the review
  queue.
- Accepting an inline match preserves provider provenance with
  `manual:accepted:<provider-source>`, matching the source review queue.
- The inline match row stays hidden when no provider suggestions exist, keeping
  not-configured local environments honest.
- Mobile QA found and fixed a visual collision between `Curated stack` and
  `Saved as internal verified data`.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- Initial component regression failed because the composer had no
  `Provider-backed technology matches` surface.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  25/25 pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `$env:E2E_PORT_OFFSET='323'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass after the CSS polish.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  passed desktop and 390px mobile: edit mode opens, source readiness map is
  present, manual add preview works, visible Technical Stack controls are 44px
  or larger, horizontal overflow is 0, console errors are empty, and the mobile
  curated-stack header no longer collides. The live local seed had no pending
  Apollo/Seamless/Tech Intel suggestions, so inline provider-match behavior is
  proven by component tests, not live provider data.

### Remaining Launch Risks

- Local credentials for Apollo, Seamless, and named Tech Intel MCPs are absent,
  so live provider quality remains unproven. Full launch still needs live
  provider evidence, full browser matrix, load/Sentry/Clerk staging proof,
  secret-history disposition, clean source review, and platform/security
  approval. Still not Salesforce/100k certified.

## 2026-06-19 Follow-Up 123: Auth Role and Security Cache Boundaries

### Trigger

Tony reported that after staying on a page for a while he needed to logout and
log back in, likely because cache/auth recovery was stale. The prior idle-auth
fix covered forced token refresh and tenant switches, but auth/admin/provider
control-plane snapshots could still persist like ordinary dashboard data.

### Issues Fixed

- Clerk cache identity markers now include active org role:
  `userId:orgId:orgRole`.
- Stub-mode cache fingerprints include `bidstack:stub-role`, so role changes
  clear the live query client without requiring a logout/login cycle.
- React Query persistence now refuses auth/admin/security/provider query
  prefixes such as `me`, `roles`, `permissions`, `users`, `user-roles`,
  `api-keys`, `agent-provider-credentials`, Dust credential/status queries,
  CRM connector health, integration setup, and webhooks.
- The idle-auth E2E fixture was brought back in sync with the current SERUM
  page contract by including `signalHealth`.

### Implementation Map

- `apps/web/src/lib/queryCache.ts`
- `apps/web/src/lib/queryCache.test.ts`
- `apps/web/src/lib/auth.tsx`
- `apps/web/src/lib/auth.test.tsx`
- `apps/web/e2e/flows/idle-auth-recovery.spec.ts`
- `docs/solutions/idle-auth-refresh-and-focus-refetch.md`
- `MISTAKES.md`

### Verification

- Initial regressions failed:
  - `pnpm --filter @bidstack/web test -- src/lib/queryCache.test.ts --reporter=dot`
    failed because sensitive snapshots hydrated and stub-role changes did not
    clear the query client.
  - `pnpm --filter @bidstack/web test -- src/lib/auth.test.tsx --reporter=dot`
    failed because Clerk markers omitted role.
- `pnpm --filter @bidstack/web test -- src/lib/queryCache.test.ts --reporter=dot`:
  8/8 pass.
- `pnpm --filter @bidstack/web test -- src/lib/auth.test.tsx --reporter=dot`:
  9/9 pass.
- `pnpm --filter @bidstack/web exec eslint src/lib/auth.tsx src/lib/auth.test.tsx src/lib/queryCache.ts src/lib/queryCache.test.ts e2e/flows/idle-auth-recovery.spec.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- First E2E attempt with default ports failed before test start because
  `http://127.0.0.1:4010/health` was already in use.
- E2E rerun with `E2E_PORT_OFFSET=441` reached the browser but failed because
  the SERUM test fixture lacked `signalHealth` and the page error boundary
  rendered.
- `$env:E2E_AUTH_MODE='demo'; $env:E2E_PORT_OFFSET='462'; pnpm --filter @bidstack/web e2e -- e2e/flows/idle-auth-recovery.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Remaining Launch Risks

- This closes another cache/logout-login class for auth, role, and provider
  control state. Full launch still needs clean source review, Clerk staging
  proof, live provider evidence, full browser matrix, load/Sentry evidence,
  secret-history disposition, and platform/security approval. Still not
  Salesforce/100k certified.

## 2026-06-19 Follow-Up 124: Technical Stack Safe Provider Pull

### Trigger

Tony asked for the Technical Stack Overview add experience to keep improving and
for MCP/source pulls such as Apollo, Seamless, and valid Tech Intel sources to
work reliably inside the workflow.

### Issues Fixed

- Pulling sources while already editing no longer replaces the active draft.
  Unsaved manual stack additions stay in place while the provider readiness map
  refreshes.
- Pulling sources before editing still opens the workbench with the refreshed
  effective stack.
- Single Tech Intel MCP provider metadata now preserves the named source in item
  provenance, for example `enrichment:tech_stack_mcp:builtwith_mcp`, instead of
  collapsing to generic `enrichment:tech_stack_mcp`.
- Apollo, Seamless, Tech Intel MCP, and open-data source lanes still report
  honest configured/not-configured/synced status. This patch did not fake live
  provider evidence where local credentials are absent.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/api/src/services/crm/company-enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.test.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- Initial web regression failed because an in-editor source pull erased the
  unsaved `QA` draft entry.
- Initial API regression failed because a single `BuiltWith MCP` profile emitted
  generic Tech Intel provenance.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/api test -- src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  5/5 pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts --reporter=dot`:
  9/9 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/api exec eslint src/services/crm/company-enrichment.service.ts src/services/crm/company-enrichment.service.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- First Playwright route attempt with `E2E_AUTH_MODE=demo` landed on the sign-in
  page before reaching the component.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='464'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA passed on
  `http://127.0.0.1:5173/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d`:
  manual draft staging survived in-editor source pull, provider readiness map
  stayed visible, and console errors were empty. Screenshot:
  `D:\BIDCRM\deploy-evidence\browser-screenshots\technical-stack-mid-edit-pull-preserves-draft-2026-06-19.png`.

### Remaining Launch Risks

- Local credentials for Apollo, Seamless, and named Tech Intel MCPs are absent,
  so live provider quality remains unproven. Full launch still needs live
  provider evidence, clean source/security review, browser matrix, load/Sentry
  and Clerk staging proof, secret-history disposition, and platform/security
  approval. Still not Salesforce/100k certified.

## 2026-06-19 Follow-Up 125: Modern Secret Scanner Coverage

### Trigger

The 100k-user deploy goal is still blocked by source/security review. The P0
release-critical packet includes secret/config gates, and an older audit note
still pointed at narrow secret regex coverage.

### Issues Fixed

- Local secret scanners now catch modern OpenAI project/service and Anthropic
  keys via widened `sk-[A-Za-z0-9_-]{20,}` coverage.
- GitHub fine-grained PATs, Slack tokens, Google API keys, and Azure Storage
  `AccountKey=` strings are now covered by local staged-diff, full-tree,
  edit-hook, release-evidence, deploy-checklist, and gitleaks custom rules.
- Redaction output in the shell scanner now masks the newly covered token
  families.
- The release evidence writer selftest has explicit modern-token fixtures so
  this coverage cannot silently regress.

### Implementation Map

- `.gitleaks.toml`
- `.claude/hooks/scan-secrets.sh`
- `scripts/check-secrets.sh`
- `scripts/write-secret-scan-evidence.mjs`
- `scripts/ops/deploy-checklist.sh`
- `docs/solutions/security-scan-local-gates.md`
- `MISTAKES.md`

### Verification

- `pnpm deploy:evidence:secrets:selftest`: pass.
- `bash -n scripts/check-secrets.sh scripts/ops/deploy-checklist.sh .claude/hooks/scan-secrets.sh`:
  pass.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- No-file fixture probes proved both `scripts/check-secrets.sh` and
  `scripts/ops/deploy-checklist.sh` match `sk-proj-*`, `sk-ant-*`,
  `github_pat_*`, Slack, Google, and Azure `AccountKey=` examples.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- Gitleaks Docker validation with `ghcr.io/gitleaks/gitleaks:v8.30.1` passed
  against the current commit using `.gitleaks.toml`; native `gitleaks` is not
  installed locally.
- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `pnpm exec eslint scripts/write-secret-scan-evidence.mjs --no-warn-ignored --max-warnings=0`:
  pass.
- `git diff --check -- scripts/check-secrets.sh scripts/ops/deploy-checklist.sh .claude/hooks/scan-secrets.sh scripts/write-secret-scan-evidence.mjs .gitleaks.toml`:
  pass with line-ending warnings only.
- `pnpm deploy:evidence:source` still fails as expected because the full
  worktree has 391 dirty entries. `pnpm deploy:evidence:source:plan:write`
  refreshed the active source-review packets.

### Remaining Launch Risks

- This hardens local secret detection but does not prove full release readiness.
  Full launch still needs clean source/security review, secret-history
  disposition, live provider evidence, browser matrix, load/Sentry and Clerk
  staging proof, and platform/security approval. Still not Salesforce/100k
  certified.

## 2026-06-19 Follow-Up 126: Technical Stack Source-Aware Stage UX

### Trigger

Tony flagged that adding technologies in Technical Stack Overview still felt too
manual, and asked that Apollo, Seamless, and other valid MCP sources pull stack
signals into the experience.

### Issues Fixed

- The Stage command now preserves source provenance for exact typed provider
  matches. Typing a pending Apollo/Seamless/Tech Intel MCP technology and
  pressing Stage stores it as `manual:accepted:<provider-source>`, matching the
  explicit source-review queue behavior.
- The intake summary exposes a source-match metric, so users can see when the
  add flow is backed by provider intelligence.
- The add preview names the provider source before staging, instead of only
  showing the inferred category.
- Existing provider pulls remain honest: Apollo queues through MCP/API,
  Seamless remains MCP-first with API fallback, Tech Intel aggregates named
  valid MCPs, and open data stays a distinct verification lane.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- New regression first failed because an exact typed Apollo match staged as
  manual-only data.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx -t "stages exact typed provider matches" --reporter=dot`:
  pass.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  27/27 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='507'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- Local browser smoke on `http://127.0.0.1:5382` with API
  `http://127.0.0.1:4212` returned console errors `[]`, desktop overflow `0`,
  no sub-44px Technical Stack buttons, and mobile overflow `0`.

### Remaining Launch Risks

- Local credentials for Apollo, Seamless, and named Tech Intel MCPs are absent,
  so live provider quality remains unproven. This is a UX/provenance fix, not
  full provider certification or Salesforce/100k release sign-off.

## 2026-06-19 Follow-Up 127: Server-Crypto Hex-Only Key Contract

### Trigger

The P0 release/security review still requires source-controlled proof that
secret boundaries fail closed. The token cipher, API env gate, rotation script,
and Azure policy had been aligned on `INTEGRATION_TOKEN_KEY` as 64-character
hex, but the exported `@bidstack/shared/server-crypto` helper still accepted
legacy base64 key material.

### Issues Fixed

- `@bidstack/shared/server-crypto` now rejects legacy base64
  `INTEGRATION_TOKEN_KEY` values.
- 64-character non-hex values are rejected at the crypto boundary, matching the
  production API boot validator.
- The at-rest secret cipher now passes the configured GCM authentication tag
  length explicitly on encrypt and decrypt.
- The local gitignored `packages/shared/dist` output was rebuilt so the running
  workspace matches source.

### Implementation Map

- `packages/shared/src/utils/crypto.ts`
- `packages/shared/src/utils/crypto.test.ts`
- `docs/solutions/agent-provider-credentials-org-secret-routing.md`
- `MISTAKES.md`

### Verification

- New regression first failed because a base64 32-byte key was still accepted.
- `pnpm --filter @bidstack/shared exec vitest run src/utils/crypto.test.ts -t "rejects legacy base64" --reporter=dot`:
  pass after the fix.
- `pnpm --filter @bidstack/shared exec vitest run src/utils/crypto.test.ts src/crypto/token-cipher.test.ts --reporter=dot`:
  8/8 pass.
- `pnpm --filter @bidstack/api exec vitest run src/env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/shared exec eslint src/utils/crypto.ts src/utils/crypto.test.ts src/crypto/token-cipher.ts src/crypto/token-cipher.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/shared exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.

### Remaining Launch Risks

- This closes one secret-boundary contract drift, but does not certify the full
  release. Full launch still needs clean source/security review, secret-history
  disposition, live provider evidence, browser matrix, load/Sentry and Clerk
  staging proof, and platform/security approval. Still not Salesforce/100k
  certified.

## 2026-06-19 Follow-Up 128: SERUM Status Audit Freshness

### Trigger

Tony's original SERUM complaint was a trust problem: the control plane looked
unavailable or stale and invited logout/login as a recovery path. While the
status route already failed soft for optional backend signal reads, its
`latestConfigChangeAt` summary ignored SERUM's own `serum_config.*` audit
events.

### Issues Fixed

- `GET /api/v1/serum/status` now treats SERUM draft, approval, publish, and
  rollback audit rows as relevant control-plane config changes.
- Mission Control and the Settings SERUM audit section can now show a fresh
  latest-change timestamp immediately after versioned SERUM config workflows.
- The regression proves the status endpoint stays `200` and returns a live
  timestamp after a draft/publish/rollback flow.

### Implementation Map

- `apps/api/src/routes/serum.ts`
- `apps/api/src/routes/serum.integration.test.ts`
- `docs/solutions/serum-versioned-config-control-plane.md`
- `MISTAKES.md`

### Verification

- New regression first failed with `latestConfigChangeAt: null` after
  `serum_config.*` audit rows were created.
- `pnpm --filter @bidstack/api exec vitest run src/routes/serum.integration.test.ts -t "persists versioned config drafts" --reporter=dot`:
  pass after the SQL fix.
- `pnpm --filter @bidstack/api exec vitest run src/routes/serum.integration.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/api exec eslint src/routes/serum.ts src/routes/serum.integration.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.

### Remaining Launch Risks

- This fixes one freshness bug in the SERUM control plane. It is not full
  100k-user certification. Full launch still needs clean source/security
  review, live provider evidence, browser matrix, load/Sentry and Clerk staging
  proof, secret-history disposition, and platform/security approval.

## 2026-06-19 Follow-Up 129: Integration Token Rotation Fail-Closed Guard

### Trigger

The P0 release/security review found that `scripts/ops/rotate-secrets.sh` could
generate and write a replacement `INTEGRATION_TOKEN_KEY` even though
`scripts/rotate-integration-tokens.ts` does not exist. Because stored provider
tokens decrypt only with the active key, that operator path could strand Apollo,
Seamless, Dust, HubSpot, Gmail, Microsoft Graph, and future MCP-backed
integrations after a restart.

### Issues Fixed

- `INTEGRATION_TOKEN_KEY` rotation now declares
  `TOKEN_ROTATION_SCRIPT="scripts/rotate-integration-tokens.ts"`.
- The script blocks the key replacement before generating `NEW_KEY` when the
  re-encryption tool is absent.
- Blocked rotations append an audit line to
  `docs/operations/secret-rotation.log`.
- The operator instructions no longer claim `pnpm db:migrate` includes token
  re-encryption.
- The post-rotation checklist separates JWT overlap cleanup from
  `INTEGRATION_TOKEN_KEY_PREV` cleanup, which is now allowed only after token
  re-encryption succeeds.
- A dedicated policy verifier with good and poisoned fixtures now guards this
  operator workflow.

### Implementation Map

- `scripts/ops/rotate-secrets.sh`
- `scripts/verify-secret-rotation-policy.mjs`
- `package.json`
- `docs/RUNBOOK.md`
- `docs/solutions/agent-provider-credentials-org-secret-routing.md`
- `MISTAKES.md`

### Verification

- `pnpm deploy:evidence:secret-rotation:policy`: pass.
- `pnpm deploy:evidence:secret-rotation:policy:selftest`: pass.
- `bash -n scripts/ops/rotate-secrets.sh`: pass.
- `node --check scripts/verify-secret-rotation-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-secret-rotation-policy.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `git diff --check -- scripts/ops/rotate-secrets.sh package.json`: pass with
  line-ending warnings only.
- `pnpm deploy:evidence:source`: expected release block; worktree has 395
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: refreshed six review waves with P0
  security/auth/access at 60 files.

### Remaining Launch Risks

- This closes one high-blast-radius operator footgun. It does not create the
  missing `scripts/rotate-integration-tokens.ts` implementation or certify live
  provider/token migration safety.
- Full launch still needs clean source/security review, secret-history
  disposition, live Apollo/Seamless/named Tech Intel MCP evidence, browser
  matrix, load/Sentry and Clerk staging proof, and platform/security approval.

## 2026-06-19 Follow-Up 130: Resumable Integration Token Rotation Tool

### Trigger

Follow-Up 129 made `INTEGRATION_TOKEN_KEY` rotation fail closed when the
re-encryption tool was absent, but the missing tool still blocked safe
production rotation for Apollo, Seamless, Dust, HubSpot, Gmail, Microsoft Graph,
and future MCP-backed integrations.

### Issues Fixed

- Added `scripts/rotate-integration-tokens.ts` for explicit old-key-to-new-key
  re-encryption of `IntegrationToken` rows.
- The tool requires `OLD_INTEGRATION_TOKEN_KEY`,
  `NEW_INTEGRATION_TOKEN_KEY`, and an explicit `--dry-run` or `--apply` mode.
- Each new ciphertext is decrypted with the new key before any database write.
- Rows or fields already encrypted with the new key are marked
  `alreadyRotated` and skipped, making interrupted runs resumable.
- The release policy verifier now checks that the tool exists and covers the
  key contract, modes, access/refresh fields, resumability, verification, and
  local selftest.
- The runbook now documents the actual dry-run/apply flow and keeps
  `INTEGRATION_TOKEN_KEY_PREV` cleanup gated on successful re-encryption and
  smoke tests.

### Implementation Map

- `scripts/rotate-integration-tokens.ts`
- `scripts/verify-secret-rotation-policy.mjs`
- `package.json`
- `docs/RUNBOOK.md`
- `docs/solutions/agent-provider-credentials-org-secret-routing.md`

### Verification

- `pnpm deploy:evidence:secret-rotation:tool:selftest`: pass.
- `pnpm deploy:evidence:secret-rotation:policy`: pass.
- `pnpm deploy:evidence:secret-rotation:policy:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-secret-rotation-policy.mjs scripts/rotate-integration-tokens.ts --max-warnings=0`:
  pass.
- `node --check scripts/verify-secret-rotation-policy.mjs`: pass.
- `pnpm exec tsx scripts/rotate-integration-tokens.ts --help`: pass.
- `pnpm exec tsc --noEmit --pretty false --module NodeNext --moduleResolution NodeNext --target ES2022 --lib ES2023 --types node --skipLibCheck scripts/rotate-integration-tokens.ts`:
  pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 395
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed six review waves
  with P0 security/auth/access at 60 files.

### Remaining Launch Risks

- This closes the local token-rotation implementation gap. It does not certify a
  live production database rotation, live Apollo/Seamless/named Tech Intel MCP
  credentials, browser matrix, load/Sentry and Clerk staging proof,
  secret-history disposition, clean source review, or platform/security
  approval.

## 2026-06-19 Follow-Up 131: Web Edge Security Header Hardening

### Trigger

The P0 release-critical packet still includes the production web nginx config.
Review found the edge had only the basic XFO/XCTO/referrer headers, while
app-shell and asset locations declared their own `add_header Cache-Control`
directives. In nginx, a location-level `add_header` shadows parent `add_header`
directives unless the security headers are repeated in that location.

### Issues Fixed

- Added HSTS, COOP, CORP, Permissions-Policy, and Content-Security-Policy to
  `apps/web/nginx.conf`.
- Repeated the full browser hardening set in `/`, `/index.html`,
  `/manifest.json`, `/sw.js`, and `/assets/` so cache-specific headers do not
  drop the security posture.
- Kept app-shell entrypoints `no-cache, no-store, must-revalidate`.
- Kept hashed build assets `public, max-age=31536000, immutable`.
- Expanded `nginx-cache-policy.test.ts` so future cache edits fail if any
  hardened header disappears.

### Implementation Map

- `apps/web/nginx.conf`
- `apps/web/src/lib/nginx-cache-policy.test.ts`
- `docs/solutions/web-edge-security-headers.md`
- `MISTAKES.md`

### Verification

- Red regression first: `pnpm --filter @bidstack/web test -- src/lib/nginx-cache-policy.test.ts --reporter=dot`
  failed while the hardened headers were missing.
- `pnpm --filter @bidstack/web test -- src/lib/nginx-cache-policy.test.ts --reporter=dot`:
  pass, 4/4.
- `pnpm --filter @bidstack/web exec eslint src/lib/nginx-cache-policy.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `docker run --rm -v <nginx.conf>:/etc/nginx/conf.d/default.conf:ro nginxinc/nginx-unprivileged:alpine nginx -t`:
  pass.
- Live container `/health` smoke on `127.0.0.1:18187`: 200 with XFO, XCTO,
  Referrer-Policy, HSTS, COOP, CORP, Permissions-Policy, and CSP.
- Live container `/` smoke on `127.0.0.1:18188`: 200 with the same security
  headers and `Cache-Control: no-cache, no-store, must-revalidate`.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 396
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed six review waves
  with P0 release-critical at 25 files, P0 security/auth/access at 60 files,
  and P2 docs/runbooks at 47 files.

### Remaining Launch Risks

- This hardens the local web edge config. It does not certify live Clerk/Sentry
  CSP behavior, browser matrix, provider evidence, load proof, secret-history
  disposition, clean source review, or platform/security approval.

## 2026-06-19 Follow-Up 132: Production Compose Encryption-Key Wiring

### Trigger

The release-critical review moved from runtime key validation into deployment
descriptors. `apps/api/src/env.ts` requires a 64-character hex
`INTEGRATION_TOKEN_KEY` in production, and the worker decrypts stored OAuth,
provider, and org LLM credentials. `docker-compose.prod.yml` did not pass that
key into either service.

### Issues Fixed

- API production compose env now requires `INTEGRATION_TOKEN_KEY`.
- Worker production compose env now requires `INTEGRATION_TOKEN_KEY`.
- Added a compose policy verifier so future edits fail when API/worker secret
  wiring drifts from the runtime encryption contract.
- The verifier also guards Redis password auth and pgvector image selection,
  two adjacent production compose requirements already relied on by the stack.
- The runbook now calls the compose policy before the container build step.

### Implementation Map

- `docker-compose.prod.yml`
- `scripts/verify-compose-production-policy.mjs`
- `package.json`
- `docs/RUNBOOK.md`
- `docs/solutions/production-compose-secret-wiring.md`
- `MISTAKES.md`

### Verification

- Red policy first: `node scripts/verify-compose-production-policy.mjs` failed
  on missing API and worker `INTEGRATION_TOKEN_KEY` wiring.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `node --check scripts/verify-compose-production-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-compose-production-policy.mjs --max-warnings=0`:
  pass.
- `docker compose -f docker-compose.prod.yml config --quiet` with
  production-shaped dummy env and a 64-character hex key: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 398
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed six review waves
  with P0 release-critical at 25 files, P0 security/auth/access at 62 files,
  and P2 docs/runbooks at 48 files.

### Remaining Launch Risks

- This proves the local Docker Compose production descriptor. It does not prove
  live Azure/Container Apps, Kubernetes, platform secret-store values, live
  provider credentials, live token rotation, clean source review, browser
  matrix, load/Sentry proof, or platform/security approval.

## 2026-06-19 Follow-Up 133: Worker Production Env Fail-Fast Contract

### Trigger

The API production boot gate already rejects missing or malformed
`INTEGRATION_TOKEN_KEY`, and the production compose file now passes that key to
the worker. The worker itself still only failed fast on missing `DATABASE_URL`
and `REDIS_URL`, while its queues decrypt OAuth/provider credentials and rely on
durable object storage.

### Issues Fixed

- Added a pure worker production-env validator that can be tested without
  starting Redis, Prisma, Sentry, BullMQ, or queue processors.
- Production workers now require `DATABASE_URL`, `REDIS_URL`, a 64-character hex
  `INTEGRATION_TOKEN_KEY`, and durable S3 storage unless an explicit demo mode
  is active.
- S3-backed production workers now require `S3_BUCKET` and `S3_REGION`.
- Worker boot calls the validator before opening Redis or starting queues, so a
  bad secret/storage config fails before the container can look healthy.

### Implementation Map

- `apps/worker/src/lib/production-env.ts`
- `apps/worker/src/lib/production-env.test.ts`
- `apps/worker/src/main.ts`
- `docs/solutions/worker-production-env-fail-fast.md`
- `MISTAKES.md`

### Verification

- Red test first: `pnpm --filter @bidstack/worker exec vitest run src/lib/production-env.test.ts --reporter=dot`
  failed because `./production-env.js` did not exist.
- `pnpm --filter @bidstack/worker exec vitest run src/lib/production-env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/worker exec eslint src/lib/production-env.ts src/lib/production-env.test.ts src/main.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/worker build`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 401
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed six review waves
  with P0 release-critical at 25 files, P0 security/auth/access at 62 files,
  P1 runtime at 162 files, and P2 docs/runbooks at 49 files.

### Remaining Launch Risks

- This proves the local worker boot contract. It does not prove live platform
  secret-store values, staging queue execution, live provider credentials,
  object-storage permissions, browser matrix, load/Sentry/Clerk staging proof,
  clean source review, secret-history disposition, or platform/security
  approval.

## 2026-06-19 Follow-Up 134: MCP Production Env Fail-Fast Contract

### Trigger

The MCP server is a public API-key tool surface. Review found `main.ts`
statically imported `server.ts`, which imported the shared Redis client before
production env validation could run. The Redis layer also defaulted to
`redis://localhost:6380`, while production rate limiting is supposed to be a
shared fail-closed budget across replicas.

### Issues Fixed

- Added a pure MCP production-env validator.
- MCP production boot now requires `DATABASE_URL` and `REDIS_URL`.
- MCP production boot rejects invalid Redis URLs, loopback Redis hosts, and
  explicit `MCP_RATE_LIMIT_FAIL_CLOSED=false`.
- `main.ts` validates env before dynamically importing `server.ts`, so Redis
  and public route registration happen only after the production contract
  passes.
- Production Compose policy now verifies MCP `DATABASE_URL` and `REDIS_URL`
  required interpolation.

### Implementation Map

- `apps/mcp-server/src/production-env.ts`
- `apps/mcp-server/src/production-env.test.ts`
- `apps/mcp-server/src/main.ts`
- `scripts/verify-compose-production-policy.mjs`
- `docs/solutions/mcp-production-env-fail-fast.md`
- `MISTAKES.md`

### Verification

- Red test first: `pnpm --filter @bidstack/mcp-server exec vitest run src/production-env.test.ts --reporter=dot`
  failed because `./production-env.js` did not exist.
- `pnpm --filter @bidstack/mcp-server exec vitest run src/production-env.test.ts --reporter=dot`:
  7/7 pass.
- `pnpm --filter @bidstack/mcp-server exec vitest run src/plugins/hourly-rate-limit.test.ts src/serum-policy.test.ts --reporter=dot`:
  8/8 pass.
- `pnpm --filter @bidstack/mcp-server exec eslint src/production-env.ts src/production-env.test.ts src/main.ts src/redis.ts src/plugins/hourly-rate-limit.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/mcp-server typecheck`: pass.
- `pnpm --filter @bidstack/mcp-server build`: pass.
- `pnpm deploy:evidence:compose:policy:selftest`: pass.
- `pnpm deploy:evidence:compose:policy`: pass.
- `node --check scripts/verify-compose-production-policy.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-compose-production-policy.mjs --max-warnings=0`:
  pass.
- `docker compose -f docker-compose.prod.yml config --quiet` with
  production-shaped dummy env: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:source:selftest`: pass.
- `pnpm deploy:evidence:source`: expected release block; worktree has 405
  dirty entries.
- `pnpm deploy:evidence:source:plan:write`: pass; refreshed six review waves
  with P0 release-critical at 25 files, P0 security/auth/access at 62 files,
  P1 runtime at 165 files, and P2 docs/runbooks at 50 files.

### Remaining Launch Risks

- The DB-backed MCP auth test was not green locally because Postgres was not
  running at `localhost:5433`; `src/auth.test.ts` failed before exercising auth
  assertions. Full release still needs live DB-backed MCP auth/regression proof,
  clean source review, live provider evidence, browser matrix,
  load/Sentry/Clerk staging proof, secret-history disposition, and
  platform/security approval.

## 2026-06-19 Follow-Up 135: Technical Stack Source-First Add UX

### Trigger

The Technical Stack Overview could pull provider signals, but the add workflow
still felt manual-first. Tony asked for the tech stack add experience to be
better and for MCP-backed sources such as Apollo, Seamless, and other valid
sources to feed the workflow directly.

### Issues Fixed

- Added a source-first assistant inside the add composer.
- Added an in-composer source pull action that uses the existing provider
  refresh path.
- Surfaced provider coverage for Apollo, Seamless.AI, Tech Intel MCP, and open
  data in the add moment.
- Added direct acceptance of exact source-backed matches while preserving
  `manual:accepted:<provider-source>` provenance.
- Fixed the five-metric intake summary layout and mobile source-chip wrapping.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  27/27 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts --reporter=dot`:
  5/5 pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts --reporter=dot`:
  4/4 pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/companies.test.ts --reporter=dot`:
  17/17 pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- In-app Browser QA on `http://127.0.0.1:5174/accounts/ci-financial`
  verified desktop edit mode, source-first assistant, provider lanes, the
  in-composer source pull button, status/toast feedback, 44px-class controls,
  and 390px mobile no-overflow after CSS polish.

### Remaining Launch Risks

- Local provider credentials were not configured, so browser QA correctly
  showed Apollo, Seamless, and Tech Intel MCP lanes as disabled while open data
  synced. Full release still needs credentialed staging evidence for Apollo,
  Seamless, named Tech Intel MCP sources, clean source review, browser matrix,
  load/Sentry/Clerk staging proof, secret-history disposition, and
  platform/security approval.

## 2026-06-19 Follow-Up 136: Secret Evidence Selftest Fixture Hygiene

### Trigger

`pnpm deploy:evidence:secrets` was red even after the tracked full-tree scanner
passed. The untracked release scan was flagging
`scripts/write-secret-scan-evidence.mjs` itself because the new selftest stored
raw modern-token fixtures in source.

### Issues Fixed

- Modern poisoned token fixtures are now assembled from non-matching string
  fragments at runtime.
- The selftest still proves the assembled OpenAI/Anthropic/GitHub/Slack/Google/
  Azure shapes match the production regex.
- The selftest now also asserts the evidence writer's own source text does not
  match the production secret regex.

### Implementation Map

- `scripts/write-secret-scan-evidence.mjs`
- `docs/solutions/security-scan-local-gates.md`
- `MISTAKES.md`

### Verification

- `node scripts/write-secret-scan-evidence.mjs --selftest`: pass.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- `pnpm deploy:evidence:secrets`: current tree/current commit clean; still
  blocks without full-history disposition.
- `node scripts/write-secret-scan-evidence.mjs --run-full-history --reviewer codex-local-evidence`:
  full-history gitleaks reviewed 11 redacted findings and correctly blocked on
  missing rotated/revoked plus owner-approved disposition evidence.
- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-secret-scan-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:production`: still blocked overall, but now passes
  current-tree/current-commit secret cleanliness and full-history-reviewed
  checks.

### Remaining Launch Risks

- This does not approve the 11 historical findings. Production release still
  needs real credential rotation/revocation proof, named security-owner
  approval, owner ticket/reference, approval timestamp, and rotation timestamp.

## 2026-06-19 Follow-Up 137: Operational Restore Threshold Evidence

### Trigger

Generating a fresh operational readiness artifact converted the production
verifier from "artifact missing" to concrete ops failures. That exposed a
misleading subcheck: missing restore RTO/RPO values displayed as passing `0m`
because the verifier coerced `null` with `Number(null)`.

### Issues Fixed

- Added explicit numeric evidence parsing for operational threshold checks.
- Missing/null backup retention, restore RTO, and restore RPO are now treated as
  missing evidence.
- Production ops evidence now targets `production` instead of the default
  `staging` when generated for the production verifier.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm deploy:evidence:selftest`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs scripts/write-operational-readiness-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:ops:selftest`: pass.
- `$env:BIDSTACK_DEPLOY_ENV='production'; pnpm deploy:evidence:ops`: expected
  block, fresh production ops artifact written with 21 missing-proof failures.
- `pnpm deploy:evidence:production`: expected block, now reports restore
  RTO/RPO as missing rather than false-green `0m`.

### Remaining Launch Risks

- Operational readiness itself is still not approved. Release still needs real
  Azure/Bicep build and what-if proof, private networking approval, storage
  validation, migration deploy proof, backups/restore drill, rollback drill,
  monitoring/on-call validation, named approver, ticket/reference, and approval
  timestamp.

## 2026-06-19 Follow-Up 138: Technical Stack Source-Proof UX

### Trigger

The Technical Stack Overview add flow still made source-backed stack work feel
too manual. Tony specifically asked for a better add experience and for MCP/source
pulls to include Apollo, Seamless, and other valid sources.

### Issues Fixed

- The add composer now recommends the strongest provider-backed suggestion even
  before manual typing starts.
- Accepted provider-backed suggestions now show a pre-save proof strip with
  accepted-source counts by provider/source.
- The button copy now uses `Pull sources`, matching the actual provider mix:
  Apollo MCP/API, Seamless MCP/API, configured Tech Intel MCPs, and open data.
- The accepted-source proof layout has mobile-specific wrapping so provider
  badges do not clip at 390px.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`

### Verification

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  28/28 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web test -- src/hooks/apiMutationBodies.test.tsx --reporter=dot`:
  3/3 pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_PORT_OFFSET='31'; pnpm --filter @bidstack/web e2e -- technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on `http://127.0.0.1:5174/accounts/ci-financial`
  verified desktop and 390px mobile Technical Stack edit mode, source pull
  loading/settled states, Apollo/Seamless/Tech Intel/open-data lanes, no
  horizontal overflow, no clipped source text, and no visible touch target under
  44px in the Technical Stack card.

### Remaining Launch Risks

- Local Apollo, Seamless.AI, and Tech Intel MCP credentials are not configured,
  so the browser pass proves UX and source-lane contract only. Production
  release still needs credentialed staging evidence from live Apollo, Seamless,
  named Tech Intel MCP sources, and clean source-review acceptance.

## 2026-06-19 Follow-Up 139: Sentry Smoke Preflight Auth Gate

### Trigger

`pnpm deploy:evidence:production` reported a missing Sentry smoke artifact.
Running the Sentry writer locally proved it can write an artifact, but without
Sentry CLI auth the issue-list verification fails late after the bundle would
already be in the evidence-generation phase.

### Issues Fixed

- Release preflight now requires `SENTRY_AUTH_TOKEN` or
  `BIDSTACK_SENTRY_AUTH_TOKEN`.
- The auth token check is sensitive, minimum-length guarded, and rejects
  placeholder-looking values.
- The deploy bundle selftest now includes both a complete fixture and a poisoned
  placeholder Sentry auth token fixture.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `pnpm deploy:evidence:bundle:selftest`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-deploy-evidence-bundle.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:preflight:production`: expected block, now reports
  47 blockers including `preflight.sentry.authToken`.

### Remaining Launch Risks

- This only fail-closes the preflight. Live release still needs a real Sentry
  auth token, configured DSNs, triggered API/worker smoke events, observed
  Sentry issues for the release/environment, and production verifier pass.

## 2026-06-19 Follow-Up 140: Technical Stack Guided Source Verification

### Trigger

Tony asked for the Technical Stack Overview add experience to feel more premium
and to make sure MCP/provider pulls include Apollo, Seamless, and other valid
sources. The composer already had source-first actions, but typed manual entries
still needed an explicit source-verification moment before Stage.

### Issues Fixed

- Added a source verification guide inside the Technical Stack add composer for
  typed/imported technologies.
- The guide calls the existing source refresh path for Apollo MCP/API,
  Seamless MCP/API, configured Tech Intel MCPs, and open data.
- Exact typed matches against pending provider suggestions now tell users that
  Stage preserves provider provenance.
- E2E coverage now checks guide visibility, 390px no-overflow behavior, and
  44px minimum guide controls.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- Red test observed first: targeted guide test failed because `Source
  verification guide` did not exist.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  30/30 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='673'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Remaining Launch Risks

- Local Apollo, Seamless.AI, and Tech Intel MCP credentials are not configured,
  so this pass proves UX/source-lane behavior and provider contract wiring only.
  Live credentialed staging evidence is still required for release.

## 2026-06-19 Follow-Up 141: Browser Evidence Environment Gate

### Trigger

The strict production verifier still blocked deployment, but inspection of the
browser evidence gate showed that a browser artifact's recorded environment was
not compared with the deploy target.

### Issues Fixed

- Browser regression evidence now has a strict `browser.environment` check.
- Evidence environment normalization now preserves missing values instead of
  defaulting them to `production`.
- The Sentry smoke environment check now uses the same optional evidence
  normalization.
- Semgrep SAST evidence was refreshed and is now fresh/clean in the strict
  production verifier.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:semgrep`: pass, 1,444 mirrored files, zero findings,
  Dockerfile syntax check pass.
- `pnpm deploy:evidence:production`: expected block, now 26 pass / 47 fail with
  Semgrep fresh and clean.

### Remaining Launch Risks

- Browser release evidence still needs a real non-local target, production
  build, Clerk-backed auth, required roles, Chromium/Firefox/WebKit projects,
  and clean test counts. The current production verifier still blocks on clean
  source, ops approval, load certification, container coverage, secret-history
  owner disposition, live provider evidence, Sentry smoke, browser artifact,
  and platform/security approval.

## 2026-06-19 Follow-Up 142: Provider Evidence Environment Gate

### Trigger

After adding the browser evidence environment gate, the same release-evidence
class was present in provider quality evidence: the artifact recorded
`environment`, but strict verification did not compare it with the deploy
target.

### Issues Fixed

- Provider quality evidence now has a strict `providers.environment` check.
- A poisoned selftest proves production-scoped provider evidence fails a strict
  staging verifier, even when provider lanes are otherwise clean.
- The current production verifier now explicitly reports that the local provider
  evidence is staging-scoped.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/verify-deploy-evidence.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:production`: expected block, now 26 pass / 48 fail.

### Remaining Launch Risks

- The extra production verifier failure is intentional and honest: existing
  provider evidence is stale, incomplete, and staging-scoped. Full release still
  needs live production/staging provider quality evidence for Apollo,
  Seamless.AI, named Tech Intel MCP sources, and clean strict verifier output.

## 2026-06-19 Follow-Up 143: Container Scan Coverage Evidence

### Trigger

The strict production verifier still showed missing deploy-image coverage, and
the container scan writer could green-pass a malformed empty image override.

### Issues Fixed

- Container scan image and severity overrides now fail closed if they parse to
  an empty list.
- Container scan evidence now records `requestedImages`.
- `passed` now requires one scan report for every requested image.
- Fresh local Trivy evidence scanned all five required deploy images with zero
  CRITICAL/HIGH findings.

### Implementation Map

- `scripts/run-container-vulnerability-scan.mjs`
- `docs/solutions/container-vulnerability-scan-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node scripts/run-container-vulnerability-scan.mjs --selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-container-vulnerability-scan.mjs --max-warnings=0`:
  pass.
- `pnpm deploy:evidence:container`: pass, five required images scanned, zero
  CRITICAL/HIGH findings.
- `pnpm deploy:evidence:production`: expected block, now 27 pass / 47 fail.

### Remaining Launch Risks

- Container evidence is now clean locally. Full release remains blocked by
  source cleanliness, ops approval/proof, certification load, secret-history
  owner disposition, live provider evidence, production Sentry smoke, browser
  regression artifact, and platform/security approval.

## 2026-06-19 Follow-Up 144: Technical Stack Source-Aware Staging Review

### Trigger

Tony asked for the Technical Stack Overview add experience to feel better and
for MCP/source pulls to cover Apollo, Seamless, and other valid sources.

### Issues Fixed

- The add composer now shows a source-aware staging review before the Stage
  action.
- Typed/imported technologies are classified as source-backed, manual after
  checked sources, needs source pull, or duplicate.
- Exact Apollo, Seamless.AI, Tech Intel MCP, and other provider matches still
  stage with `manual:accepted:<provider-source>` provenance.
- Manual entries after a source pull now explicitly say no current provider
  match was found, preventing a false provider-backed impression.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  31/31 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  34/34 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='711'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Remaining Launch Risks

- Local credentials for live Apollo, Seamless.AI, and named Tech Intel MCP
  sources are still absent. This proves the UI/API path and source-lane contract,
  not live third-party extraction quality for production release evidence.

## 2026-06-19 Follow-Up 145: Load Evidence Environment Gate

### Trigger

After browser and provider release artifacts gained strict environment matching,
the load certification artifact still lacked the same deploy-target proof.

### Issues Fixed

- k6 load evidence now records `environment` from `BIDSTACK_DEPLOY_ENV`.
- Strict load preflight now requires `BIDSTACK_DEPLOY_ENV=staging|production`.
- Strict deploy verification rejects load artifacts whose environment is missing
  or different from the deploy target.
- Strict deploy verification also requires `strictEvidence: true` and the core
  k6 metrics block, so thresholds alone cannot stand in for a real load run.

### Implementation Map

- `scripts/run-k6-load-test.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm load-test:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.

### Remaining Launch Risks

- Full production load certification still needs a real non-local staging or
  production API target, a short-lived bearer token, and a completed k6
  certification profile. The current local artifact remains smoke/local proof
  only and must not be treated as production evidence.

## 2026-06-19 Follow-Up 146: Container Evidence Immutable Image Gate

### Trigger

The strict production verifier treated the current container scan as passing
even though the artifact scanned local mutable tags such as
`bidcrm-api:root-api-user-probe`.

### Issues Fixed

- `pnpm deploy:evidence:container` now runs strict container evidence mode.
- Strict container evidence requires `BIDSTACK_DEPLOY_ENV=staging|production`.
- Strict container evidence requires immutable image refs:
  `registry/image@sha256:<digest>`.
- Strict deploy verification rejects container artifacts whose environment is
  missing or mismatched, whose strict mode is missing, or whose image refs are
  mutable tags.
- Bundle preflight now blocks missing or mutable `BIDSTACK_CONTAINER_SCAN_IMAGES`
  before spending time on the full evidence run.

### Implementation Map

- `scripts/run-container-vulnerability-scan.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `package.json`
- `docs/solutions/container-vulnerability-scan-gate.md`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `node scripts/run-container-vulnerability-scan.mjs --selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:container`: expected block without release env and
  digest image refs.
- `pnpm deploy:evidence:preflight:production`: expected block includes
  `preflight.container.images`.
- `pnpm deploy:evidence:production`: expected block, 28 pass / 52 fail, with
  container evidence now rejected as non-strict, environment-missing, and
  mutable-tag proof.

### Remaining Launch Risks

- Current local Trivy evidence is still useful Docker hygiene, but production
  release certification now needs pushed registry image digest refs and matching
  `BIDSTACK_DEPLOY_REQUIRED_IMAGES` before the strict verifier can pass.

## 2026-06-19 Follow-Up 147: Technical Stack Best-Source Add Provenance

### Trigger

The Technical Stack add UX needed to feel more trustworthy when adding a stack
technology from multiple valid provider sources.

### Issues Fixed

- Exact typed source matches now use an explicit first-wins best-source helper
  after sorting by confidence and provider trust.
- Duplicate provider evidence for the same vendor no longer lets a weaker
  Apollo/Seamless/Tech Intel row overwrite the strongest suggestion.
- Source-backed staging now uses provider canonical casing, for example
  `ServiceNow`, when a typed exact match exists.
- User-facing copy now says configured Tech Intel MCPs and other source matches,
  keeping BuiltWith, Wappalyzer, and private enrichers honest as configured MCP
  sources rather than fake standalone lanes.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `docs/solutions/technical-stack-provider-source-pull.md`

### Verification

- Technical Stack component: 32/32 pass.
- Web ESLint on touched Technical Stack files and E2E spec: pass.
- Web typecheck: pass.
- API provider/technical-stack tests: 34/34 pass.
- Apollo worker queue tests: 22/22 pass.
- Shared build: pass.
- Web production build: pass.
- Technical Stack Chromium E2E: 1/1 pass.

### Remaining Launch Risks

- Live Apollo, Seamless.AI, and named Tech Intel MCP extraction still needs
  credentialed staging/production evidence before release certification.

## 2026-06-19 Follow-Up 148: Release Tool Readiness Image Probe Gate

### Trigger

The strict production verifier accepted a tool-readiness artifact where all
Docker fallback image probes were skipped.

### Issues Fixed

- `pnpm deploy:evidence:tools` now forces Docker image execution probes.
- The release evidence bundle now forces probes on its first tools step.
- Strict deploy verification now rejects Docker-dependent release tools whose
  pinned image probe is missing, optional, failed, or skipped.
- Added a poisoned verifier selftest for skipped Gitleaks, k6, Semgrep, and
  Trivy image probes.

### Implementation Map

- `package.json`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/release-tool-readiness-gate.md`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:tools`: pass with executed Gitleaks, k6, Semgrep, and
  Trivy image probes.
- Targeted ESLint on touched scripts: pass.
- `pnpm deploy:evidence:production`: expected block, 29 pass / 52 fail, with
  `tools.imageProbes` passing after refreshed image execution proof.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, and immutable container digest refs.

## 2026-06-19 Follow-Up 149: Strict Deploy Report Artifact Freshness

### Trigger

`pnpm deploy:evidence:production` printed current strict verification results
but did not update `deploy-evidence/strict-production-latest.json` unless an
explicit report path environment variable was set.

### Issues Fixed

- Strict staging and production verification now default to writing the matching
  strict report artifact.
- Non-strict verification keeps the generic deploy evidence report path.
- Verifier selftests now assert the default staging and production report paths.
- The stale whitespace blocker in `packages/dust-client/src/index.ts` was
  removed so broad source diff checks no longer fail on that file.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `packages/dust-client/src/index.ts`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the verifier: pass.
- `pnpm --filter @bidstack/dust-client build`: pass.
- `pnpm deploy:evidence:production`: expected block, 29 pass / 52 fail, and
  writes `deploy-evidence/strict-production-latest.json` with
  `tools.imageProbes` passing.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 165: MCP Docker Port Metadata Alignment

### Trigger

While continuing the 100k-user deploy-readiness audit, the refreshed P0
release-critical source review packet led to a Dockerfile/runtime mismatch:
the MCP server process defaults to `PORT_MCP=4001`, but the root Dockerfile
`mcp-server` target exposed `3001`.

### Issues Fixed

- Updated the root Dockerfile MCP target to expose `4001` for MCP traffic and
  `4003` for health.
- Added an MCP package policy test that pins root Dockerfile port metadata,
  healthcheck, and non-root runtime posture.
- Kept the compose policy unchanged after verifying MCP currently does not
  decrypt stored integration tokens. The service still requires `DATABASE_URL`
  and `REDIS_URL`; `INTEGRATION_TOKEN_KEY` remains required only for services
  that encrypt/decrypt tenant/provider secrets.

### Implementation Map

- `Dockerfile`
- `apps/mcp-server/src/dockerfile-policy.test.ts`
- `docs/solutions/mcp-production-env-fail-fast.md`
- `MISTAKES.md`

### Verification

- MCP Dockerfile + production-env tests: 9/9 pass.
- MCP typecheck: pass.
- Targeted MCP ESLint: pass.
- Compose policy selftest and live policy: pass.
- Dockerfile check for `--target mcp-server`: pass, no warnings.
- Source evidence refreshed: expected-blocked at 416 dirty entries.
- Source review plan refreshed: expected-blocked with six review waves.
- Strict production evidence refreshed: expected-blocked at 46 pass / 75 fail.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 164: Guided Technical Stack Add + Apollo MCP Honesty

### Trigger

Tony asked for the Technical Stack Overview add experience to feel premium and
to ensure MCP/provider pulls include Apollo, Seamless.AI, and every valid
attributed source without fake provider confidence.

### Issues Fixed

- Added a guided add command inside the Technical Stack editor that chooses the
  next best action: pull sources, accept the best source-backed match, stage
  typed entries, or focus intake.
- Kept Apollo, Seamless.AI, configured Tech Intel MCPs, open data, and Other
  attributed sources visible in the add flow while preserving accepted-source
  provenance as `manual:accepted:<source>`.
- Hardened Apollo provider readiness so API queueing and worker execution use
  the same invariant: complete MCP credentials require `APOLLO_MCP_URL` plus
  `APOLLO_MCP_BEARER_TOKEN`; REST fallback requires `APOLLO_API_KEY` plus a
  company domain.
- Partial Apollo MCP config now fails closed as unavailable/skipped instead of
  creating a queued job that cannot read backend signals.
- Added scoped critical/serious axe coverage for the Technical Stack editor in
  the Chromium E2E path.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `apps/api/src/services/crm/enrichment.service.ts`
- `apps/api/src/services/crm/company-enrichment.service.test.ts`
- `apps/worker/src/queues/company-enrich-apollo.ts`
- `apps/worker/src/queues/company-enrich-apollo.test.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- TechStack component tests: 35/35 pass.
- API technical-stack/provider/enrichment tests: 32/32 pass.
- Apollo worker tests: 24/24 pass.
- Targeted ESLint for touched web/API/worker/E2E files: pass.
- Web, API, and worker typecheck: pass.
- Web build: pass.
- Chromium Technical Stack E2E with existing API reuse: 1/1 pass, including
  source pull, provider lane ids, manual add/save persistence, mobile
  no-overflow, cleanup, and scoped axe coverage.
- `git diff --check` for touched source files: pass with existing LF/CRLF
  working-copy warnings.

### Remaining Launch Risks

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints.
- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 163: Provider Preflight Red Artifact

### Trigger

Strict production evidence was still reading stale staging provider quality JSON
when the production bundle stopped at preflight blockers before running the
provider evidence writer.

### Issues Fixed

- The provider source quality bundle step now has
  `preflightDiagnosticScript: deploy:evidence:providers`.
- Under preflight blockers, the bundle writes a fresh production
  `deploy-evidence/provider-quality-latest.json` without making a network call
  when required provider inputs are absent.
- Strict verification now passes provider freshness and environment checks while
  still blocking on the real missing Apollo, Seamless.AI, and Tech Intel MCP
  lane proof.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:providers:selftest`: pass. The selftest intentionally
  prints failing fixture diagnostics while exiting 0.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:bundle:production`: expected block with 61 preflight
  blockers plus `providers.failed` and `browser.failed`.
- `pnpm deploy:evidence:production`: expected block, 46 pass / 75 fail.
  `providers.fresh` and `providers.environment` now pass.
- `pnpm deploy:evidence:source`: expected block, source current, clean=no,
  413 status entries.
- `pnpm deploy:evidence:source:plan`: expected block, source current=yes,
  source clean=no, six cleanup waves.

### Remaining Launch Risks

- Production release remains blocked by dirty source, missing live provider
  target/token/company-key, missing Apollo/Seamless.AI/Tech Intel MCP lane
  proof, stale/local load evidence, Sentry smoke evidence, browser raw
  Playwright proof, ops approval/proof, secret-history owner disposition,
  immutable image digest refs/raw Trivy reports, and platform/security approval.

## 2026-06-19 Follow-Up 162: Browser Preflight Red Artifact

### Trigger

While continuing the 100k-user production-readiness audit, strict deploy
verification reported missing browser release evidence because the production
bundle skipped every evidence writer when operator preflight was blocked.

### Issues Fixed

- The release bundle now gives the browser evidence step a
  `preflightDiagnosticScript` pointing at `deploy:evidence:browser:write`.
- On preflight blockers, the runner writes a fresh red
  `deploy-evidence/browser-regression-latest.json` without launching Playwright,
  preserving `originalScript` and marking the step as `preflightDiagnostic`.
- The strict production verifier now consumes a current browser artifact and
  reports concrete failures instead of stopping at missing proof.

### Implementation Map

- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/cross-browser-e2e-core-gate.md`
- `MISTAKES.md`

### Verification

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:browser:selftest`: pass. The selftest intentionally
  prints failing fixture diagnostics while exiting 0.
- `pnpm deploy:evidence:bundle:production`: expected block with 61 preflight
  blockers plus `browser.failed`; writes `browser-regression-latest.json`.
- `pnpm deploy:evidence:production`: expected block, 44 pass / 77 fail. Browser
  evidence is fresh and present, with 10 concrete strict browser failures.
- `pnpm deploy:evidence:source`: expected block, source current, clean=no,
  413 status entries, 254 tracked modifications, 159 untracked files.
- `pnpm deploy:evidence:source:plan`: expected block, source current=yes,
  source clean=no, six cleanup waves.

### Remaining Launch Risks

- Production release remains blocked by dirty source, missing live
  non-local browser target, missing Clerk-backed browser auth proof, missing
  production-build browser proof, missing raw Playwright report/command trail,
  stale/local load evidence, stale/missing provider lane proof, Sentry smoke
  evidence, ops approval/proof, secret-history owner disposition, immutable
  image digest refs/raw Trivy reports, and platform/security approval.

## 2026-06-19 Follow-Up 158: Technical Stack Empty Source Start

### Trigger

The Technical Stack Overview could pull provider intelligence after a stack
existed, but adding the first technology still felt passive and manual-first.
Tony asked for the add experience to feel better and for MCP-backed sources
such as Apollo, Seamless.AI, and other valid sources to be pulled into the flow.

### Issues Fixed

- Empty technical-stack states now show a premium source-backed start panel
  with Apollo, Seamless.AI, configured Tech Intel MCPs, open data, and Other
  sources.
- The primary empty-state CTA triggers the existing provider refresh route and
  then opens the source review/add flow.
- Read-only card mode now exposes a visible `Add stack` action beside `Pull
  sources`, instead of relying only on a compact icon affordance.
- Manual add remains one click away for trusted human-entered stack truth.
- The source contract stayed honest: Apollo remains MCP/API queued, Seamless
  and Tech Intel remain backend-backed, and Other sources are derived from
  attributed suggestions rather than fake provider endpoints.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `docs/solutions/technical-stack-provider-source-pull.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`: 34/34 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`: pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`: 34/34 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`: 22/22 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='819'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`: 1/1 pass.

### Remaining Launch Risks

- Live Apollo, Seamless.AI, BuiltWith, Wappalyzer, and private Tech Intel MCP
  extraction still need credentialed staging endpoints before provider evidence
  can be called production-certified.

## 2026-06-19 Follow-Up 159: HubSpot Integration Type Separation

### Trigger

The source review highlighted a deploy-risk integration bug: HubSpot OAuth
migration credentials were still written into `IntegrationConfig` as
`type='salesforce'` because the enum had no HubSpot value.

### Issues Fixed

- Added `hubspot` to the Prisma `IntegrationType` enum.
- HubSpot OAuth callback upserts now use `type='hubspot'` and
  `name='hubspot-migration'`.
- HubSpot import startup now reads the same canonical HubSpot coordinates.
- Added a backfill migration that converts legacy Salesforce-typed HubSpot rows,
  while deactivating duplicates if a canonical HubSpot row already exists.
- Added a focused regression test so the route helpers cannot fall back to
  `salesforce` again.

### Implementation Map

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260619140000_hubspot_integration_type/migration.sql`
- `packages/db/prisma/migrations/20260619140500_hubspot_integration_config_backfill/migration.sql`
- `apps/api/src/routes/migrations-hubspot.routes.ts`
- `apps/api/src/routes/migrations-hubspot.routes.test.ts`
- `docs/solutions/hubspot-integration-type-migration.md`

### Verification

- `pnpm --filter @bidstack/db generate`: pass.
- `$env:DATABASE_URL='postgresql://user:pass@localhost:5432/bidcrm'; pnpm exec prisma validate`: pass.
- `pnpm --filter @bidstack/db build`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/migrations-hubspot.routes.test.ts --reporter=dot`: 1/1 pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/routes/migrations-hubspot.routes.ts src/routes/migrations-hubspot.routes.test.ts --max-warnings=0`: pass.
- Scoped `git diff --check`: pass with only LF-to-CRLF normalization warnings
  on touched tracked files.

### Remaining Launch Risks

- Live HubSpot OAuth still needs staging HubSpot app credentials and callback
  proof. Overall production release remains blocked by dirty source, live
  provider/browser/load/Sentry evidence, ops approval, secret-history owner
  disposition, immutable image digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 160: HubSpot Migration Queue Secret Hygiene

### Trigger

After separating HubSpot from the Salesforce IntegrationConfig type, the
end-to-end migration path still placed HubSpot OAuth tokens in BullMQ job
metadata. BullMQ persists payloads in Redis, so Redis effectively became a
secondary secret store for migration imports.

### Issues Fixed

- HubSpot import queue payloads now carry only `hubspotIntegrationConfigId`.
- The worker resolves the encrypted IntegrationConfig row and decrypts the
  access token just in time.
- Follow-up paginated HubSpot jobs preserve the non-secret reference instead of
  copying raw token material.
- Shared `MigrationJobPayload` validation rejects raw secret-looking metadata
  keys such as `accessToken` and nested `refreshToken`.
- API, shared schema, and worker regression tests prove the new contract.

### Implementation Map

- `packages/shared/src/schemas/migration.ts`
- `packages/shared/src/schemas/migration.test.ts`
- `apps/api/src/routes/migrations-hubspot.routes.ts`
- `apps/api/src/routes/migrations-hubspot.routes.test.ts`
- `apps/worker/src/queues/migration.ts`
- `apps/worker/src/queues/migration.hubspot-credentials.test.ts`
- `docs/solutions/hubspot-migration-queue-secret-hygiene.md`

### Verification

- `pnpm --filter @bidstack/shared exec vitest run src/schemas/migration.test.ts --reporter=dot`: 2/2 pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/migrations-hubspot.routes.test.ts --reporter=dot`: 2/2 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/migration.hubspot-credentials.test.ts --reporter=dot`: 2/2 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/migration.helpers.test.ts src/queues/migration.hubspot-credentials.test.ts --reporter=dot`: 11/11 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/worker exec tsc --noEmit --pretty false`: pass.
- Targeted ESLint for touched shared/API/worker files: pass.
- Scoped `git diff --check`: pass with only LF-to-CRLF normalization warnings.

### Remaining Launch Risks

- Existing queued HubSpot jobs created before this change may contain raw token
  metadata until drained or expired. Production cutover should clear pre-change
  migration queue entries from non-production Redis before reuse.
- Live HubSpot OAuth/import still needs staging credentials and callback proof.
- Overall production release remains blocked by dirty source, live
  provider/browser/load/Sentry evidence, ops approval, secret-history owner
  disposition, immutable image digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 154: Load Evidence Raw Summary Proof

### Trigger

Strict deploy verification checked the compact load certification summary but
did not require the raw k6 summary export that produced the derived thresholds
and metrics.

### Issues Fixed

- Added `load.rawSummary` to require `rawSummaryFound: true`.
- Required `rawSummaryPath` to point to an existing source artifact inside the
  repo.
- Added a poisoned selftest where the compact load artifact is present but the
  raw k6 summary is missing.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/k6-load-gate-docker-fallback.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm load-test:selftest`: pass.
- Targeted ESLint on the verifier and k6 runner: pass.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 153: Browser Evidence Source Report Proof

### Trigger

Strict deploy verification checked browser regression summaries but did not
require the raw Playwright JSON report or command trail that produced the
summary.

### Issues Fixed

- Added `browser.sourceReport` to require a source Playwright JSON report inside
  the repo.
- Added `browser.command` to require a recorded Playwright test command.
- Strengthened `browser.tests` so unknown outcomes fail strict release evidence
  even when `passed: true` is present.
- Added poisoned selftests for synthetic browser artifacts and unknown test
  counts.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the verifier: pass.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  browser/provider/load/Sentry evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 152: Technical Stack Other Source Provenance

### Trigger

The Technical Stack add assistant handled Apollo, Seamless.AI, Tech Intel MCP,
open-data, meeting, and Omniscient sources, but attributed suggestions from any
other valid source could collapse into generic accepted proof.

### Issues Fixed

- Added a visible `Other sources` lane for attributed technical-stack
  suggestions outside the named provider families.
- Rendered unknown accepted source IDs as readable labels, such as
  `Partner Scan`, instead of a generic `Accepted` label.
- Preserved exact source provenance in staged and saved rows as
  `manual:accepted:<source>`.
- Kept the backend refresh contract strict: Apollo and Seamless remain MCP/API
  lanes, configured Tech Intel MCPs remain the valid extension point for
  BuiltWith, Wappalyzer, and private enrichers, and `Other sources` is derived
  from incoming attributed suggestions.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `docs/solutions/technical-stack-provider-source-pull.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx -t "other attributed" --reporter=dot`:
  1/1 selected test pass.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  33/33 pass.
- Targeted ESLint on the Technical Stack component, tests, and cockpit CSS:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- Targeted API provider/route/service Vitest suite: 34/34 pass.
- Targeted Apollo worker Vitest suite: 22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- Technical Stack Playwright Chromium E2E: 1/1 pass.

### Remaining Launch Risks

- Live credentialed Apollo, Seamless.AI, BuiltWith, Wappalyzer, and private
  Tech Intel MCP extraction still require staging credentials and endpoints.
  Local QA proves UI/source contract behavior, not third-party data freshness.

## 2026-06-19 Follow-Up 154: Strict Semgrep Scanner Metadata Proof

### Trigger

Semgrep evidence was green, but strict verification could still accept a
compact zero-finding summary without scanner metadata.

### Issues Fixed

- Strict Semgrep verification now requires scanner identity, pinned Docker
  image, configs, blocking severities, scanned source coverage, successful
  command exit, raw results/errors arrays, and Dockerfile syntax proof.
- Deploy evidence selftests include a poisoned compact Semgrep summary.
- The deploy evidence docs no longer describe compact Semgrep summaries as
  release proof.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the verifier: pass.
- `git diff --check -- scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:production`: expected block, 39 pass / 54 fail, with
  Semgrep scanner metadata checks passing.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 153: Raw Load And Browser Source JSON Proof

### Trigger

Strict load and browser gates required raw source report paths, but only checked
that those files existed.

### Issues Fixed

- `load.rawSummary` now requires the raw k6 summary to parse as JSON.
- `browser.sourceReport` now requires the raw Playwright report to parse as
  JSON.
- Deploy evidence selftests include invalid-JSON poison fixtures for both
  checks.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/solutions/k6-load-gate-docker-fallback.md`
- `docs/solutions/cross-browser-e2e-core-gate.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the verifier: pass.
- `git diff --check -- scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:production`: expected block, 31 pass / 54 fail.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 157: Strict Container Preflight Red Artifact

### Trigger

`pnpm deploy:evidence:container` could exit on strict preflight errors before
writing a fresh artifact. Production verification then kept reading an older
non-strict container scan. Strict verification also reported zero blocking
container findings when the artifact had zero image reports.

### Issues Fixed

- Strict container preflight failures now write a fresh red
  `deploy-evidence/container-scan-latest.json`.
- The artifact records strict mode, deploy environment, requested images,
  `commandExitCode: 1`, `passed: false`, and `validationFailures`.
- Strict deploy verification now fails `container.findings` when no image
  reports exist.
- Selftests cover strict preflight failure evidence and strict zero-report
  findings rejection.

### Implementation Map

- `scripts/run-container-vulnerability-scan.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/container-vulnerability-scan-gate.md`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node scripts/run-container-vulnerability-scan.mjs --selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore scripts/run-container-vulnerability-scan.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `$env:BIDSTACK_DEPLOY_ENV='production'; pnpm deploy:evidence:container`:
  expected block, fresh strict red artifact written for mutable local tags.
- `pnpm deploy:evidence:source`: expected block at 405 dirty source entries.
- `pnpm deploy:evidence:source:plan:write`: pass.
- `pnpm deploy:evidence:production`: expected block, 41 pass / 68 fail.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops owner approval/proof, immutable
  registry digest refs/raw Trivy reports, secret-history disposition, and
  platform/security approval.

## 2026-06-19 Follow-Up 156: Ops Readiness Evidence References

### Trigger

Operational readiness could be represented as names, timestamps, and boolean
claims without reviewable references to the actual Azure, database, rollback,
monitoring, approval, or on-call evidence.

### Issues Fixed

- The operational readiness writer now requires `evidenceRefs` for every
  operational claim.
- The strict deploy verifier emits 13 explicit `ops.evidence.*` checks.
- The release evidence bundle preflight now accepts and validates the matching
  `BIDSTACK_OPS_EVIDENCE_*` variables.
- Bundle bridging from `BIDSTACK_OPS_READINESS_FILE` now preserves evidence
  references instead of dropping them.
- Selftests include a poisoned summary-only ops artifact.

### Implementation Map

- `scripts/write-operational-readiness-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `scripts/run-deploy-evidence-bundle.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/write-operational-readiness-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:ops:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore scripts/write-operational-readiness-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `$env:BIDSTACK_DEPLOY_ENV='production'; pnpm deploy:evidence:ops`: expected
  block, fresh production ops artifact written with 34 missing-proof failures.
- `pnpm deploy:evidence:source`: expected block at 405 dirty source entries.
- `pnpm deploy:evidence:source:plan:write`: pass.
- `pnpm deploy:evidence:production`: expected block, 41 pass / 67 fail, with
  all 13 new ops evidence-reference checks active.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops owner approval/proof, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 155: Secret Raw Gitleaks Report Proof

### Trigger

The secret evidence artifact could record clean/current Gitleaks and
full-history-reviewed booleans without preserving the raw Gitleaks JSON reports
that produced those conclusions.

### Issues Fixed

- The secret evidence writer now copies current-commit and full-history raw
  Gitleaks JSON reports into `deploy-evidence/secret-scan-reports/`.
- `deploy-evidence/secret-scan-latest.json` now records those reports under
  `rawReports` and on the matching command summaries.
- Strict deploy verification now requires repo-local parseable JSON for
  `secrets.currentCommitRawReport` and, once full history is reviewed,
  `secrets.fullHistoryRawReport`.
- Verifier selftests now include a poisoned summary-only secret evidence
  artifact.

### Implementation Map

- `scripts/write-secret-scan-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/write-secret-scan-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:secrets:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm exec eslint --no-ignore scripts/write-secret-scan-evidence.mjs scripts/verify-deploy-evidence.mjs`:
  pass.
- `pnpm deploy:evidence:secrets`: expected block on missing historical
  rotation/owner disposition, with raw reports written.
- `pnpm deploy:evidence:source`: expected block at 405 dirty source entries.
- `pnpm deploy:evidence:source:plan:write`: pass.
- `pnpm deploy:evidence:production`: expected block, 41 pass / 54 fail, with
  both secret raw-report checks passing.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 152: Container Raw Trivy Report Proof

### Trigger

The container scan summary could prove zero blocking findings in compact JSON
without requiring the raw Trivy JSON reports that produced the summary.

### Issues Fixed

- The container scanner now writes one raw Trivy JSON report per scanned image.
- The compact container evidence records each image's `rawReportPath`.
- Strict deploy verification rejects compact-only container evidence with the
  new `container.rawReports` check.
- Verifier selftests now include a poisoned compact-only artifact.

### Implementation Map

- `scripts/run-container-vulnerability-scan.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/container-vulnerability-scan-gate.md`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/run-container-vulnerability-scan.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node scripts/run-container-vulnerability-scan.mjs --selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the scanner and verifier: pass.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 161: Source-Backed Technical Stack Add Launchpad

### Trigger

Tony asked for the Technical Stack Overview add experience to feel more premium
and to ensure MCP/provider pulls include Apollo, Seamless.AI, and other valid
attributed sources.

### Issues Fixed

- Populated technical-stack cards now expose a visible source-backed add
  launchpad instead of hiding source pull and manual add behind compact header
  actions.
- The launchpad makes Apollo MCP/API, Seamless.AI MCP/API, configured Tech
  Intel MCPs, and Other attributed sources visible before a user stages manual
  truth.
- The primary launchpad action calls the existing
  `/technical-stack/refresh` backend contract and opens the source review/editor
  flow; it does not invent fake client-only source data.
- The browser spec now seeds a temporary stack only when the chosen account is
  empty, restores original manual stack state in `finally`, scopes repeated
  provider labels to semantic regions, and verifies added vendors by value
  instead of brittle row order.

### Implementation Map

- `apps/web/src/components/cockpit/TechStackCard.tsx`
- `apps/web/src/components/cockpit/TechStackCard.test.tsx`
- `apps/web/src/styles/cockpit.css`
- `apps/web/e2e/technical-stack.spec.ts`
- `docs/solutions/technical-stack-provider-source-pull.md`
- `MISTAKES.md`

### Verification

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  35/35 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/providers/open-data-connectors.test.ts --reporter=dot`:
  35/35 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=181 playwright test e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass, covering the source-backed launchpad, provider refresh response,
  manual add/save persistence, mobile overflow guard, and cleanup.
- `git diff --check -- apps/web/src/components/cockpit/TechStackCard.tsx apps/web/src/components/cockpit/TechStackCard.test.tsx apps/web/src/styles/cockpit.css apps/web/e2e/technical-stack.spec.ts`:
  pass with existing LF/CRLF working-copy warnings.
- `pnpm deploy:evidence:source`: expected block, clean=no, 413 status
  entries.
- `pnpm deploy:evidence:source:plan`: expected block, source current=yes,
  source clean=no, 6 review waves.
- `pnpm deploy:evidence:production`: expected block, 41 passed / 68 failed.

### Remaining Launch Risks

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints.
- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 151: Strict Source Evidence Currentness

### Trigger

The source-review planner detected stale source artifacts, but the strict
deploy verifier only trusted the source-control JSON freshness and its own
recorded clean/dirty fields.

### Issues Fixed

- Strict deploy verification now compares source evidence to the live Git
  worktree.
- The new `source.current` check validates commit, branch, upstream, and full
  status manifest.
- Verifier selftests now initialize a tiny Git repo and include a poisoned
  stale-source fixture.

### Implementation Map

- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`

### Verification

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the verifier: pass.
- `git diff --check -- scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:production`: expected block, 30 pass / 53 fail.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.

## 2026-06-19 Follow-Up 150: Sentry Smoke Trigger Target Proof

### Trigger

The Sentry smoke writer could prove that matching Sentry issues existed, while
the strict verifier did not prove the release API target that produced those
smoke events.

### Issues Fixed

- Sentry smoke artifacts now record `triggerTarget`.
- The Sentry writer rejects missing, local, or placeholder-looking trigger
  targets.
- Strict deploy verification now rejects Sentry evidence whose trigger target
  is missing, local, or placeholder-looking.
- Query-only Sentry evidence remains available for manually triggered smoke
  events, but must still provide the non-local release API target.

### Implementation Map

- `scripts/write-sentry-smoke-evidence.mjs`
- `scripts/verify-deploy-evidence.mjs`
- `docs/solutions/deploy-evidence-hard-gate.md`
- `docs/observability/sentry.md`

### Verification

- `node --check scripts/write-sentry-smoke-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:sentry:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- Targeted ESLint on the Sentry writer and verifier: pass.
- `pnpm deploy:evidence:production`: expected block, 29 pass / 53 fail, now
  including `sentry.target`.

### Remaining Launch Risks

- Current production release evidence is still blocked by dirty source, live
  load/provider/Sentry/browser evidence, ops approval, secret-history
  disposition, immutable container digest refs, and platform/security approval.
