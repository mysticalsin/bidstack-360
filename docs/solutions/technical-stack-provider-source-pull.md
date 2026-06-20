# Technical Stack Provider Source Pull

## Problem

The account cockpit had editable technical stack data, but the source pull
experience was too passive for enterprise account teams. Users needed one
obvious action to check Apollo, Seamless, and public/open company signals, plus
clear feedback about which provider was synced, queued, disabled, or unhealthy.

There was also a backend correctness risk: enrichment refreshes could overwrite
provider metadata as one snapshot and silently drop older Apollo, meeting-note,
or Seamless technology signals.

## Solution

- Add a dedicated technical-stack refresh contract with provider lanes:
  `apollo`, `seamless`, and `open_data`.
- Keep Apollo as an async enrichment lane. If Apollo MCP is configured, report
  the pull as `queued` with `transport: mcp`; otherwise use API queue status or
  mark it disabled/unavailable.
- Read Seamless technologies from existing provider metadata and expose them as
  technical stack items with `source: enrichment:seamless`.
- Merge provider metadata and source attribution during company enrichment
  upserts so a new open-data refresh cannot erase existing Apollo, Seamless, or
  meeting-derived technical stack data.
- Add a source rail in the cockpit card that shows Manual, Apollo, Seamless, and
  Open data statuses before and after a pull.
- Improve the add flow with category presets, category datalist, vendor entry,
  stable 44px icon actions, and source-aware toasts.
- Keep compact source-pull/edit controls at WCAG-size touch targets even when
  the visual treatment is icon-first and premium.
- Treat read-only card mode as a summary. Full stack inspection and editing
  happen in edit mode, so tests should not require every saved category to be
  visible in read-only mode.

## Verification

- Shared schema build covers the new refresh response contract.
- API route tests cover `POST /crm/companies/:companyKey/technical-stack/refresh`
  and provider ids.
- Company enrichment tests cover Seamless technology mapping and Apollo +
  Seamless dedupe by vendor.
- Apollo worker tests cover MCP-first company enrichment behavior and API
  fallback behavior without requiring fake synchronous MCP results.
- Seamless provider tests cover provider metadata technology capture.
- Component tests cover source pull, source rail statuses, edit/add/save, and
  provider suggestion flows.
- Browser E2E covers the real account cockpit source-pull button, provider
  response contract, manual add/save persistence, editor recovery, and cleanup
  of the seeded manual stack.
- Broader Chromium QA should include critical buttons and pipeline stage
  movement so source-stack work does not regress nearby cockpit or board
  controls.

## Commands

- `pnpm --filter @bidstack/shared build`
- `pnpm --filter @bidstack/api exec vitest run src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/companies.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/worker typecheck`
- Targeted API/web/worker ESLint for touched files.
- `pnpm --filter @bidstack/api build`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web exec playwright test e2e/account-detail.spec.ts --project=chromium-desktop`
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`
- `pnpm --filter @bidstack/web e2e -- e2e/critical-controls.spec.ts e2e/flows/pipeline.spec.ts --project=chromium-desktop`

## Residual Risk

Apollo live technology extraction remains asynchronous through the existing
enrichment queue. BuiltWith and Wappalyzer are valid future technology sources,
but they need explicit credential/config plumbing before they should appear as
first-class provider lanes.

## 2026-06-17 MCP-First Seamless + Composer UX Hardening

- Seamless now supports a Streamable HTTP MCP path through `SEAMLESS_MCP_URL`,
  `SEAMLESS_MCP_BEARER_TOKEN`, timeout, and search tool configuration. The
  provider calls MCP first, parses structured/content JSON results, and falls
  back to REST only when the MCP result is absent and API credentials exist.
- The technical-stack refresh route reports the active Seamless transport as
  `mcp` only when the MCP URL is configured; otherwise it reports `api` or a
  disabled/unavailable state.
- The cockpit source rail now includes a Meetings lane, a visible `Check
sources` CTA, and an expanded add composer with manual/source provenance in
  edit mode.
- Read-only mode remains a curated summary, with a show-all toggle for larger
  stacks so enterprise accounts can inspect breadth without opening the editor.
- Browser QA should verify the visible source-pull CTA, source rail, edit
  composer, provenance badges, 44px button geometry, and overflow behavior in
  the real app shell.
- Do not add BuiltWith, Wappalyzer, or other technology-intelligence lanes until
  their credentials, source attribution, rate limits, failure modes, and tests
  are implemented. Showing fake lanes damages trust.

### Verification Delta

- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`
- `pnpm --filter @bidstack/api typecheck`
- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/api exec eslint src/providers/company-seamless-enrichment.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/enrichment.service.ts src/routes/crm/companies.ts src/env.ts`
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx`
- `pnpm --filter @bidstack/api build`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`

## 2026-06-17 Premium Auto Composer Follow-Up

- Adding technology should feel like accepting and curating intelligence, not
  filling a spreadsheet. Edit mode now exposes provider-detected suggestions
  from Apollo, Seamless, open data, and meetings as first-class add buttons.
- Accepted source suggestions keep provenance as
  `manual:accepted:<source>`, so manually curated items still trace back to the
  MCP/API lane that produced the signal.
- The manual composer now supports comma, semicolon, and newline paste input.
  It dedupes against existing and in-draft vendors, auto-categorizes common
  products, and shows a category preview before add.
- The default category is `Auto`. Users can still force a category when they
  know better, but common CRM, cloud, security, DevOps, data, collaboration,
  marketing, and ERP vendors sort themselves on paste.
- Quick-add chips cover common enterprise technologies only after excluding
  already saved vendors and source suggestions, which keeps the rail useful
  instead of noisy.
- Provider state text now distinguishes `No signal` from a generic review
  state when Apollo/Seamless/open data are reachable but do not return stack
  evidence.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`

## 2026-06-17 In-Editor Provider Pull and Live Refresh Hardening

- The Technical Stack edit flow now keeps provider intelligence beside manual
  entry. Users can pull Apollo, Seamless, and open-data sources from inside the
  editor, review provider lanes, see total/review metrics, accept individual
  detected technologies, or accept all current source suggestions at once.
- A successful read-only source pull that returns suggestions opens the editor
  directly, so the user lands in the review context instead of hunting for the
  next action.
- Accepted provider suggestions keep curated provenance as
  `manual:accepted:<source>`. This preserves the line between MCP/API discovery
  and human-approved CRM truth.
- The web refresh mutation now sends an explicit `{}` JSON command body, and
  the API refresh route declares an empty body schema. This keeps browser fetch,
  Fastify validation, and tests aligned for bodyless command-style POSTs.
- Open-data date parsing now validates calendar precision before persistence.
  Unknown month/day values from Wikidata are dropped instead of becoming
  invalid Prisma `Date` writes.
- Live CI Financial source-pull proof after the fix returned HTTP 200 with
  Apollo and Seamless disabled because credentials/MCP endpoints were absent,
  and Open data synced. This is the correct local behavior: real lanes, no fake
  provider data.
- BuiltWith, Wappalyzer, and similar valid technology-intelligence sources
  remain future lanes until credential plumbing, source attribution, rate-limit
  handling, failure semantics, and tests exist.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx src/hooks/apiMutationBodies.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/api test -- src/providers/company-open-enrichment.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/hooks/useCompanyTechnicalStack.ts src/hooks/apiMutationBodies.test.tsx src/styles/cockpit.css`
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/routes/crm/companies.ts src/providers/company-open-enrichment.ts src/providers/company-open-enrichment.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web build`
- In-app browser QA on `http://127.0.0.1:5174/accounts/ci-financial` verified
  the in-editor provider panel, 44px source-pull/save/cancel/remove controls,
  no console errors after pull, and no mobile overflow at 390 x 844.

