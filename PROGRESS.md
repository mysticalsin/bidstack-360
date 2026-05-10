# PROGRESS — BidStack 360°

Append-only sprint log. Every sprint ends with a commit + a checkpoint here.

---

## 2026-05-10 — Sprint 0: Foundation

**Branch:** `feat/sprint-0-foundation`

**Done:**
- `git init -b main` + `feat/sprint-0-foundation` branch
- `SPEC.md` — canonical product spec (12 sections, sprint plan, acceptance criteria)
- `CLAUDE.md` — 14 conduct rules + project architecture (stack, layout, conventions, commands)
- `PROGRESS.md` — this file
- `MISTAKES.md` — empty ledger seeded with header
- `.claude/` — settings.json + rules + agents + hooks (per Tony's `code.skill` template)
- `.gitignore` — Node + Vite + Prisma + secrets

**Verified:** Files exist; hooks chmod +x.

**Not verified yet:** `pnpm install` (no package.json yet — Sprint 1).

**Next:** Sprint 1 — monorepo skeleton.

---

## 2026-05-10 — Sprints 1–8 (single-session autonomous build)

**Branch:** `feat/sprint-0-foundation` (will be renamed → `feat/v0.1-monorepo` at PR open)

**Done:**

### Sprint 1 — Monorepo skeleton
- `package.json` + `pnpm-workspace.yaml` (apps + packages, twenty-bidstack excluded)
- `tsconfig.base.json`, `.prettierrc.json`, `.editorconfig`, `.nvmrc`
- `.env.example` (Postgres, Redis, Clerk, Dust, Anthropic, Sentry, OTLP, Vite)
- `docker-compose.yml` (Postgres 16 + Redis 7 with healthchecks)
- `README.md`

### Sprint 2 — Shared/db/dust packages
- `@bidstack/shared` — Zod schemas + types for Opportunity, Contact, Task, IntelPayload (financial, triggers, decisionUnit, competitors, news, hiring, winPrediction)
- `@bidstack/db` — Prisma 5 schema generated from `handoff/db.schema.sql` (orgs, users, opportunities, contacts, tasks, documents, sync_events, api_keys, webhook_subscriptions, audit_log) + seed extracted from prototype's `data.js` (8 opps, 8 contacts, 7 tasks, 7 users)
- `@bidstack/dust-client` — Typed Dust workspace API wrapper with retry/backoff/timeout + `verifyDustSignature` HMAC

### Sprint 3 — API server
- `@bidstack/api` (Fastify 5 + Zod + Pino):
  - `/health` (DB roundtrip)
  - `GET/POST/PATCH /api/opportunities[:id]`
  - `POST /api/opportunities/:id/stage` (kanban)
  - `POST /api/opportunities/:id/brief` (stub, Dust+Anthropic-ready)
  - `GET /api/contacts`, `GET/POST /api/tasks`
  - `GET /api/reports/pipeline` (KPIs + weighted pipeline)
  - `GET /api/integrations/dust/status`, `POST /api/integrations/dust/resync`
  - `GET/POST/DELETE /api/integrations/api-keys` (mint+revoke, sha256-hashed at rest)
  - `GET /api/integrations/webhooks` (sync_events feed)
  - `POST /webhooks/dust` (HMAC verify + dedup + <50ms ack)
  - Auth plugin: stub mode (seeded org session) + Clerk-ready
  - Error handler: ZodError → 400, HTTPError pass-through, 500 fallthrough

### Sprint 4 — MCP server
- `@bidstack/mcp-server`: JSON-RPC 2.0 over HTTP at `/mcp`, `tools/list` + `tools/call`
- 6 tools per `handoff/mcp.tools.md`: `opportunities.list`, `opportunities.get`, `opportunity.update`, `contacts.list`, `tasks.create`, `proposal.draft`
- Per-key auth (sha256 hashed bearer → `api_keys` lookup, requires `mcp` scope)
- 60/min rate limit per key
- Audit log written on every mutation

### Sprint 5 — Worker
- `@bidstack/worker`: BullMQ on Redis 7
- `dust-poll` queue: every 5 min, stub-mode logs `sync_event` per org when `DUST_API_KEY` unset
- `dust-webhook` queue: drains `sync_events.status='received'` every 10s and marks them processed

### Sprint 6 — Web app
- `@bidstack/web` (React 18 + Vite 6 + Tailwind 4 + Radix UI):
  - Apple HIG design tokens (8px grid, 9-step type, full dark-mode peer)
  - Dark mode via `data-theme` attribute, persisted in `localStorage`, applied pre-paint
  - WCAG 2.2 AA: 4.5:1 / 3:1 contrast, `*:focus-visible` 3px ring, `prefers-reduced-motion` honored, skip-to-content link, semantic landmarks
  - Pages: Dashboard, Opportunities (list + detail with Intel Ribbon, Financial Health, Win Prediction, Triggers, Competitor radar, News, Hiring), Pipeline (kanban read view), Contacts, Tasks, Reports, Integrations, Settings
  - Components: Card, Badge (with `stageTone()`), Button (4 variants × 3 sizes), StateMessages (Empty/Error/Loading)
  - Theme store via Zustand, server state via TanStack Query

### Sprint 7 — Twenty overlay preserved
- `packages/twenty-bidstack/` copied verbatim from handoff zip (BidStackApp.tsx, bidstack.module.ts, opportunity-intel.workspace-entity.ts, package.json)
- Excluded from pnpm workspace via `!packages/twenty-bidstack` so unresolvable upstream-Twenty deps don't break install
- `PRESERVATION-NOTE.md` documents how to migrate later
- `handoff/` source-of-truth files copied (openapi.yaml, db.schema.sql, dust.integration.md, mcp.tools.md, README.md)

### Sprint 8 — Quality gates
- 13 vitest tests passing across shared (7), dust-client (5 — HMAC), api (1 — health smoke), web (5 — formatters)
- `pnpm typecheck` clean across 7 workspace packages (twenty-bidstack excluded as documented)
- Web production build: **259 KB JS / 80 KB gzip / 24 KB CSS** in 1.36s
- Docs added: `docs/ARCHITECTURE.md`, `docs/DUST.md`, `docs/MCP.md`, `docs/design-system.md`
- `.claude/` hooks (block-dangerous-commands, scan-secrets, session-start)

**Verified:**
- `pnpm install` succeeds (374 packages, 8 workspace projects)
- `pnpm -r typecheck` exits 0
- `pnpm -r test` 13/13 pass
- `pnpm --filter @bidstack/web build` succeeds, bundle within budget

**Not verified (deferred to next session):**
- DB migrate + seed against a live Postgres (need `docker compose up` first)
- E2E against a running API+web (need migrations applied)
- Lighthouse audit (need a deployed URL or `pnpm preview`)
- Integration test for Dust webhook receive → worker drain
- Real Clerk wiring (deferred to Sprint 9)
- Real Dust API integration (works against live `DUST_API_KEY` only)

**Next:**
- `docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` for first end-to-end smoke
- Sprint 9: real Clerk auth + Lighthouse + E2E smoke + Dust live mode

---

<!-- New entries appended above this marker. -->
