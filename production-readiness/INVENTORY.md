# BidStack 360° — Asset Inventory (code-side)

**Date:** 2026-06-27. Code/app assets enumerated from the repo. **Cloud/secret/infra assets are NOT here** — they require account access (see `UNKNOWN_ITEMS.md`).

## Application (pnpm monorepo, Node 24)
- **apps/web** — React 18 + Vite 6 + TS + Tailwind + Radix. ~27 nav sections/routes (dashboard, forecasts, accounts, KAM, opportunities, leads, contacts, companies, territories, bid-matrix, proposals, tasks, calendar, workflows, custom-objects, intake, analytics, settings, cross-sell, references, sector-view, top-accounts, key-accounts, sales-toolkits, account/opportunity detail).
- **apps/api** — Fastify 5 + Zod + Prisma. ~130 route files (`apps/api/src/routes`), plugins (auth, rbac, idempotency, query-guard, security-headers, error-handler, rate-limit via server.ts), services, queues.
- **apps/worker** — BullMQ workers: email/calendar sync, calls, RFP pipeline (9 stages), webhook-delivery, tenant-export, migrations, sms, predictive-retrain, workflow-dispatch, enrichment.
- **apps/mcp-server** — `@modelcontextprotocol/sdk` (54 tests pass).
- **apps/marketing**, **apps/chrome-extension**.
- **packages**: db (Prisma schema + client), shared (Zod schemas, server-only helpers incl. SSRF-safe fetch, crypto/pii-field-cipher), dust-client, odoo-mcp-client, integrations, memos, twenty-bidstack (preserved overlay — do not modify), sdk-{go,python,ruby}.

## Auth & authZ
- Clerk (prod) / dev stub (loopback+dev only) / demo-auth (HMAC, per-visitor org). RBAC plugin: writes require `<resource>:write`; reads auth+org-scoped (by design). No admin-claim fallback (DB authorizes). API keys carry scopes.

## Data
- PostgreSQL 16 (Prisma). Multi-tenant: every tenant row `orgId`-scoped (manual per-query — no RLS backstop). Money in micros. PII middleware (`packages/db/src/middleware/pii-encryption.ts`) — Contact/Lead/User/KamConsultant email+phone, gated by `PII_FIELD_ENCRYPTION` (default OFF). Soft-delete + GDPR erasure + tenant-export routes (tested).
- Redis 7 (BullMQ + rate-limit store + cache). Sentry. Prometheus metrics. Pino logs (credential redaction in server.ts).

## Integrations (external)
- Dust AI, Odoo (ERP/SERUM connector), HubSpot (migration), Microsoft Graph (mail/calendar/SSO), Google (calendar/gmail/SSO), Slack, Zoom/Teams/Meet + Twilio + Deepgram (calls), Apollo (enrichment), Cloudflare Turnstile (CAPTCHA).

## Release tooling (present, mostly UNVERIFIED this session)
- `scripts/`: k6 load tests, semgrep SAST, container vuln scan, deploy-evidence bundle (browser/secrets/sentry/source/ops/azure/compose/secret-rotation/providers/tool-readiness), playwright e2e.
- `package.json` scripts: `deploy:evidence:*`, `security:scan`, `container:scan`, `load-test*`.

## Tests
- Vitest (unit/integration) + Playwright (e2e). api ~118 test files / ~800 tests; web ~77 files / ~430; shared/db/mcp/memos covered. Worker via `scripts/run-worker-tests.mjs`. **Caveat:** api suite intermittently flaky (cross-file state) — `docs/qa/flaky-suite-2026-06-27.md`.