## 2026-06-17 Generic Tech Intel MCP Lane

- The Technical Stack refresh pipeline now has a real configurable technology
  intelligence MCP lane alongside Apollo, Seamless, and open-data evidence.
- The lane is driven by `TECH_STACK_MCP_URL`,
  `TECH_STACK_MCP_BEARER_TOKEN`, `TECH_STACK_MCP_TIMEOUT_MS`,
  `TECH_STACK_MCP_TOOL`, and `TECH_STACK_MCP_LABEL`. It can front a trusted
  provider such as BuiltWith, Wappalyzer, an internal enrichment service, or a
  private MCP aggregator without hard-coding fake source claims.
- The provider uses Streamable HTTP MCP JSON-RPC, negotiates initialize/tool
  calls, supports JSON and server-sent event responses, and only maps explicit
  technology fields into stack evidence.
- The API refresh contract now reports the `tech_intel` provider lane. It is
  disabled when no MCP URL is configured, unavailable when configured but no
  stack evidence is returned, and synced when attributed technologies are
  present.
- Company serialization merges human/manual stack, meeting-derived stack,
  Apollo, Seamless, Tech Intel MCP, and open-data evidence with provenance
  preserved at the item level.
- The cockpit source rail and editor now expose Tech Intel status, counts,
  accepted-source provenance, and provider suggestion actions alongside Apollo
  and Seamless.
- Refresh POST remains command-style safe: the web sends `{}` and the API route
  accepts an empty body schema, so source pulls work from browser, tests, and
  clients that omit payload fields.

### Verification Delta

- `pnpm --filter @bidstack/shared build`
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/services/crm/company-enrichment.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- Targeted API/web ESLint for touched technical-stack files.
- `pnpm --filter @bidstack/api build`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`

### Residual Risk

- Apollo, Seamless, and Tech Intel source quality still depends on real
  credentials/endpoints in staging or production.
- BuiltWith and Wappalyzer can now be integrated through the generic Tech Intel
  MCP path, but first-class named lanes still require provider-specific
  credentials, rate-limit policy, failure semantics, and tests.
- This closes the local UX/API/browser path for provider-backed stack capture.
  It is not full external certification until staging credentials, monitoring,
  load, security, and production evidence are collected.

## 2026-06-17 Premium MCP Add Workbench

- The Technical Stack edit surface now opens as a two-column intelligence
  workbench: manual stack curation on the left, MCP/API source review on the
  right.
- Manual add now supports multi-line paste, comma/semicolon batches, smart
  category preview, duplicate warning chips, and a richer enterprise catalog
  across cloud, data, CRM, ERP, security, AI, DevOps, collaboration, ITSM,
  marketing, and commerce.
- The source review queue stays visible even when empty. Empty state copy names
  the expected lanes: Apollo MCP, Seamless MCP, Tech Intel MCP, and open data.
- Source suggestions now expose vendor, inferred category, and provenance
  before add. Users can accept one suggestion or accept the visible queue in one
  action.
- Provider transport labels and status language now distinguish MCP-backed
  lanes from direct API/open-data lanes, including `Queued via MCP`,
  `Synced via MCP`, and `Synced via API`.
- No fake named provider integrations were added. BuiltWith, Wappalyzer, and
  private enrichers remain valid through the generic Tech Intel MCP lane until
  first-class provider credentials, rate limits, failure semantics, and tests
  exist.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`

## 2026-06-17 Category-Aware Intake + Confidence Review

- Manual stack intake now preserves category intent in pasted lines such as
  `Security: Okta, CrowdStrike` and `Data - Databricks` instead of flattening
  every pasted vendor into the selected composer category.
- The intake summary shows ready, category, duplicate, and auto/manual
  classification posture so the add state is legible before the user commits.
- Source suggestions are sorted by confidence and provider precedence, and the
  confidence percentage is visible on each review card before a provider signal
  is accepted into curated CRM truth.
- Bulk source acceptance now operates on the full eligible suggestion set, while
  the UI may still render a bounded review grid for density.
- Provider pull copy continues to name Apollo MCP, Seamless MCP, Tech Intel MCP,
  and open data. BuiltWith, Wappalyzer, and private enrichers remain valid
  through the generic Tech Intel MCP lane until first-class provider contracts
  are implemented.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`
- `pnpm --filter @bidstack/web build`
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`

## 2026-06-17 Bulk Intake + Complete Provider Review

- The read-only card CTA now says `Pull sources`, matching the active source
  pull behavior across Apollo, Seamless, Tech Intel MCP, and open data.
- The manual composer accepts dragged text or text-like files (`.csv`, `.tsv`,
  `.txt`, `.md`) through the same category-aware parser as paste input. The
  keyboard path remains the textarea, so drag/drop is additive rather than
  required.
- Compact provider updates now expose a `Review all` command when more than
  the visible suggestion slice is pending. This prevents hidden provider
  signals from being stranded behind a summary card.
- Edit mode now shows provider review counts by lane, so users can see whether
  pending suggestions came from Apollo, Seamless, Tech Intel MCP, or another
  source before accepting them into curated CRM truth.
- The backend provider contract did not need fake lanes: Apollo remains an
  async enrichment queue that uses MCP/API in the worker, while Seamless and
  Tech Intel MCP can sync during refresh when configured. The UI distinguishes
  queued/synced/disabled/unavailable states instead of overclaiming live data.

### Verification Delta

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

### Residual Risk

- Local proof still runs with stub auth and no live Apollo/Seamless/Tech Intel
  credentials. Provider quality, rate-limit behavior, and monitoring require
  staging or production credentials and security approval evidence.

## 2026-06-18 Provider-Filtered Source Inbox

- The edit-mode source review queue now behaves like a provider inbox. Users
  can filter pending stack suggestions by All, Apollo, Seamless, Tech Intel, or
  Other before accepting them into curated CRM truth.
