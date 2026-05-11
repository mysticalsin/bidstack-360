# BidStack 360°

> **Bid & presales CRM with 360° intelligence, Dust agents, and MCP tools.**
> Vendor: Mantu. Workspace: `BIDCRM`. Status: v0.1 (in development).

This monorepo ships the standalone build of BidStack 360°. A future migration path to Twenty CRM as an overlay package is preserved verbatim under `packages/twenty-bidstack/`.

---

## What's inside

```
BIDCRM/
├── apps/
│   ├── web/              # React 18 + Vite + Tailwind — opportunity intel UI
│   ├── api/              # Fastify 5 + Zod + Pino — REST per openapi.yaml
│   ├── worker/           # BullMQ — Dust polling, enrichment jobs
│   └── mcp-server/       # @modelcontextprotocol/sdk — 6 tools exposed to Dust
├── packages/
│   ├── db/               # Prisma 5 — schema, migrations, client
│   ├── dust-client/      # Typed Dust workspace API wrapper
│   ├── shared/           # Zod schemas, shared types
│   └── twenty-bidstack/  # Twenty overlay (preserved from handoff zip)
├── docs/
├── .claude/              # Hooks, agents, project rules
├── CLAUDE.md             # 14 conduct rules + project architecture
├── SPEC.md               # Canonical product spec
├── PROGRESS.md           # Sprint log
└── MISTAKES.md           # Repeated-mistake ledger
```

---

## Quick start

```bash
# 1. Install
pnpm install

# 2. Spin up Postgres + Redis (docker)
docker compose up -d

# 3. Set env
cp .env.example .env

# 4. Migrate + seed
pnpm db:migrate
pnpm db:seed

# 5. Run everything
pnpm dev
```

Then open:

- Web: http://localhost:5173
- API: http://localhost:4000
- MCP: http://localhost:4001

---

## Scripts

| Command           | What it does                                    |
| ----------------- | ----------------------------------------------- |
| `pnpm dev`        | Run web + api + worker + mcp-server in parallel |
| `pnpm dev:web`    | Web only                                        |
| `pnpm dev:api`    | API only                                        |
| `pnpm db:migrate` | Apply Prisma migrations                         |
| `pnpm db:seed`    | Seed from prototype fixtures                    |
| `pnpm db:reset`   | **Destructive** — drop + recreate (confirms)    |
| `pnpm typecheck`  | All packages                                    |
| `pnpm lint`       | All packages                                    |
| `pnpm test`       | Vitest across all packages                      |
| `pnpm e2e`        | Playwright on the web app                       |
| `pnpm build`      | Production build of every package               |

---

## Documentation

- [`SPEC.md`](./SPEC.md) — Canonical product spec
- [`CLAUDE.md`](./CLAUDE.md) — 14 conduct rules + project architecture
- [`PROGRESS.md`](./PROGRESS.md) — Sprint log
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Architecture overview
- [`docs/DUST.md`](./docs/DUST.md) — Dust integration patterns
- [`docs/MCP.md`](./docs/MCP.md) — MCP server design

---

## License

Proprietary — © Mantu, all rights reserved.
