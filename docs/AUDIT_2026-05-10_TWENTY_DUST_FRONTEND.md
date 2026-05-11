# Audit: Twenty + Dust + Stack360 Frontend

Date: 2026-05-10

## Assumptions

- The attached Stack360 image and `CRM (1).zip` are the visual/product targets for `apps/web`.
- `mysticalsin/twenty` remains the adapted backend target for core CRM objects and GraphQL.
- `packages/twenty-bidstack/` stays preserved until a deliberate Twenty migration step.

## Current State

The repo is a working standalone BidStack CRM foundation:

- React/Vite frontend with dashboard, opportunities, pipeline, contacts, tasks, reports, integrations, auth stub, and command palette.
- Fastify REST API backed by Prisma/PostgreSQL.
- Dust REST wrapper, webhook receiver, BullMQ worker stubs, and MCP server.
- Docker Compose for PostgreSQL and Redis.
- Preserved Twenty overlay under `packages/twenty-bidstack/`.

The app is not yet the full goal implementation:

- It does not run on Twenty's core GraphQL/object model yet.
- The frontend renders a BidStack portfolio dashboard, not the Stack360 customer-360 page from the image.
- Realtime Socket.io, draggable dashboard widgets, inline table editing, bulk actions, logo enrichment jobs, and persisted AI insights are not implemented end to end.
- MCP tools currently use local names such as `opportunities.list`; the requested `crm_*` tool contract is now defined in shared schemas but not wired.

## Findings

### 1. Frontend Visual Parity Gap

The attached image targets a dense customer account cockpit:

- Customer sidebar taxonomy
- Company header with logo/status/actions
- Technical stack matrix
- Health score gauge
- Business snapshot, risk, open issues
- Key contacts and recent activity
- Roadmap timeline

Current `apps/web` is a bid portfolio surface. It is polished and functional, but the layout, navigation model, object focus, and data density do not yet match the target screenshot.

Recommended next step: port the zip prototype's `src/screens-dash.jsx`, `src/screens-v2.jsx`, `src/tokens.css`, and vendor assets into idiomatic `apps/web` components instead of copy-pasting the prototype wholesale.

### 2. Twenty Integration Gap

The repo preserves Twenty migration assets, but active runtime code is still standalone Fastify REST/Prisma. There is no adapter layer yet that treats Twenty Companies, People, Deals, and Activities as the canonical CRM source through GraphQL.

Recommended next step: add a `packages/twenty-client` GraphQL adapter and map local `Opportunity` concepts onto Twenty Deals before adding more frontend features.

### 3. Dust Integration Is Partial

Present:

- Typed Dust HTTP client.
- HMAC verification.
- Webhook receiver.
- Worker poll/drain loops.
- MCP server with authenticated tools.

Missing:

- Persisted Dust run table.
- AI insight generation table and queue.
- Source attribution and confidence scoring persistence.
- Requested `crm_search_companies`, `crm_create_deal`, `crm_enrich_company`, etc. tool names.

Recommended next step: add the extension tables first, then wire Dust REST jobs and MCP aliases to the same shared schemas.

### 4. Logo Enrichment Not Implemented

The schema has a simple `logoUrl` field and the new shared contract defines provider metadata, but there is no Clearbit/Brandfetch/favicon pipeline, Redis cache, or enrichment worker.

Recommended next step: create a logo enrichment queue with provider fallback order, store provider/source metadata in a separate enrichment table, and expose initials fallback in `apps/web`.

### 5. Realtime Dashboard Not Implemented

There is no Socket.io gateway or event contract yet. Dashboard widgets are static React components rather than draggable/persisted widgets.

Recommended next step: define widget layout persistence and event names in shared schemas, then add Socket.io only around actual writes/job completions.

### 6. Quality Gates Are Healthy

After this audit pass:

- Typecheck passes.
- Lint passes.
- Unit/integration tests pass.
- Build passes.
- E2E command runs, but all five browser smoke tests are skipped when the API health check is not 200.
- High-severity audit passes; two moderate dev-tool advisories remain through Vitest/Vite/esbuild.

## Changes Applied During Audit

- Added shared CRM/Dust/dashboard schemas.
- Added Twenty + Dust integration architecture doc.
- Hardened MCP fixed fixtures so repeat runs are idempotent.
- Hardened optional Redis worker tests to avoid unhandled `ioredis` errors when Redis is absent.
- Fixed API health import conventions and Redis fail-fast behavior.
- Updated stale E2E smoke copy assertions.
- Logged mistakes and reusable solution notes.

## Release Score

Current score against the requested goal: 67/100.

- Functional: 13/25. Core standalone CRM works; full Twenty/Dust/realtime goal is incomplete.
- Code: 22/25. Current code gates pass and patterns are mostly clean.
- Design: 14/25. Existing UI is polished, but it does not match the Stack360 customer dashboard target yet.
- Infra: 18/25. Docker, Prisma, workers, MCP, and tests exist; Redis health, Socket.io, and deployment hardening still need work.

Ship threshold remains 95/100.