- Source suggestion cards now show the source transport cue (`MCP`, `API`,
  `Queue`, `Open data`, or `MCP/API` fallback) alongside confidence and
  provenance, so the UI distinguishes configured MCP pulls from generic
  source claims.
- `Accept all` is scoped to the currently reviewed provider filter. This keeps
  a Seamless-only review from accidentally accepting Apollo or Tech Intel
  suggestions while the All filter still accepts the complete eligible queue.
- The source-pull provider contract remains unchanged and honest: Apollo runs
  through the enrichment queue with MCP/API transport reporting, Seamless uses
  MCP-first/API fallback, Tech Intel uses the generic configurable MCP lane for
  BuiltWith/Wappalyzer/private enrichers, and open data remains a separate
  verification lane.

### Verification Delta

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
- In-app Browser QA on `http://127.0.0.1:4174/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`:
  desktop and 390px mobile edit-mode geometry had no horizontal overflow and
  all checked controls were at least 44px.

### Residual Risk

- Local proof still uses stub auth and local data. Live source quality requires
  staging/production Apollo, Seamless, and Tech Intel credentials, observed
  provider responses, rate-limit/monitoring evidence, and security approval.

## 2026-06-18 Smart Intake Polish + Provider Quality Gate

- The edit-mode add composer now exposes bulk intake as a first-class drop
  target, with a staged-preview overflow chip and a clear/reset command for
  pasted or dropped vendor batches.
- The empty source queue now offers a source-pull command in place, while the
  provider panel continues to show Apollo, Seamless, Tech Intel MCP, and open
  data lane status.
- Provider pull metrics now include checked lane count, so users can distinguish
  "not checked yet" from "checked but no reviewable stack signal."
- Release evidence now includes
  `deploy-evidence/provider-quality-latest.json`, generated by
  `pnpm deploy:evidence:providers`. The writer calls the live technical-stack
  refresh endpoint and validates required lanes.
- The strict deploy verifier fails closed when Apollo, Seamless, or Tech Intel
  source quality evidence is missing, local, fixture-only, or weak.
- BuiltWith, Wappalyzer, private enrichers, and other valid sources remain
  supported through the generic Tech Intel MCP lane until first-class provider
  contracts are implemented.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  17/17 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`
  against the reused local web/API pair: 1/1 pass.
- Browser QA desktop + 390px mobile: no horizontal overflow; scanned controls
  are 44px or larger.
- `pnpm deploy:evidence:providers:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:providers` without live release env: expected block.
- `pnpm deploy:evidence:production`: expected block now includes provider
  quality failures until live staging/production credentials are supplied.

## 2026-06-18 Apollo MCP Honesty + Source Inbox Overflow

- Apollo refresh status now only reports `transport: mcp` when both
  `APOLLO_MCP_URL` and `APOLLO_MCP_BEARER_TOKEN` are configured. A partial MCP
  configuration is reported as `unavailable` with an explicit remediation
  message, while `APOLLO_API_KEY` still enables the REST/API queue path.
- This prevents the Technical Stack Overview from overclaiming Apollo MCP
  readiness when only one MCP credential is present.
- The source review inbox now calls out when a provider-filtered queue has more
  results than the dense visible card grid. The UI shows the first eight cards
  for scannability, but the status line tells users that `Accept all` applies
  to the full reviewed provider filter.
- The overflow status keeps large Apollo, Seamless, and Tech Intel pulls
  trustworthy: users can review by provider, see transport posture, and
  understand exactly what bulk acceptance will do.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  18/18 pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  29/29 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css`:
  pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/routes/crm/companies.ts src/routes/crm/companies.test.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm deploy:evidence:providers:selftest`: pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Residual Risk

- Local proof still uses stub auth and local data. Production-grade source
  quality still requires live Apollo, Seamless, and Tech Intel credentials,
  observed provider responses, rate-limit/monitoring evidence, and security
  approval.

## 2026-06-18 Safer Source Staging + Queued Pull Freshness

- The source review queue now keeps bulk staging scoped to what the user can
  see. When a provider-filtered inbox has more than eight suggestions, the
  action becomes `Accept visible` and stages only the visible cards.
- This supersedes the earlier all-filter behavior for capped inboxes: users
  can still filter by Apollo, Seamless, Tech Intel, or All, but hidden provider
  rows are never silently moved into the curated draft.
- Compact provider updates now always expose `Review all`, even for one source
  suggestion, so the full provenance workbench is reachable without needing a
  large queue.
- The source rail no longer says Apollo, Seamless, or Tech Intel are `Ready`
  before a source check. Unchecked MCP-capable lanes show `Check MCP` unless
  existing provider or suggestion evidence is present.
- Apollo can be asynchronous because the refresh route queues the enrichment
  worker. After a queued provider pull, the card now polls the technical-stack
  state for up to one minute so completed MCP/API results can appear without a
  logout/login or hard reload.
- Source cards received provider-specific edge accents and reduced-motion-safe
  hover/active feedback. The animation is only on the review action surface,
  not on the data itself.

### Verification Delta

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
  1/1 pass against managed API plus production preview.
- In-app Browser QA on
  `http://127.0.0.1:4174/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`:
  Technical Stack region mounted, editor opened, provider pull/source queue
  rendered, `Check MCP` unchecked state appeared, unsaved technology staged,
  cancel exited editing, and browser console errors were empty.

### Residual Risk

- Local proof still uses stub auth and local data. Live source quality and
  credit/rate-limit posture still require staging/production Apollo, Seamless,
  and Tech Intel MCP credentials plus provider-quality release evidence.

## 2026-06-18 Live Review Count Honesty

- The edit-mode provider pull panel now counts only source suggestions that are
  still unstaged in the current draft.
- When a user accepts an Apollo, Seamless, Tech Intel MCP, or other provider
  card into the curated stack, the `to review` metric drops immediately before
  save.
- This keeps the source inbox honest: server suggestions can remain pending
  until persistence, but the visible workflow reflects what the user has
  already staged for approval.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  18/18 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  29/29 pass.
- `pnpm --filter @bidstack/api exec eslint --no-ignore --no-warn-ignored src/providers/company-tech-stack-mcp.ts src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.ts src/providers/company-seamless-enrichment.test.ts src/services/crm/company-enrichment.service.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.ts src/routes/crm/companies.test.ts`:
  pass.
