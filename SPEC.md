# BidStack 360° — Product Specification

> **Status:** v0.1 — drafted 2026-05-10
> **Owner:** Tony Walteur
> **Workspace path:** `d:\BIDCRM`
> **Repo:** `BIDCRM` (working name); product brand: **BidStack 360°** (vendor: Mantu)

---

## 1. Context

BidStack 360° is a **bid & presales intelligence CRM** that augments standard opportunity management with:

1. **360° intelligence** on every opportunity — financials, news, hiring signals, buying triggers, decision unit, competitor radar, win prediction.
2. **Bidirectional [Dust](https://dust.tt) integration** — Dust agents read CRM data via MCP and write back via webhooks; BidStack uses Dust agents inside the AI sidebar for exec briefs and proposal drafting.
3. **Pipeline UX engineered for bid managers** — kanban that respects probability/value, decision-unit influence weighting, real-time data freshness ribbons, and a proposal composer that grounds output in the customer's intel + Mantu's reference library.

The handoff package (delivered as `Open CRM (1).zip`) ships with:

- A complete prototype frontend (React JSX, ~24 source files in `src/`)
- An OpenAPI 3.1 contract (`handoff/openapi.yaml`)
- A Postgres DDL (`handoff/db.schema.sql`)
- Dust + MCP integration specs
- A Twenty CRM overlay package (`handoff/twenty-overlay/packages/twenty-bidstack/`) for future portability

This spec covers the **standalone build**. The Twenty overlay variant is preserved verbatim under `packages/twenty-bidstack/` for future migration without rework.

---

## 2. Architecture

### 2.1 Monorepo layout

```
BIDCRM/
├── apps/
│   ├── web/              # React 18 + Vite + Tailwind — port of the prototype
│   ├── api/              # Fastify 5 + Zod + Pino — REST per openapi.yaml
│   ├── worker/           # BullMQ workers (Dust poll, enrichment, webhooks)
│   └── mcp-server/       # @modelcontextprotocol/sdk over Fastify
├── packages/
│   ├── db/               # Prisma schema + client + migrations
│   ├── dust-client/      # Typed Dust workspace API wrapper
│   ├── shared/           # Zod schemas, types shared between API + web
│   └── twenty-bidstack/  # The Twenty overlay (future migration target)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DUST.md
│   ├── MCP.md
│   └── solutions/        # compound-engineering knowledge entries
├── .claude/              # Hooks, agents, rules
├── CLAUDE.md             # 14 conduct rules + project architecture
├── SPEC.md               # this file
├── PROGRESS.md           # sprint progress log
├── MISTAKES.md           # repeated-mistake ledger
└── pnpm-workspace.yaml
```

### 2.2 Stack

| Concern              | Choice                             | Rationale                                                                |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Runtime              | Node 24 LTS                        | Already installed; Vercel Functions default                              |
| Package manager      | pnpm 10 workspaces                 | Already installed; superior monorepo perf                                |
| Frontend framework   | React 18 + Vite + TypeScript       | Matches the prototype's JSX; no Next.js needed for an internal CRM       |
| Styling              | Tailwind 4 + CSS variables         | Prototype already uses tokens.css/styles.css; map them to Tailwind theme |
| Component primitives | Radix UI + custom                  | A11y-first; matches Apple HIG spec                                       |
| Backend framework    | Fastify 5                          | Fast; first-class TypeScript; matches handoff prompt                     |
| Validation           | Zod                                | Generated from openapi.yaml                                              |
| ORM                  | Prisma 5                           | Generates from db.schema.sql; type-safe                                  |
| Database             | Postgres 16                        | Per db.schema.sql                                                        |
| Queue                | BullMQ + Redis 7                   | Per dust.integration.md                                                  |
| Auth                 | Clerk (prod) / dev stub            | Per .env.example; stub for local dev                                     |
| MCP SDK              | `@modelcontextprotocol/sdk` ^1.0.0 | Per mcp.tools.md                                                         |
| Logging              | Pino + pino-pretty                 | Per handoff prompt                                                       |
| Test runner          | Vitest 2                           | Faster than Jest; native ESM                                             |
| E2E                  | Playwright                         | Industry standard                                                        |

### 2.3 Quality bars (non-negotiable)

- **Apple HIG** spacing, typography, motion. 8px base grid. 9-step type scale.
- **Dark mode** is a first-class peer of light mode. Every component supports both.
- **WCAG 2.2 AA** baseline. 4.5:1 text contrast, 3:1 UI contrast, 44×44px touch targets, full keyboard navigation, reduced-motion respected.
- **Performance**: LCP < 2.5s, INP < 200ms, CLS < 0.1.
- **Type safety**: zero `any` in shipped code. `tsc --noEmit` clean.
- **Tests**: Vitest unit on every utility + every endpoint. Playwright on the golden path (login → dashboard → open opportunity → see intel).
- **Security**: every secret via env, all SQL parameterized, rate limits on auth endpoints, HMAC validation on webhooks, JWT scopes for MCP API keys.

---

## 3. Data model (canonical)

Source of truth: `handoff/db.schema.sql`. Prisma generates from this.

| Table                   | Purpose                 | Notes                                  |
| ----------------------- | ----------------------- | -------------------------------------- |
| `orgs`                  | Tenant root             | `clerk_org` UNIQUE                     |
| `users`                 | Per-org users           | scoped by `org_id`                     |
| `opportunities`         | Bids/deals              | `intel jsonb` carries the 360° payload |
| `contacts`              | Decision-unit members   | `influence` 1-5, `sentiment` enum      |
| `tasks`                 | Follow-ups              | linked to `opp_id`                     |
| `documents`             | RFPs, proposals, refs   | `kind` enum, optional `dust_doc_id`    |
| `sync_events`           | Dust webhook + poll log | for the integration timeline UI        |
| `api_keys`              | MCP / REST keys         | `hashed_key`, `scopes[]`               |
| `webhook_subscriptions` | Outbound webhooks       | with `secret` for HMAC                 |
| `audit_log`             | All mutations           | for compliance + the audit log UI      |

**Multi-tenancy:** every query MUST be scoped by `org_id` via Clerk middleware. Org-scoping is a Sprint 4 unit-test requirement.

---

## 4. REST API surface

Source of truth: `handoff/openapi.yaml`. Every endpoint generated as a Fastify route with Zod validation.

```
GET    /api/opportunities              List + filter + paginate
POST   /api/opportunities              Create
GET    /api/opportunities/:id          Get full 360° payload
PATCH  /api/opportunities/:id          Update
POST   /api/opportunities/:id/stage    Kanban move
POST   /api/opportunities/:id/brief    Generate exec brief (Dust → Anthropic fallback)
GET    /api/contacts                   List
GET    /api/tasks                      List
GET    /api/reports/pipeline           KPIs

GET    /api/integrations/dust/status   Sync status
POST   /api/integrations/dust/resync   Force sync
GET    /api/integrations/api-keys      List API keys
POST   /api/integrations/api-keys      Mint key
DELETE /api/integrations/api-keys/:id  Revoke
GET    /api/integrations/webhooks      Recent events

GET    /api/integrations/odoo/status   Odoo MCP sidecar status
GET    /api/integrations/odoo/models   List Odoo models (proxies MCP list_models)
POST   /api/integrations/odoo/search   search_records over MCP
GET    /api/integrations/odoo/:model/:id  get_record over MCP

POST   /webhooks/dust                  Dust webhook receiver (HMAC verified)
```

---

## 5. MCP tools exposed

Source of truth: `handoff/mcp.tools.md`. Six tools, all auth'd via per-workspace API key with `mcp` scope.

1. `opportunities.list` — filter + search
2. `opportunities.get` — by id or code
3. `opportunity.update` — patch mutation, writes audit_log
4. `contacts.list`
5. `tasks.create`
6. `proposal.draft` — markdown + citations

Rate limit: 60/min, 600/hour per key. 429 with `Retry-After` on overflow.

---

## 6. Dust integration

Source of truth: `handoff/dust.integration.md`. Three integration modes:

1. **Workspace API (outbound)** — Pull deltas every 5 min via BullMQ; push opportunity-as-document on create/update
2. **Webhooks (inbound)** — `POST /webhooks/dust` with HMAC validation, Redis dedup (7-day TTL), <50ms ack
3. **MCP server (Dust → us)** — Hosted at `${DUST_MCP_PUBLIC_URL}/mcp`

**Subscribed events:** `document.created`, `document.updated`, `agent.run.completed`, `conversation.message.created`.

---

## 6b. Odoo MCP integration

BidStack acts as an **MCP client** of [ivnvxd/mcp-server-odoo](https://github.com/ivnvxd/mcp-server-odoo) — a Python MCP server that wraps Odoo's XML-RPC API. The sidecar runs in `docker-compose.yml` under the `odoo` profile; `apps/api` reaches it over MCP streamable-http via `@bidstack/odoo-mcp-client` and surfaces it on the Integrations page.

Detailed setup, env vars, and operational notes: `docs/ODOO.md`.

**Surface (v0.1, read-only over HTTP):**

- `GET /api/integrations/odoo/status` — sidecar connection probe + tool count
- `GET /api/integrations/odoo/models` — proxies MCP `list_models`
- `POST /api/integrations/odoo/search` — proxies MCP `search_records`
- `GET /api/integrations/odoo/:model/:id` — proxies MCP `get_record`

The client wrapper also exposes `createRecord`, `updateRecord`, `deleteRecord`, `aggregateRecords`, `postMessage`, and `callModelMethod` for internal callers (workers, jobs, future Apollo-style enrichment from Odoo partners). Method calls are off by default at the sidecar — set `ODOO_MCP_ENABLE_METHOD_CALLS=true` to allow them.

---

## 7. UI/UX scope (per prototype)

The prototype defines:

| Surface               | Components                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**         | KPI strip (4 cards), pipeline chart, recent activity, intelligence ribbon                                                                                                                                   |
| **Pipeline (Kanban)** | 6 columns (discovery → closed_lost), drag to advance stage                                                                                                                                                  |
| **Opportunity 360°**  | Header (logo, name, stage, value), Intel ribbon, Financial Health card, Triggers list, Decision Unit panel, Win Prediction gauge, Competitor Radar, Account Brief, Tasks, Documents, Timeline, Dust sidebar |
| **Contacts**          | Searchable list, decision-unit graph                                                                                                                                                                        |
| **Tasks**             | List + kanban by status                                                                                                                                                                                     |
| **Reports**           | Pipeline KPIs, win/loss, velocity                                                                                                                                                                           |
| **Integrations**      | MCP status, Dust connection, API keys, webhooks                                                                                                                                                             |
| **Settings**          | Team, profile, theme tweaks                                                                                                                                                                                 |

**Design tokens** carry over from the prototype's `src/tokens.css` (colors, spacing, motion, shadows). They are consolidated into Tailwind's theme + CSS variables for runtime dark-mode toggle.

---

## 8. Sprint plan

| Sprint                         | Goal                                                                    | Verify                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **0** Foundation               | SPEC, CLAUDE.md, .claude/, MISTAKES.md, PROGRESS.md                     | Files exist, hooks executable                                                            |
| **1** Skeleton                 | Monorepo, pnpm workspaces, root configs, .env.example                   | `pnpm install` succeeds                                                                  |
| **2** Database                 | Prisma schema, migrations, seed from prototype `data.js`                | `pnpm db:migrate && pnpm db:seed` succeeds                                               |
| **3** Web app                  | Vite + React + Tailwind + design tokens; ports prototype JSX; dark mode | `pnpm dev:web` boots; Lighthouse ≥ 90 perf, ≥ 95 a11y                                    |
| **4** API server               | Fastify routes for every openapi.yaml path; org-scoped; Zod validation  | `pnpm dev:api` boots; `curl /api/opportunities` returns 200 with seed data; vitest green |
| **5** Dust + worker            | dust-client package; BullMQ poll worker; `/webhooks/dust` HMAC          | Mock Dust webhook produces a `sync_events` row                                           |
| **6** MCP server               | 6 tools registered; rate-limited; per-key org scoping                   | MCP inspector shows 6 tools; rate limit returns 429                                      |
| **7** Twenty overlay preserved | `packages/twenty-bidstack/` mirrors handoff verbatim                    | Files match handoff zip byte-for-byte                                                    |
| **8** Quality gates            | typecheck, lint, vitest, axe, README + ARCHITECTURE                     | All gates green; quality score ≥ 95/100                                                  |

Each sprint ends with a **gate** (Tony's architect-protocol.md): commit, test, push, await approval before next sprint.

---

## 9. Acceptance criteria (handoff-derived)

- [ ] `pnpm dev` brings up `web + api + worker + mcp-server` with hot reload
- [ ] `curl http://localhost:3000/api/opportunities` returns 5 seeded records
- [ ] Pipeline kanban drag updates `opportunities.stage` via `POST /api/opportunities/:id/stage`
- [ ] Force-resync button triggers `POST /api/integrations/dust/resync` and a BullMQ job runs
- [ ] Mock Dust webhook signed with `DUST_WEBHOOK_SECRET` produces a `sync_events` row + updates the opportunity
- [ ] MCP server registered at `${DUST_MCP_PUBLIC_URL}` shows 6 tools
- [ ] Every table has `org_id`; queries scoped via Clerk org middleware
- [ ] CI runs migrations against an ephemeral Postgres on every PR
- [ ] Lighthouse ≥ 90 perf, ≥ 95 a11y on `/dashboard` and `/opportunities/:id`
- [ ] Dark mode toggle works on every screen; respects `prefers-color-scheme` initial value
- [ ] WCAG 2.2 AA passes axe-core on every shipped route

---

## 10. Out of scope (v0.1)

- Mobile native apps (web is responsive down to 375px)
- Calendar / email sync (Twenty handles this if we ever migrate to the overlay)
- Enterprise SSO beyond Clerk (Clerk supports SAML when needed)
- Marketplace integrations beyond Dust (Slack/Notion connectors are post-v1)
- Real-time collaboration (Yjs/Liveblocks) — single-user-per-record for v0.1

---

## 11. References

- Handoff package: `C:\Users\Tony\Downloads\CRM_extracted\handoff\` (extracted from `CRM (1).zip`)
- Apple Design Prompt: `C:\Users\Tony\Downloads\Ultimate Apple Design Prompt (5).pdf` — informs the design-system sub-agent workflow
- Code skill: `C:\Users\Tony\Downloads\code.skill` (Tony's `/code` workflow skill, v2.0.0) — informs the 14 conduct rules
- Twenty CRM upstream: `https://github.com/twentyhq/twenty` (target if we ever execute the overlay path)
- Dust API: `https://docs.dust.tt`
- MCP spec: `https://modelcontextprotocol.io`
