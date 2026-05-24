# Changelog

All notable changes to BidStack 360° are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: Calendar-versioned (YYYY-MM-DD) during active development.

---

## [Unreleased]

### Added
- PII field encryption middleware (AES-256-GCM, per-org HKDF keys) — `packages/db/src/middleware/pii-encryption.ts`
- One-shot PII migration script (`scripts/encrypt-existing-pii.ts`) and rollback (`scripts/decrypt-pii-rollback.ts`)
- Lighthouse CI workflow with 10-route audit and PR comment (`.github/workflows/lighthouse.yml`, `lighthouserc.json`)
- k6 load tests: baseline (100 VUs × 5 min), spike (0→2000 VUs), soak (50 VUs × 30 min) (`load-tests/`)
- Security headers plugin: CSP, HSTS, Permissions-Policy, COOP (`apps/api/src/plugins/security-headers.ts`)
- Prometheus `/metrics` endpoint with built-in Counter/Histogram exposition (`apps/api/src/routes/health.ts`)
- `docs/RUNBOOK.md`: deploy, rollback, scale, backup restore, key rotation, integration troubleshooting
- `docs/security/pii-field-encryption.md`: architecture, activation runbook, GDPR consequences

---

## [0.5.0] — 2026-05-24 (Wave 5 — Integration Hub + Final Polish)

### Added
- Gmail OAuth 2.0 integration: send, read, tracking pixel (`apps/api/src/routes/integrations/gmail.ts`)
- Microsoft Graph Mail integration: OAuth, send, Graph webhook subscription (`apps/api/src/routes/integrations/microsoft-mail.ts`, `microsoft-webhook.ts`)
- Provider-agnostic email send endpoint (`POST /api/v1/integrations/email/send`)
- Email open tracking pixel (`GET /api/v1/integrations/email/track/:pixelId/open.gif`)
- Slack integration: OAuth app connect, Events API, workspace management, DMs, Block Kit service
- Zapier integration: trigger webhooks, action handler patterns
- Integration hub Zod schemas and queue configs (`packages/shared/src/schemas/`)
- `EmailMessage`, `EmailTrackingPixel`, `SlackChannel`, `ZapierApp/Trigger/Action` Prisma models
- `IntegrationProvider` enum: `gmail`, `slack`
- Azure SSO / Microsoft Entra SAML 2.0 (`apps/api/src/routes/microsoft.ts`, `packages/db/prisma/schema.prisma`)
- Product tour: 6-step onboarding guide with `data-tour` attributes, `TourStep`, `ProductTour` components
- KpiCard and 10 chart types via `ChartContainer` (Bar, Line, Pie, Area, Radar, Scatter, Funnel, Treemap, Gauge, Heatmap)
- `PII_ENCRYPTION_MASTER_KEY` + `PII_FIELD_ENCRYPTION` env var documentation

---

## [0.4.0] — 2026-05-22 (Wave 4 — AI Assistant, RBAC, E-Signature, Analytics)

### Added
- AI Assistant service: `email-draft`, `sentiment`, `meeting-prep`, `enrich`, `account-intel`, `bid-defense` actions
- AI Assistant routes (`POST /api/v1/ai-assistant/:action`) backed by Anthropic Claude API
- 6-role RBAC matrix: `admin`, `sales_manager`, `account_executive`, `sdr`, `marketing`, `viewer`
- `RBAC_MATRIX` constant in `packages/shared/src/rbac/matrix.ts`
- `rbacPlugin` enforcing per-route resource/action permissions
- `RolesPage` frontend for role assignment
- E-Signature: `signature_requests`, `signature_envelopes` models, public signing URL (`/sign/:token`)
- Signature audit trail via `audit_logs`
- Analytics: `reports` table storing query definition as JSON; `GET /api/v1/reports/:id/data`
- `ReportsPage` with dimension/measure picker and saved report management
- Custom Fields: `custom_field_definitions` + `custom_field_values` (EAV), `GET/POST /api/v1/custom-fields/:entityType`
- Activity Timeline: polymorphic `activities` table, `GET /api/v1/:entityType/:id/activities`
- Custom fields rendered dynamically in Contact, Lead, Opportunity detail pages
- Apollo contacts integration for lead enrichment

### Changed
- Opportunity detail page: adds custom fields panel and activity timeline

---

## [0.3.0] — 2026-05-21 (Wave 3 — Workflow, Calendar, PWA, Bid/No-Bid)