- `pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

## 2026-06-18 Multiple Tech Intel MCP Sources

- Tech Intel no longer has to be a single aggregator endpoint. The backend keeps
  the legacy `TECH_STACK_MCP_URL` path, and also supports
  `TECH_STACK_MCP_SOURCE_IDS` with per-source variables such as
  `TECH_STACK_MCP_BUILTWITH_URL` and `TECH_STACK_MCP_WAPPALYZER_URL`.
- Each configured Tech Intel MCP is called independently. One empty or failing
  source does not erase a successful provider result from another configured
  source.
- Company metadata stores both the legacy combined `techStackMcp` profile and a
  new `techStackMcps` array. Serialization turns the array into separate
  provider-labeled categories such as `BuiltWith MCP technologies` and
  `Wappalyzer MCP technologies`, while the UI continues to group them under the
  honest Tech Intel review lane.
- This keeps Apollo as the async MCP/API queue, Seamless as MCP-first/API
  fallback, and Tech Intel as the extensible path for valid stack sources
  without showing fake first-class lanes before their rate limits, credentials,
  and evidence policy are known.

### Verification Delta

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
- Targeted web ESLint for Technical Stack files: pass.
- In-app browser smoke on the running preview verified Technical Stack render,
  edit workbench, source-pull button, provider checked-state update, and empty
  console errors.
- `E2E_REUSE_SERVER=1 pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass against the already-running preview.

## 2026-06-18 Named Tech Intel Evidence Gate

- Provider-quality release evidence can now require exact Tech Intel MCP source
  labels with `BIDSTACK_PROVIDER_QUALITY_TECH_INTEL_SOURCES` or
  `BIDSTACK_DEPLOY_REQUIRED_TECH_INTEL_SOURCES`.
- The provider writer preserves display labels such as `BuiltWith MCP` and
  `Wappalyzer MCP`, records observed Tech Intel source labels/source keys, and
  fails if a configured expected source has no attributed technology signal.
- The strict deploy verifier now checks named Tech Intel source coverage in
  addition to the generic `tech_intel` lane. A release artifact that proves only
  BuiltWith will not pass when Wappalyzer was declared required.
- Bundle preflight now asks for the required Tech Intel source list before
  spending time on live evidence, and the release env template names the
  expected BuiltWith/Wappalyzer source labels explicitly.
- This keeps the UX promise honest: Apollo remains queued through MCP/API,
  Seamless remains MCP-first/API fallback, and the Tech Intel lane can aggregate
  valid MCP sources while release evidence proves the named sources actually
  responded.

### Verification Delta

- `node --check scripts/write-provider-quality-evidence.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:providers:selftest`: pass, including the missing named
  source failure fixture.
- `pnpm deploy:evidence:selftest`: pass, including deploy-verifier rejection
  when Wappalyzer is required but absent.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-provider-quality-evidence.mjs scripts/verify-deploy-evidence.mjs scripts/run-deploy-evidence-bundle.mjs`:
  pass.
- `pnpm deploy:evidence:preflight:production`: expected block in the current
  shell, now including `preflight.providers.techIntelSources`.

## 2026-06-18 Import-Ready Technical Stack Workbench

- The edit-mode Technical Stack workbench now treats file import as a first-class
  add path beside paste and drag/drop. Users can import CSV, TSV, TXT, or MD
  stack lists through a visible 44px button, then review the parsed preview
  before committing anything to curated CRM truth.
- The same category-aware parser is shared across paste, dropped text/files,
  and file import, so entries like `Marketing: Marketo` and
  `Commerce: Shopify` preserve category intent.
- Provider pull copy now states the actual contract: Apollo and Seamless are
  MCP-first/API-capable lanes, Tech Intel can include every configured MCP
  source, and open data stays separate.
- The provider workbench layout now lets pull metrics wrap under the provider
  title, avoiding narrow-card crowding while preserving the dense cockpit look.
- No fake first-class provider was added. BuiltWith, Wappalyzer, and other valid
  sources continue to flow through the configured Tech Intel MCP source list and
  named provider-quality evidence gate.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  21/21 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  20/20 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `E2E_REUSE_SERVER=1 pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass against `http://127.0.0.1:4174` and API
  `http://127.0.0.1:4010`.
- In-app Browser QA on the rebuilt preview verified the Technical Stack region,
  source pull button, edit workbench, import button, MCP/API source copy,
  provider pull panel, zero console errors, and no page-level horizontal
  overflow.

## 2026-06-18 Staged Add Command + Named MCP Source Labels

- The Technical Stack editor add path now reads as a staged workflow instead of
  an icon-only utility. The command shows `Stage` / `Stage N`, keeps the
  accessible name `Add vendor`, and exposes live intake status for ready,
  duplicate, auto-route, and manual-category states.
- Duplicate entry feedback is visible before commit: re-entering an existing
  staged vendor disables the add command and increments the duplicate counter
  instead of creating a junk row.
- The mobile editor keeps the staged add command at a 44px touch target and
  avoids page-level horizontal overflow in the dense account cockpit.
- The refresh provider label now names configured Tech Intel MCP sources, for
  example `BuiltWith MCP + Wappalyzer MCP`, rather than collapsing every source
  into a generic count. This makes it clear which valid MCPs are actually wired
  behind the Tech Intel lane.
- The source model remains honest: Apollo and Seamless stay MCP/API lanes,
  Tech Intel aggregates configured valid MCP sources, and open data remains a
  separate profile lane.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  21/21 pass.
- `pnpm --filter @bidstack/api test -- src/routes/crm/companies.test.ts apps/api/src/providers/company-tech-stack-mcp.test.ts apps/api/src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  company-route coverage pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  9/9 pass.
- Targeted web/API/script ESLint: pass.
- Web and API `tsc --noEmit`: pass.
- Web and API builds: pass.
- `$env:E2E_PORT_OFFSET='141'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on `http://127.0.0.1:5173` verified source pull provider
  states, edit mode, staged vendor add, duplicate guard, save/persist/restore,
  and mobile 390px no-overflow behavior.

## 2026-06-18 Source-Lane Filters + MCP Payload Tolerance

- The edit-mode provider lane chips are now actionable review filters. Apollo,
  Seamless, and Tech Intel lanes can focus the source inbox when that lane has
  reviewable suggestions, while disabled/empty lanes remain non-destructive.
- Tech Intel suggestion labels now preserve named MCP sources in the UI. A
  source such as `enrichment:tech_stack_mcp:builtwith_mcp` renders as
  `BuiltWith MCP`, and accepted manual provenance remains
  `manual:accepted:enrichment:tech_stack_mcp:builtwith_mcp`.
- The generic Tech Intel MCP parser now accepts real-world provider payloads
  beyond simple arrays: object maps such as `{ "React": {...} }`,
  `detectedTechnologies`, `applications`, and `apps`.
- Provider lane chips were raised to 44px touch targets after browser QA caught
  the old 30px chip height becoming an interactive button. Disabled buttons
  still meet the target so mobile layout does not regress.
- The provider model stays honest: Apollo remains queued through MCP/API,
  Seamless remains MCP-first/API fallback, Tech Intel aggregates configured
  valid MCP sources such as BuiltWith/Wappalyzer/private enrichers, and Open
  data stays separate.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  21/21 pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/services/crm/company-enrichment.service.test.ts src/services/crm/technical-stack.service.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  30/30 pass.
