# BidStack 360° as a Twenty overlay

This document is the migration plan for **layering BidStack 360° on top of [`mysticalsin/twenty`](https://github.com/mysticalsin/twenty)**, *without forking or rewriting* anything that's already in the repo. Twenty's CRM, workflows, marketplace, dashboards, command menu, AI module, calendar, messaging, etc. all stay — BidStack rides on top as a new package.

> **Rule:** No file in `packages/twenty-front/`, `packages/twenty-server/`, `packages/twenty-ui/`, `packages/twenty-shared/` is replaced. Anything BidStack needs goes in **new files**, registered through the extension points Twenty already exposes (modules barrel, navigation registry, command-menu registry, standard objects loader).

---

## Stack reuse — what BidStack gets for free

Twenty already gives us the foundation we previously planned to scaffold:

| BidStack need | Twenty primitive (reused) |
|---|---|
| CRM database + ORM | `twenty-server` NestJS + TypeORM + Postgres + multi-tenant workspaces |
| GraphQL API | code-first GraphQL Yoga |
| Auth + orgs | workspaces + workspace-members module |
| Background jobs | BullMQ workers (`twenty-server:worker`) |
| Frontend shell | `twenty-front` (React 18 + Jotai + Linaria) |
| Command palette | `modules/command-menu/` ← we extend this |
| Keyboard shortcuts | `modules/keyboard-shortcut-menu/` |
| AI sidebar / chat | `modules/ai/` ← we register a Dust agent |
| Dashboards & views | `modules/dashboards/` (host BidStack analytics here) |
| Custom records UI | `modules/object-record/` (every BidStack object renders here) |
| Notes, tasks, files, timeline | `modules/{note,task,attachment,timeline}/` |
| Workflows / automations | `modules/workflow/` (Dust events trigger workflows) |
| Marketplace + apps | `modules/marketplace/` + `modules/applications/` (BidStack ships as an app) |
| Email templates | `twenty-emails` (proposal & follow-up templates) |
| Zapier surface | `twenty-zapier` (BidStack triggers exposed automatically) |
| E2E test rig | `twenty-e2e-testing` (Playwright) |
| SDK + CLI | `twenty-sdk` + `twenty-cli` (proposal automation scripts) |

The Twenty **opportunity** module already exists. BidStack does NOT replace it — it **extends** it with intel, triggers, decision unit, win prediction, and sync metadata as additional standard objects related to `Opportunity`.

---

## What BidStack adds (one new package)

A single new monorepo package: **`packages/twenty-bidstack/`**.

```
packages/twenty-bidstack/
├── package.json
├── project.json                  # Nx target wiring
├── README.md
├── src/
│   ├── index.ts                  # barrel
│   ├── server/
│   │   ├── bidstack.module.ts    # NestJS module, imported by modules.module.ts
│   │   ├── standard-objects/     # OpportunityIntel, BuyingTrigger, DecisionMember,
│   │   │                         # CompetitorBid, WinPrediction, DustSyncEvent,
│   │   │                         # ProposalDocument, RfpRequirement
│   │   ├── dust/
│   │   │   ├── dust.module.ts
│   │   │   ├── dust-client.service.ts        # workspace + agent + doc API
│   │   │   ├── dust-webhook.controller.ts    # POST /webhooks/dust (HMAC)
│   │   │   ├── dust-sync.processor.ts        # BullMQ
│   │   │   └── dust-mcp.server.ts            # @modelcontextprotocol/sdk over Fastify
│   │   ├── intel/
│   │   │   ├── financial-data.service.ts     # Bloomberg/Crunchbase adapters
│   │   │   ├── news-feed.service.ts
│   │   │   ├── hiring-signals.service.ts
│   │   │   └── win-prediction.service.ts
│   │   ├── proposal/
│   │   │   ├── proposal-draft.service.ts     # uses Dust agent + Anthropic fallback
│   │   │   └── proposal-export.service.ts    # PDF via twenty-emails renderer
│   │   ├── workflow-actions/                 # custom WF actions for `modules/workflow`
│   │   │   ├── send-to-dust.action.ts
│   │   │   ├── draft-proposal.action.ts
│   │   │   └── score-opportunity.action.ts
│   │   ├── instance-commands/                # generated via database:migrate:generate
│   │   └── graphql/                          # extra resolvers: opportunity360, intel
│   └── front/
│       ├── BidStackApp.tsx                   # registered as a marketplace app
│       ├── extensions/
│       │   ├── opportunity-360-tab.tsx       # tab on Opportunity record page
│       │   ├── intel-ribbon.widget.tsx       # ribbon at top of opportunity
│       │   ├── financial-health.widget.tsx
│       │   ├── triggers.widget.tsx
│       │   ├── decision-unit.widget.tsx
│       │   ├── win-prediction.widget.tsx
│       │   ├── competitor-radar.widget.tsx
│       │   ├── account-brief.widget.tsx      # uses Twenty's `modules/ai`
│       │   ├── dust-sidebar.tab.tsx          # registers in the right rail
│       │   └── proposal-composer.tab.tsx
│       ├── command-menu/                     # extra commands registered to /command-menu
│       │   └── bidstack.commands.ts
│       ├── navigation/                       # left-nav entries via /navigation-menu-item
│       │   └── bidstack.nav.ts
│       ├── dashboards/                       # presets registered to /dashboards
│       │   ├── bid-portfolio.dashboard.ts
│       │   ├── pipeline-velocity.dashboard.ts
│       │   └── win-loss.dashboard.ts
│       ├── pages/
│       │   ├── PipelineKanbanPage.tsx        # dedicated page for OP-2041-style boards
│       │   └── DustIntegrationPage.tsx       # sync timeline, MCP, webhooks
│       └── styles/
│           └── bidstack.linaria.ts
└── test/
    ├── bidstack.e2e.spec.ts
    └── fixtures/
```

This package is referenced in:
- `packages/twenty-server/src/modules/modules.module.ts` → import `BidStackModule` (one line)
- `packages/twenty-front/src/modules/applications/registry.ts` → register `BidStackApp` (one line)

That's the only existing-file change. **Two lines.** Everything else lives inside `twenty-bidstack/`.

---

## Standard objects (additive)

These are introduced as standard objects via Twenty's `@RegisteredStandardObject` decorator pattern, generated through `database:migrate:generate --name add-bidstack-objects --type slow`.

| Object | Relations | Notes |
|---|---|---|
| `OpportunityIntel`   | 1-1 → `Opportunity` | financials, market cap, ticker, news cache (jsonb) |
| `BuyingTrigger`      | N-1 → `Opportunity` | event, weight, source, observed_at |
| `DecisionMember`     | N-1 → `Opportunity`, N-1 → `Person` | influence (1-5), sentiment, role |
| `CompetitorBid`      | N-1 → `Opportunity` | vendor, score, strengths/weaknesses jsonb |
| `WinPrediction`      | 1-1 → `Opportunity` | score, drivers (jsonb waterfall), model_version |
| `RfpRequirement`     | N-1 → `Opportunity` | requirement, weight, response_status |
| `ProposalDocument`   | N-1 → `Opportunity`, 1-N → `Attachment` | sections jsonb, last_drafted_at |
| `DustSyncEvent`      | N-1 → `Workspace` | event_type, payload jsonb, status, error |

Everything is org-scoped automatically by Twenty's workspace schema model — nothing custom needed.

---

## UI extension strategy

Twenty's **layout-customization** module already supports per-record extra tabs and per-page extra widgets. BidStack registers into those extension points.

- **Opportunity record page** gets a "360°" tab (the page we built in this prototype).
- **Right rail** of Opportunity gets a Dust assistant slot — uses `modules/ai/` so Twenty's normal model picker, history, and quotas work.
- **Command palette** gets ~12 extra commands registered to `command-menu`'s registry.
- **Left nav** gets a "Bid pipeline" group with Portfolio / Pipeline / RFP library.
- **Settings → Integrations** gets a "Dust" panel using the existing settings-page slot pattern (same one Stripe/Google/Microsoft use).

**No global theme override.** BidStack's brand color is exposed as a workspace-level setting via Twenty's `client-config` module. If unset, BidStack uses Twenty's default theme. Toggleable per workspace.

---

## Dust integration (mounts inside the Twenty backend)

Dust is wired into Twenty's existing primitives — not run as a side-car:

- **Workflow actions** (3) — `Send opportunity to Dust`, `Draft proposal section`, `Score opportunity` — appear in the `modules/workflow` action picker, alongside the actions Twenty ships.
- **AI agent** — registered as a Dust-backed agent in `modules/ai`. Users see it in the existing AI sidebar selector.
- **Webhook endpoint** — `POST /webhooks/dust` mounted in `bidstack.module.ts`, validated via HMAC, enqueued through Twenty's existing BullMQ.
- **MCP server** — runs in `apps/mcp-server` (new tiny Nx target inside `twenty-bidstack`), reuses Twenty's auth + workspace scoping middleware.

---

## Migration & instance commands

All schema work is done through Twenty's command system. Nothing manual.

```bash
# 1. Generate the slow command that adds BidStack standard objects
npx nx run twenty-server:database:migrate:generate \
  --name add-bidstack-standard-objects --type slow

# 2. Generate per-workspace upgrade for existing tenants
npx nx run twenty-server:database:migrate:generate \
  --name backfill-bidstack-intel --type slow

# 3. Apply
npx nx run twenty-server:database:migrate:prod
```

Each command has both `up` and `down` and uses `@RegisteredInstanceCommand` / `@RegisteredWorkspaceCommand` per the CLAUDE.md convention. **No edits to existing commands.** Ever.

---

## Marketplace listing

`twenty-bidstack` ships as a first-class app in Twenty's marketplace — installable per workspace. When uninstalled:
- The standard objects stay (data is preserved, opt-in archive).
- The UI extensions, commands, nav entries, AI agent, and workflow actions disappear.
- Dust webhooks pause; no data is destroyed.

This is exactly the contract Twenty defines for marketplace apps in `modules/marketplace/`.

---

## Backwards-compatibility checklist

- [ ] No file in `packages/twenty-{front,server,ui,shared,emails,sdk,cli}` is renamed or deleted.
- [ ] Only **two** existing files are edited (one import in `modules.module.ts`, one register call in `applications/registry.ts`); both edits are additive.
- [ ] All schema additions go through `database:migrate:generate` — no raw SQL outside instance commands.
- [ ] All UI additions register through documented extension points (`navigation`, `command-menu`, `applications`, `layout-customization`, `dashboards`, `ai`, `workflow`).
- [ ] BidStack can be **uninstalled** (marketplace flow) and the app behaves as stock Twenty.
- [ ] `npx nx test twenty-server` still green after install.
- [ ] `npx nx lint:diff-with-main twenty-front` green for the new package.

---

## Hand to Claude Code

```
git clone https://github.com/mysticalsin/twenty.git
cd twenty
git checkout -b feat/bidstack-overlay
# drop the contents of `handoff/twenty-overlay/` from the prototype project
# into packages/twenty-bidstack/, then:
yarn
bash packages/twenty-utils/setup-dev-env.sh
npx nx run twenty-server:database:migrate:generate --name add-bidstack-standard-objects --type slow
npx nx run twenty-server:database:migrate:prod
yarn start
# open http://localhost:3001 — BidStack tab appears under Opportunities
```