### Added
- Workflow Engine: `workflows` table, trigger/action evaluation on mutations, drag-and-drop workflow builder UI
- `WorkflowTriggerKind` + `WorkflowActionKind` Prisma enums
- Calendar two-way sync: `CalendarProvider` model, Google + Microsoft 365 OAuth, 5-min poll worker
- Public booking pages: `booking_pages` table, `/book/:slug` route, availability algorithm, ICAL export
- Microsoft Graph webhook subscription for near-real-time calendar updates
- SF/HubSpot migration import: CSV/JSON with field mapping, dry-run mode
- Mobile PWA: `manifest.webmanifest`, service worker, `usePwaInstall` hook
- Bid Score / No-Bid Decision: `bid_scores` table, weighted scoring, MemOS policy calibration
- MemOS cognitive layer (`packages/memos`): L1 traces, L2 policies (upsert), L3 world model, hybrid retrieval
- `POST/GET /api/v1/bid-scores`, `POST /api/v1/bid-scores/:id/ai-calibrate` routes
- Bid/No-Bid frontend: opportunity selector, Save Score, AI Calibrate buttons
- `apps/api/src/config.ts`: Zod-validated schema for 20+ env vars
- Idempotency-Key middleware (Redis + memory fallback) — all mutating endpoints
- API versioning plugin: `/api/*` → `/api/v1/*` rewrite

### Changed
- Worker test environment: `vitest.config.ts` with `.env` loading + unhandled rejection filter for BullMQ/ioredis
- Opportunity stage mapping: `mapDealStage` now correctly maps all `s1_*`, `s2_*`, `s3_*`, `s4_*` stages

---

## [0.2.0] — 2026-05-20 (Wave 2 — Invoicing, Proposals, Enrichment, Service Desk)

### Added
- Invoicing module: `Invoice`, `InvoiceLine`, `Payment` Prisma models; `invoices.ts` routes
- Multi-currency support with `exchange_rates` table and daily refresh job
- PDF invoice export
- RFP / Proposal Factory: `Proposal`, `ProposalSection`, `ProposalStatus` Prisma models
- Proposal CRUD, section editing, AI draft endpoint (`packages/shared` template fallback)
- `ProposalsPage` with status filters, create dialog, list view
- Company enrichment: `CompanyEnrichment` model, Apollo bulk enrich job
- Service desk: `CaseStatus`, `CasePriority` enums, `support_cases` table
- Predictive analytics: win probability scoring using opportunity signals
- Territory management: `Territory` model, routing rules
- Account intelligence: `/api/v1/account-intel/:id` endpoint
- ERP integration: Odoo MCP client (`packages/odoo-mcp-client`), `/api/v1/integrations/erp/*` routes
- Backward-compatible redirects: `/api/v1/integrations/odoo/*` → `/api/v1/integrations/erp/*`
- Sales orders: `sales_orders` table, order state machine
- Products catalogue: `products` table, price book
- `apps/mcp-server`: 6 tools registered (read/write opportunities, contacts, tasks)

### Fixed
- Invoice tenant-ownership validation: related IDs now validated by `{id, orgId}` before persistence

---

## [0.1.0] — 2026-05-19 (Wave 1 — Foundation)

### Added
- Monorepo scaffold: pnpm workspaces, `apps/web`, `apps/api`, `apps/worker`, `apps/mcp-server`, `packages/db`, `packages/shared`, `packages/dust-client`
- PostgreSQL 16 schema via Prisma 5: Org, User, Opportunity, Contact, Task, Document, SyncEvent, AuditLog, Note, FileAttachment, ApiKey, WebhookSubscription
- Opportunity CRUD + stage mutations (`PUT /api/v1/opportunities/:id/stage`)
- Contacts CRUD with org-scoped queries
- Tasks CRUD with status machine
- Audit log: immutable append-only log for all mutations
- Dust polling worker (5 min interval) — pulls documents, upserts into DB
- Dust webhook receiver (`POST /webhooks/dust`) — HMAC verify + Redis dedup + BullMQ enqueue
- MCP server scaffolding: `@modelcontextprotocol/sdk` boilerplate + API key auth
- Clerk JWT auth plugin (dev stub + production verify)
- `@fastify/helmet` CSP + security headers
- `@fastify/rate-limit` with Redis backend (600/hour production)
- Vitest test runner + Playwright E2E
- GitHub Actions: CI (lint/typecheck/test/build), Lighthouse CI, Gitleaks secret scanning, Semgrep SAST, dependency review
- Seed data: Mantu org, sample opportunities, contacts, tasks
- `CLAUDE.md`: 14 conduct rules, architecture conventions, quality gates
- `SPEC.md`: canonical product spec
- `MISTAKES.md`: repeated-mistake ledger
- `PROGRESS.md`: sprint log

### Changed
- N/A (initial release)

---

[Unreleased]: https://github.com/mantu/bidstack-360/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/mantu/bidstack-360/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/mantu/bidstack-360/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mantu/bidstack-360/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mantu/bidstack-360/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mantu/bidstack-360/releases/tag/v0.1.0