- Targeted web/API ESLint for touched technical-stack files: pass.
- Web/API `tsc --noEmit`: pass.
- Web/API builds: pass.
- In-app Browser QA on `http://127.0.0.1:4174/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`:
  source pull updated provider statuses in-place, editor provider lanes rendered
  as review buttons, desktop overflow was 0, mobile 390px overflow was 0, all
  sampled Technical Stack buttons were at least 44px, and console errors were
  empty.
- `E2E_REUSE_SERVER=1 pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass against preview/API.

## 2026-06-18 Guided Add Feedback + Narrow Cockpit Geometry

- The Technical Stack editor now gives immediate visual feedback after any
  add path. Manual staging, quick suggestions, one-click provider suggestions,
  and visible provider bulk accept all populate a `Recently staged stack
  entries` tray before save.
- The staged tray shows up to six freshly added technologies with their source
  or category. This closes the old ambiguity where a user clicked a source/add
  command and had to infer whether anything changed.
- Quick suggestions now use the active comma/newline token instead of the full
  pasted list. Typing `Salesforce, tab` now suggests `Tableau` instead of going
  dead because `Salesforce, tab` was treated as one search string.
- The add intake form now stacks category, vendor entry, clear, and stage
  controls inside narrow account cockpit columns. Browser geometry caught the
  previous four-column layout squeezing the real vendor textarea to about 22px
  wide even while page-level overflow checks passed.
- The provider source contract stays honest. Apollo remains a queued MCP/API
  lane, Seamless remains MCP-first with API fallback, Tech Intel aggregates
  configured named MCP sources such as BuiltWith/Wappalyzer/private enrichers,
  and open data stays a separate profile lane.

### Verification Delta

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
- In-app Browser QA on
  `http://127.0.0.1:5335/accounts/5a70fba7-262f-44b5-8cfc-1e55d39b98f1`
  verified Apollo, Seamless, Tech Intel, and open-data source lanes; provider
  source pull UI; quick suggestion staging for `Salesforce, tab`; desktop and
  390px mobile no-overflow behavior; 44px stage control; and the fixed
  full-width vendor textarea inside the real cockpit card.

## 2026-06-18 Source Readiness Map for MCP/API Trust

- The edit-mode provider panel now includes a `Source readiness map` that makes
  each provider lane scan like an operator checklist: provider name, transport
  posture, latest status, and next action.
- The map distinguishes `MCP first`, `API fallback`, `MCP required`, and
  `Valid open data` instead of hiding all source health behind generic
  "checked" copy.
- Reviewable provider rows are actionable and focus the same filtered source
  queue as the provider lane chips. Non-reviewable rows stay disabled but still
  explain whether the lane is connected, polling, missing credentials, or
  waiting for setup.
- The source truth remains unchanged: Apollo queues through MCP when fully
  configured and otherwise through the API lane, Seamless is MCP-first with API
  fallback, Tech Intel aggregates configured named MCP sources, and open data is
  a separate valid source lane.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`:
  pass.
- `git diff --check -- apps/web/src/components/cockpit/TechStackCard.tsx apps/web/src/styles/cockpit.css apps/web/src/components/cockpit/TechStackCard.test.tsx`:
  pass with LF/CRLF warnings only.
- `$env:E2E_PORT_OFFSET='163'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass. The browser flow now asserts source pull, source readiness map,
  open-data validity, manual add, save, and persistence.

## 2026-06-18 Source Pull Opens Workbench + Provider Export Intake

- The `Pull sources` action now lands users directly in the source-assisted
  editing workbench after a successful provider refresh. Users no longer need
  to infer that Apollo, Seamless, Tech Intel MCP, or open-data signals were
  checked and then click `Edit technical stack` as a second step.
- Structured provider exports now parse as source data instead of flat vendor
  text. CSV/TSV rows with headers such as `technology,category,source`,
  `vendor,type`, or `application,stack category` stage the technology name and
  category while skipping header/source columns.
- Existing fast paste behaviors remain supported: `Salesforce, Tableau`,
  `Security: Okta, CrowdStrike`, and `Data - Databricks` still work as
  freeform operator intake.
- The provider model stays explicit: Apollo is the queued MCP/API lane,
  Seamless is MCP-first with API fallback, Tech Intel aggregates configured
  named MCP sources such as BuiltWith/Wappalyzer/private enrichers, and open
  data remains a separate verification lane.

### Verification Delta

