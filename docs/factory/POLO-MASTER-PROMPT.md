# Polo master prompt (v4, 2026-11-06)

The one brief every agent working on Polo reads first. Build on `main` of
`mysticalsin/bidstack-360`. Never build from scratch: reuse what Polo already
has, then port from the open-source references below (with their licence
headers), and only then write new code.

## 0. Product in one line

Polo PreSales is the bid and pre-sales cockpit for Mantu: every account,
opportunity, proposal and RFP in one place, an agent that keeps the record
true, and a voice you can ask.

## 1. Ground rules

1. Simple purpose, simple architecture, simple design, simple implementation.
   If a screen needs a tagline, helper text or a secondary label to make
   sense, fix the layout instead.
2. Every change raises UX, DX and EX (agent experience) at once and breaks
   nothing. The CI gate list in `.github/workflows/ci.yml` is the bar.
3. Factory line for every slice: worktree from `origin/main`, fail-first
   tests, build, tests, the full CI gate list locally, review, push, PR into
   `main`, CI green, merge. Staging and production stay with Tony.
4. Nothing about a person is guessed (from Comp AI CRM). Tools report what
   they observed and where; weak evidence becomes a suggestion a human
   settles. Every number on screen links to its source, date and confidence.
5. Humans decide. No automatic bid submission, no contacting public
   officials, no sending proposals or email. Outreach is drafts only.
6. No secrets in code, logs or prompts. Keys by name; values from the
   platform secret store. Logs redact headers and PII (`PII_MAP`).
7. Brand: green `#006b4f`, both themes through tokens in
   `apps/web/src/index.css`, `lucide-react` icons, `cn()`, the design-law lint.

## 2. What Polo already has (reuse first)

| Area | Where |
| --- | --- |
| Web shell, tokens, charts | `apps/web/src/components/{layout,ui,charts}`, `index.css` |
| Command palette and Copilot | `components/command/{CommandPalette,CopilotPanel,copilotActions}.tsx`, `hooks/useAiAssistant.ts` |
| AI route | `apps/api/src/routes/ai-assistant.ts` |
| CRM data | `routes/{accounts,companies,contacts,activities,opportunities*,opportunity-timeline,proposals*,rfp-pipeline*,bid-*}.ts` |
| Account intelligence | `routes/account-{intel,signals,watchdog,people,financials,enrichment}.ts` |
| MCP server (about 25 tools) | `apps/mcp-server/src/tools/*` |
| Dust | `routes/dust-integration*.ts`, `packages/dust-client` |
| HubSpot import, ERP, webhooks | `routes/migrations-hubspot.routes.ts`, `erp-integration.ts`, `webhook-subscriptions.ts` |
| RBAC | `packages/shared` matrix: 66 permissions, 6 roles |
| Front door | `apps/polo-preview` Worker: Cloudflare Access, `/__auth/*` one-time code, proxy to the Vercel demo |

## 3. Borrowed from four open-source CRMs

| Repo | Who | Licence | Steal |
| --- | --- | --- | --- |
| `twentyhq/twenty` | Twenty.com (Charles Bochet, Félix Malfait) | AGPL-3.0 core, commercial `enterprise` files | Metadata-driven objects so the API, MCP tools and views come from one definition; record page = fields + timeline + tasks/notes/files tabs; Cmd+K command menu that also runs actions; workflow builder with triggers and approvals; per-role agent permissions; MCP auto-generated from object metadata. Read for patterns only: AGPL code is not copied. |
| `mysticalsin/crm` (fork of `trycompai/crm`) | Comp AI | MIT | Agent as its own process with a durable work queue (`FOR UPDATE SKIP LOCKED` leases, `schedule_recheck` with a stated reason); evidence ledger instead of model confidence; skills as versioned markdown; sandbox with deny-all egress and no `DATABASE_URL`; an **Agent tab on every record** showing steps live; connections with read-only vs read-write grants, tool fingerprints and review of new tools. |
| `every-app/open-crm` | Every App, Inc. (port of Comp AI CRM) | MIT | Runs on Cloudflare Workers + D1/Drizzle + R2; read-only Gmail/Outlook/Calendar capture that files conversations on the right company; MCP tools for Claude, Cursor and other clients; CSV import/export; saved views and custom fields. Closest match to Polo's Cloudflare front door. |
| `mysticalsin/sales-crm` (fork of `kargulstudio/sales-crm`) | Kargul Studio | MIT | UI conventions: companies list with toolbar, filter menu, segment bar, sparkline cells, detail sheet, command menu per list, sliding numbers; one `CONVENTIONS.md` that is the whole build spec. |

## 4. The build, in order

### 4.1 Charts in the real screens (TUFFUI, MIT, commit `378f3eaa`)