- `pnpm --filter @bidstack/web test -- TechStackCard.test.tsx`: 23/23 pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx e2e/technical-stack.spec.ts`:
  pass.
- `pnpm --filter @bidstack/api test -- company-tech-stack-mcp.test.ts company-seamless-enrichment.test.ts companies.test.ts`:
  27/27 pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_PORT_OFFSET='191'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass with managed fresh API/web servers.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  verified desktop and 390px mobile source pull, immediate workbench open,
  source readiness map, structured provider export staging, 44px controls, no
  horizontal overflow, and empty console errors.

## 2026-06-18 Provider Scorecards + Full-Filter Acceptance

- The source review queue now includes compact scorecards for every provider
  with pending stack suggestions. Each card shows count, average confidence,
  and the highest-confidence vendor, so Apollo, Seamless, Tech Intel MCP, and
  other valid source lanes can be triaged before acceptance.
- Bulk acceptance now applies to the active source filter, not just the visible
  eight-card grid. The grid stays dense for scanability, while `Accept all` or
  `Accept <provider>` stages the full eligible queue for that filter.
- Provider scorecards use the same filter model as the tabs and readiness-map
  rows. Clicking a scorecard focuses that source lane and updates the bulk
  action label/aria copy accordingly.
- Overflow copy now states that the visible grid is only a preview and that
  bulk acceptance stages the full current source filter.
- The backend source contract remains unchanged and honest: Apollo is MCP-first
  when fully configured and otherwise queued through the API lane, Seamless is
  MCP-first with API fallback, Tech Intel aggregates configured named MCP
  sources such as BuiltWith/Wappalyzer/private enrichers, and open data remains
  separate.

### Verification Delta

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
  1/1 pass with managed fresh API/web preview.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  verified desktop and 390px mobile workbench geometry, source readiness map,
  no horizontal overflow, no region overflow, and all measured Technical Stack
  buttons at 44px or larger. Local provider rows honestly showed Apollo,
  Seamless, and Tech Intel as not configured while open data synced.

## 2026-06-18 Review-Ready Source Lanes + Fast Stage

- Edit mode now derives provider lane readiness from pending source suggestions
  when the current refresh response is absent. Existing Apollo, Seamless, and
  Tech Intel MCP/API suggestions therefore show as review-ready lanes instead
  of stale "not checked" rows.
- Apollo and Seamless inferred review rows show `MCP/API pull`; Tech Intel
  inferred rows show `MCP first`. This keeps source truth honest when the exact
  prior transport is not available in local component state.
- The vendor textarea now supports Ctrl+Enter / Cmd+Enter staging, while the
  visible Stage button remains the primary accessible command.
- Existing button, import, drag/drop, source pull, scorecard filtering, and
  bulk accept behavior remains unchanged.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  24/24 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `$env:E2E_PORT_OFFSET='309'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on
  `http://127.0.0.1:5381/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  verified desktop source pull posture, 44px pull/save/cancel/import controls,
  no console errors, no horizontal overflow, and 390px mobile layout with a
  269px vendor input and visible source readiness map. Browser text injection
  was blocked by the local virtual clipboard bridge, so fast-stage behavior is
  covered by component tests rather than in-app typing.

## 2026-06-19 Inline Source-Backed Add Matches

- The manual add composer now checks the active vendor token against pending
  provider suggestions and shows compact source-backed matches inline. Users
  typing `aw` can accept `AWS` from Apollo directly instead of creating a
  manual-only duplicate.
- Inline match acceptance uses the same accepted-provider provenance as the
  source review queue: `manual:accepted:<provider-source>`. This preserves the
  audit trail for Apollo, Seamless, Tech Intel MCP, and other valid providers.
- The inline match row is intentionally absent when no provider suggestions are
  available, keeping local not-configured environments honest.
- Mobile polish: the curated-stack title/subtitle is explicitly stacked so the
  workbench does not visually collide at 390px.

### Verification Delta

- New regression first failed because `Provider-backed technology matches` did
  not exist in the composer, then passed after the UI change.
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
  verified desktop edit mode, source readiness map, manual add preview, 44px
  controls, no horizontal overflow, empty console errors, and 390px mobile
  title/subtitle separation. The live seed had no pending provider suggestions,
  so inline source-backed matches are covered by the component regression rather
  than live browser data.

## 2026-06-19 Mid-Edit Pull Preservation + Named Single-MCP Provenance

- Source refreshes from inside edit mode now preserve the user's in-progress
  draft. Pulling Apollo, Seamless, Tech Intel MCP, and open data can update the
  source readiness map without erasing a manually staged technology.
- When the user is not already editing, `Pull sources` still opens the workbench
  with the refreshed effective stack.
- Single configured Tech Intel MCP sources now keep their provider-specific
  provenance, for example `enrichment:tech_stack_mcp:builtwith_mcp`, instead of
  collapsing to generic `enrichment:tech_stack_mcp`.
- This keeps both UX trust and audit truth intact: provider pulls are safe to run
  mid-composition, and a one-source MCP deployment still shows the actual source
  label downstream.

### Verification Delta

- New component regression first failed because a mid-edit provider pull removed
  the unsaved `QA` draft entry, then passed after the draft-preservation guard.
- New API regression first failed because a single `BuiltWith MCP` profile
  serialized as generic `enrichment:tech_stack_mcp`, then passed after provider
  slug preservation.
- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/web exec eslint src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api test -- src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  5/5 pass.
- `pnpm --filter @bidstack/api test -- src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts --reporter=dot`:
  9/9 pass.
- `pnpm --filter @bidstack/api exec eslint src/services/crm/company-enrichment.service.ts src/services/crm/company-enrichment.service.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/api exec tsc --noEmit --pretty false`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='464'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on
  `http://127.0.0.1:5173/accounts/20086dc4-4ac4-441b-9c30-b33abdcca98d`
  verified desktop edit mode, manual draft staging, in-editor source pull,
  preserved unsaved vendor value, source readiness map for Apollo, Seamless,
  Tech Intel MCP, and open data, and empty browser console errors. Screenshot:
  `D:\BIDCRM\deploy-evidence\browser-screenshots\technical-stack-mid-edit-pull-preserves-draft-2026-06-19.png`.

## 2026-06-19 Source-Aware Stage Command

- The normal Stage command is now source-aware. If a user types a vendor that
  exactly matches a pending Apollo, Seamless, Tech Intel MCP, or other valid
  provider suggestion, the staged entry uses the provider suggestion category
  and saves as `manual:accepted:<provider-source>` instead of manual-only data.
- The intake summary now shows source-match count, and the add preview names
  the matched provider such as Apollo before the user commits the staged entry.
- The existing source-backed match chips remain available for partial matches,
  but users no longer have to discover a separate control to preserve provider
  provenance when they already typed the exact technology name.
- The provider model remains unchanged: Apollo is queued through MCP/API,
  Seamless is MCP-first with API fallback, Tech Intel aggregates configured
  named MCP sources, and open data is a separate verification lane.

### Verification Delta

- New regression first failed because typing `AWS` and pressing Stage produced
  a manual-only entry instead of `manual:accepted:enrichment:apollo`.
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
  `http://127.0.0.1:4212` verified the Technical Stack editor, staged add
  feedback, desktop/mobile no-overflow, 44px controls, and empty console
  errors. Screenshots:
  `D:\BIDCRM\deploy-evidence\browser-screenshots\technical-stack-source-aware-add-desktop-2026-06-19.png`
  and
  `D:\BIDCRM\deploy-evidence\browser-screenshots\technical-stack-source-aware-add-mobile-2026-06-19.png`.

## 2026-06-19 Source-First Add Assistant

- The add composer now leads with source evidence instead of manual entry copy.
  The first available action in the composer can pull provider sources, then the
  same surface shows provider coverage for Apollo, Seamless.AI, Tech Intel MCP,
  and open data.
- Exact source-backed matches can be accepted directly from the add assistant.
  Accepted rows keep provider provenance as `manual:accepted:<provider-source>`
  and avoid creating manual-only duplicates when Apollo, Seamless, or another
  configured MCP has already found the technology.
- The backend source contract remains provider-first: Apollo can pull through
  MCP or API, Seamless can pull through MCP or API, Tech Intel can aggregate
  named MCP sources such as BuiltWith or Wappalyzer, and open data stays its own
  validation lane.
- The intake summary now uses five stable columns for five metrics, and mobile
  source chips/drop-cue copy wrap instead of truncating at 390px.
- Local browser QA without provider credentials correctly showed Apollo,
  Seamless, and Tech Intel MCP lanes as disabled/not configured while open data
  synced. Live credentialed provider staging evidence is still required for the
  release gate.

### Verification Delta

- New component assertions cover the source-first assistant, provider coverage
  lanes, the in-composer `Pull MCPs` action, and direct accepted-match
  provenance.
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
  verified desktop edit mode, the source-first assistant, provider coverage
  lanes, the in-composer source pull button, status/toast feedback after pull,
  no sub-40px stack controls, and 390px mobile wrapping with no overflow.

## 2026-06-19 Accepted-Source Proof Polish

- The add composer now recommends the strongest provider-backed suggestion
  before the user types, so Apollo, Seamless.AI, Tech Intel MCP, or open-data
  evidence gets a clear first-class path into the draft.
- Accepted source-backed rows now produce a compact pre-save proof strip with
  provider counts. Users can see that accepted Apollo/Seamless/MCP evidence is
  ready to save instead of hunting through the draft list.
- The composer copy now says `Pull sources` instead of `Pull MCPs`, because the
  flow checks Apollo MCP/API, Seamless MCP/API, configured Tech Intel MCPs, and
  open data.
- Local browser QA still correctly shows Apollo, Seamless.AI, and Tech Intel
  MCP as not configured without credentials while open data syncs. That is
  expected local behavior, not provider proof for release.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  28/28 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/worker test -- company-enrich-apollo.test.ts`:
  22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_PORT_OFFSET='31'; pnpm --filter @bidstack/web e2e -- technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.
- In-app Browser QA on `http://127.0.0.1:5174/accounts/ci-financial`
  verified desktop edit mode, mobile 390px edit mode, provider pull loading and
  settled states, Apollo/Seamless/Tech Intel/open-data lanes, no horizontal
  overflow, no clipped source text, and no visible touch targets below 44px in
  the Technical Stack card. Browser screenshot capture timed out, so this pass
  relies on DOM/layout metrics and the Playwright E2E screenshot-capable flow.

## 2026-06-19 Guided Source Verification Add

- The add composer now shows a source verification guide whenever a user types
  or imports a technology. The guide sits next to the normal Stage path, so the
  user sees the source-check decision at the exact add moment.
- Before provider lanes are checked, the guide offers one contextual source
  action wired to the existing refresh mutation for Apollo MCP/API, Seamless
  MCP/API, configured Tech Intel MCPs, and open data.
- When an exact typed technology matches a pending provider suggestion, the
  guide explains that Stage will keep provider provenance instead of creating a
  manual-only entry.
- Browser E2E now asserts guide visibility, the 390px mobile no-overflow
  contract, and 44px minimum touch targets around the guide controls.
- The provider contract stays honest: named valid third-party sources come
  through the configured Tech Intel MCP source list, not hard-coded fake UI
  lanes.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx -t "guides typed technologies|exact provider matches" --reporter=dot`:
  2/2 selected tests pass.
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
  1/1 pass, including guide visibility, mobile no-overflow, 44px guide
  controls, add/save/persist, and cleanup.

## 2026-06-19 Source-Aware Staging Review

- The add composer now includes a source-aware staging review before the Stage
  command. Each typed or imported technology is classified as source-backed,
  manual after checked sources, needs source pull, or duplicate.
- Exact Apollo, Seamless.AI, Tech Intel MCP, and other provider matches continue
  to save as `manual:accepted:<provider-source>`.
- When provider lanes have been checked but no exact match exists, the review
  explicitly says the staged entry will be manual truth instead of implying a
  provider-backed signal.
- When no provider pull has happened yet, the review points the user back to
  the existing source refresh path for Apollo MCP/API, Seamless MCP/API,
  configured Tech Intel MCPs, and open data.
- No fake first-class BuiltWith/Wappalyzer lanes were added. They remain valid
  through configured named Tech Intel MCP sources until provider-specific
  credentials, rate limits, failure semantics, and tests exist.

### Verification Delta

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
  1/1 pass, including source pull, provider lane ids, manual add/save
  persistence, mobile no-overflow, and 44px guide controls.

## 2026-06-19 Best-Source Exact Match Provenance

- Exact typed and inline source-backed matches now dedupe provider suggestions
  by vendor with an explicit best-source-first rule. If Seamless has stronger
  evidence than Apollo for the same typed vendor, the composer stages the
  Seamless-backed source instead of whichever duplicate happened to overwrite
  the lookup map.
- Source-backed staging now uses the provider's canonical technology name when
  an exact match exists. A rough typed value such as `servicenow` saves as
  `ServiceNow` when the provider source reports that canonical name.
- Composer copy now names configured Tech Intel MCPs and other valid source
  matches without pretending BuiltWith, Wappalyzer, or private enrichers are
  standalone lanes unless they are actually configured behind the Tech Intel MCP
  contract.
- The backend source contract remains unchanged: Apollo can pull via MCP/API,
  Seamless can pull via MCP/API, Tech Intel can aggregate configured named MCP
  sources, and open data remains a separate validation lane.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx -t "strongest source" --reporter=dot`:
  1/1 selected test pass.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  32/32 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  34/34 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='742'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass, covering source pull, provider lane ids, manual add/save
  persistence, mobile no-overflow, and 44px guide controls.

### Residual Risk

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints. This slice proves UI/source-lane correctness and duplicate-source
  provenance selection.

## 2026-06-19 Other Attributed Source Add Proof

- The add composer now keeps attributed provider suggestions that do not belong
  to Apollo, Seamless.AI, configured Tech Intel MCPs, open data, meeting notes,
  or Omniscient as a visible `Other sources` review lane.
- Unknown accepted source IDs now render as readable labels instead of generic
  `Accepted` proof. For example, `enrichment:partner_scan` is shown as
  `Partner Scan` in the source review and saved source proof.
- Exact typed matches from those attributed suggestions still save with the
  original provenance as `manual:accepted:<source>`, so source evidence is not
  lost when a user stages the technology manually.
- The backend refresh contract remains strict: Apollo and Seamless can pull via
  MCP/API, Tech Intel aggregates configured named MCP sources such as BuiltWith,
  Wappalyzer, or private enrichers, and open data remains its own validation
  lane. The UI-only `Other sources` lane is derived from already-attributed
  suggestions and does not invent a provider endpoint.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx -t "other attributed" --reporter=dot`:
  1/1 selected test pass.
- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  33/33 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  34/34 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='781'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass, covering source pull, provider lane ids, manual add/save
  persistence, mobile no-overflow, and 44px guide controls.

### Residual Risk

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints. This slice proves that the composer preserves and displays every
  attributed source it receives.

## 2026-06-19 Empty-State Source Start

- Empty technical-stack states now start with a source-backed decision panel
  instead of a passive blank state.
- The panel exposes Apollo, Seamless.AI, configured Tech Intel MCPs, open data,
  and Other sources as visible lanes before the user adds the first technology.
- The primary empty-state action calls the existing source refresh mutation, so
  Apollo remains queued through MCP/API, Seamless and Tech Intel remain backend
  source contracts, and no fake provider endpoint is invented.
- Read-only card mode now has a visible `Add stack` secondary CTA beside `Pull
  sources`, while preserving the existing edit affordance and accessible labels.
- Manual entry remains available from the empty state so human truth can be
  recorded even when provider credentials are disabled or unavailable.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  34/34 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  34/34 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  22/22 pass.
- `pnpm --filter @bidstack/shared build`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `$env:E2E_AUTH_MODE='stub'; $env:E2E_PORT_OFFSET='819'; pnpm --filter @bidstack/web e2e -- e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass, covering source pull, provider lane ids, manual add/save
  persistence, mobile no-overflow, and 44px guide controls.