Vendor into `apps/web/src/components/charts/tuffui/` with licence headers,
Phosphor icons swapped for lucide, tokens rewritten to Polo names.

- Dashboard, Open pipeline: DivergingBars by close month (won, lost, open
  stacked; overdue below). Keep the 11.9M headline.
- Dashboard: RadialDots, activity by hour.
- Opportunity: win-prediction factors as diverging bars, Bid/No-Bid as
  RadarChart against the go threshold, MatchField for consultant fit.
- Win/Loss: DivergingBars per quarter, DotHistogram of cycle days.
- Sector view: IsoBars by sector, overdue in the front row.
- Account page: activity RadialDots and DivergingBars from CRM activity.
- Settings, Webhooks: success gauge, attempts heatmap by endpoint and hour,
  message log with attempts, response body, Copy cURL and Replay, retry
  schedule with response-time DotHistogram, endpoint form (events, rotate
  secret, retry policy, timeout).
- Settings, Access policies: When / Then / Except builder, impact preview,
  Run simulation, Publish vN, approvals queue, audit log with chain status.
- StatusPill and Tag everywhere a status or identifier shows.

### 4.2 Manual data fetching

One "Sync now" pattern for every source (CRM, Dust, Chile, ERP): a button
with last-synced time, a progress row, a result summary (new, updated,
skipped, failed with reason) and an undo for imports. Backed by a BullMQ job
with an idempotency key; the UI polls the job, never blocks.

### 4.3 API and MCP for Dust and the CRM

- Scoped API keys (company/MSA scoping exists) with per-key rate limits,
  idempotency keys on every write, audit events, OpenAPI.
- Inbound activity API: `POST /api/v1/ingest/activities` (calls, emails,
  meetings, notes, stage changes) with an external id for dedupe, mapped to
  accounts and opportunities, rendered as charts on the account page.
- MCP over streamable HTTP with per-org keys: read tools for accounts,
  opportunities, proposals, RFPs and activity; write tools gated by grants
  (read-only vs read-write per connection, Comp AI pattern); every call
  audited; output size caps; prompt-injection fencing of record text.
- Dust feeds data in through the same ingest API and MCP write tools, never
  directly to the database.

### 4.4 Jarvis: voice and chat that acts

Upgrade the existing Copilot, do not replace it.

- Opens from a mic button in the topbar, Cmd+J, or "Hey Polo" when allowed.
- Voice in: Web Speech API (`SpeechRecognition`), with typed input always
  available. Voice out: `speechSynthesis`, can be muted. No audio leaves the
  browser unless a server speech model is configured.
- Context-aware: on an account, proposal or RFP page, "this" means that record.
- Answers come from tools, not memory. The tool set is the MCP registry
  (`apps/mcp-server/src/tools`), shared by Jarvis, Dust and external
  clients: one definition, three surfaces.
- Agentic: plans multi-step work ("summarize this RFP, list the gaps, draft
  three answers, create tasks for owners"). Reads run directly; writes show
  a confirmation card with the exact change and need a click. Every step is
  shown live, like Comp AI's Agent tab, and logged to audit.
- Every answer cites its records (links, dates). It says when data is missing.
- Example asks: "What changed on DNB Bank this week?", "Where is the MAHLE
  proposal?", "Summarize this RFP and its deadlines", "Which bids are
  overdue and who owns them?", "Create a follow-up task for Friday".

### 4.5 Sign-in

Cloudflare verifies identity once. Visitors already signed in to Cloudflare
Access go straight to the dashboard. The Polo page offers a one-time code
sign-in sent by the Worker (Cloudflare Email Routing) once a sending domain
exists; until then Access stays in front.

### 4.6 Backend hardening

Generated RBAC route tests, per-route rate limits, cursor pagination,
request-id sanitising, hash-chained audit log, webhook outbox with
idempotency, backoff and dead-letter, Postgres RLS for tenant tables, PII
encryption for SmsMessage, SmsConsent, ActivityAttendee and CalendarEvent.

### 4.7 Public Sector Intelligence (Chile first)

Spec: `docs/factory/PUBLIC-SECTOR-INTEL.md`. Mercado Público API (ticket
`MERCADOPUBLICO_API_TICKET`), OCDS (CC0) and bulk CSV adapters in
`packages/shared/src/public-sector/`, then schema, radar, entity profiles,
competitor and pricing views, bid/no-bid recommendation (human decides),
ChileCompra attribution. Then Colombia, Peru, Mexico, Brazil.

## 5. Definition of done

Green CI gate list, light and dark screenshots of every changed screen, the
safety copy list pinned in tests, a PR under 4,000 characters that says what
changed and how it was verified, and a line in `_relay/log.md`.