### Residual Risk

- Local QA still cannot certify live Apollo, Seamless.AI, BuiltWith,
  Wappalyzer, or private Tech Intel MCP extraction without real staging
  credentials and endpoints. This slice proves the start-flow UX and existing
  provider contract wiring.

## 2026-06-19 Populated Stack Launchpad and Browser QA Hardening

- Populated technical-stack cards now show a source-backed add launchpad before
  the category pills, so adding stack data starts with evidence review instead
  of manual typing.
- The launchpad keeps Apollo MCP/API, Seamless.AI MCP/API, configured Tech
  Intel MCPs, and Other attributed sources visible as source lanes.
- The primary launchpad CTA calls the existing `technical-stack/refresh`
  mutation and opens the existing source review/editor path; Other sources stay
  derived from already-attributed suggestions rather than a fake provider.
- Browser QA now seeds a temporary stack only when the selected account is empty
  and restores the original manual stack after the test.
- E2E assertions scope repeated provider labels to semantic regions and verify
  staged vendor values instead of assuming a fixed `Vendor 1 in QA` row.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  35/35 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css e2e/technical-stack.spec.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/routes/crm/companies.test.ts src/services/crm/technical-stack.service.test.ts src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/providers/open-data-connectors.test.ts --reporter=dot`:
  35/35 pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_PORT_OFFSET=181 playwright test e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass.

### Residual Risk

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints. This slice proves the source-backed add UX and provider contract
  behavior.

## 2026-06-19 Guided Add Command + Apollo MCP Queue Honesty

- The Technical Stack editor now has a guided add command above the intake
  area. It gives the user one best next action: pull sources, accept the best
  source-backed match, stage typed entries, or jump back to intake.
- The guide keeps source posture visible while the user adds data: Apollo,
  Seamless.AI, configured Tech Intel MCPs, open data, and Other attributed
  sources remain real lanes or derived attributed evidence.
- Source-backed accepts still preserve provenance as
  `manual:accepted:<source>`, so curated CRM truth keeps the provider trail.
- Apollo queueing is now honest across API and worker code. Apollo MCP is
  runnable only when both `APOLLO_MCP_URL` and `APOLLO_MCP_BEARER_TOKEN` are
  configured. REST fallback requires `APOLLO_API_KEY` plus a company domain.
  Partial MCP config is skipped/unavailable instead of pretending a queued job
  can read provider signals.
- Seamless remains MCP/API backed, Tech Intel MCP remains the extension point
  for named valid sources such as BuiltWith, Wappalyzer, or private enrichers,
  and open data remains a separate validation lane.
- Technical Stack E2E now includes a scoped critical/serious axe scan against
  the editor after the source refresh path is visible.

### Verification Delta

- `pnpm --filter @bidstack/web test -- src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  35/35 pass.
- `pnpm --filter @bidstack/api test -- src/routes/crm/companies.test.ts src/providers/company-tech-stack-mcp.test.ts src/services/crm/technical-stack.service.test.ts src/services/crm/company-enrichment.service.test.ts --reporter=dot`:
  32/32 pass.
- `pnpm --filter @bidstack/worker test -- src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  24/24 pass.
- Targeted ESLint for touched web, API, worker, and E2E files: pass.
- `pnpm --filter @bidstack/web typecheck`: pass.
- `pnpm --filter @bidstack/api typecheck`: pass.
- `pnpm --filter @bidstack/worker typecheck`: pass.
- `pnpm --filter @bidstack/web build`: pass.
- `pnpm --filter @bidstack/web exec cross-env E2E_REUSE_SERVER=1 playwright test e2e/technical-stack.spec.ts --project=chromium-desktop`:
  1/1 pass, including source pull, provider lane ids, manual add/save
  persistence, mobile no-overflow, cleanup, and the scoped axe scan.

### Residual Risk

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints. This slice proves guided add UX, source provenance handling, and
  Apollo queue readiness honesty.

## 2026-06-19 Source Assistant Status Chips

- The Technical Stack source-first add assistant now shows each provider lane's
  transport, current pull state, and next action directly in the add workflow.
  Users no longer have to cross-reference the readiness map to understand
  whether Apollo is queued through MCP/API, Seamless synced through MCP/API,
  Tech Intel MCP is unavailable/disabled, or open data is settled.
- The provider chips use an auto-fit grid with a readable minimum width. Browser
  QA caught the first pass squeezing four multi-line chips to roughly 67px in a
  dense account card; the final grid measured 139px desktop and 256px mobile
  with no horizontal overflow.
- The backend source contract remains unchanged and honest: Apollo pulls via
  MCP/API queue readiness, Seamless prefers MCP with API fallback, configured
  named Tech Intel MCPs carry BuiltWith/Wappalyzer/private source evidence, and
  other sources are only shown when already attributed.

### Verification Delta

- `pnpm --filter @bidstack/web exec vitest run src/components/cockpit/TechStackCard.test.tsx --reporter=dot`:
  35/35 pass.
- `pnpm --filter @bidstack/web exec eslint --no-ignore --no-warn-ignored src/components/cockpit/TechStackCard.tsx src/components/cockpit/TechStackCard.test.tsx src/styles/cockpit.css --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/web exec tsc --noEmit --pretty false`: pass.
- `pnpm --filter @bidstack/api exec vitest run src/providers/company-tech-stack-mcp.test.ts src/providers/company-seamless-enrichment.test.ts src/routes/crm/companies.test.ts --reporter=dot`:
  26/26 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/queues/company-enrich-apollo.test.ts --reporter=dot`:
  24/24 pass.
- `pnpm --filter @bidstack/web build`: pass.
- In-app browser preview on `http://127.0.0.1:4173/accounts/5ae5942c-c97a-4177-b053-dd986008a2d3`
  with API proxied to `http://127.0.0.1:4101`: source assistant rendered,
  source pull returned local disabled/unconfigured Apollo/Seamless/Tech Intel
  and synced open-data states, desktop chip min width 139px, mobile 390px chip
  min width 256px, no Technical Stack horizontal overflow, and no scoped
  buttons below 40px.

### Residual Risk

- Local QA still cannot prove live Apollo, Seamless.AI, BuiltWith, Wappalyzer,
  or private Tech Intel MCP extraction without real staging credentials and
  endpoints. This slice proves the add-workbench status UX and responsive
  layout after a real local provider refresh.
