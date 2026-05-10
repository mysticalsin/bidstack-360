# PRESERVATION NOTE — twenty-bidstack

> **Do not edit files in this directory.** They are preserved verbatim from the original handoff zip (`Open CRM (1)` → `handoff/twenty-overlay/packages/twenty-bidstack/`).

## What this package is

This is the **Twenty CRM overlay variant** of BidStack 360°. It exists so that, in the future, BidStack can be migrated from the standalone monorepo (apps/web + apps/api + apps/mcp-server + apps/worker) into a `packages/twenty-bidstack/` folder of a Twenty CRM fork — with the only existing-file changes being the two-line patch in `../../handoff/twenty-overlay/patches/00-register-bidstack.patch`.

## Why it's excluded from the pnpm workspace

The package's `package.json` declares workspace dependencies on `twenty-shared`, `twenty-server`, `twenty-ui`, and `twenty-front` — workspaces that exist only inside the upstream Twenty monorepo, not in this standalone repo. `pnpm install` would fail trying to resolve them.

`pnpm-workspace.yaml` therefore excludes this directory: `- '!packages/twenty-bidstack'`. The files stay on disk; they're just not installed.

## How to use it (later)

When BidStack is ready to migrate to Twenty:

```bash
git clone https://github.com/twentyhq/twenty.git
cd twenty
git checkout -b feat/bidstack-overlay

# Drop in this directory verbatim
cp -R <bidcrm-root>/packages/twenty-bidstack packages/

# Apply the 2-line registration patch
git apply <bidcrm-root>/handoff/twenty-overlay/patches/00-register-bidstack.patch

# Standard Twenty install + DB upgrade
yarn
bash packages/twenty-utils/setup-dev-env.sh
npx nx run twenty-server:database:migrate:generate \
  --name add-bidstack-standard-objects --type slow
npx nx run twenty-server:database:migrate:prod
yarn start
```

See `../../handoff/twenty-overlay/MIGRATION-PLAN.md` for the full architecture rationale and the Twenty-primitive-to-BidStack-need mapping.

## Files preserved here

| File | Purpose |
|---|---|
| `package.json` | Original handoff manifest (workspace deps point at upstream Twenty packages) |
| `src/front/BidStackApp.tsx` | Marketplace app registration for Twenty's frontend |
| `src/server/bidstack.module.ts` | NestJS module imported by Twenty's `modules.module.ts` |
| `src/server/standard-objects/opportunity-intel.workspace-entity.ts` | The 8 BidStack standard objects (only OpportunityIntel shipped in handoff) |

## What's NOT here yet (for the migration)

The handoff sketches these directories under `src/`; they will need to be filled in during migration using the production code from `apps/api/src/routes/`, `apps/mcp-server/src/tools/`, etc.:

- `src/server/dust/` — Dust client, webhook controller, MCP server, sync processor
- `src/server/intel/` — Financial / news / hiring / win-prediction adapters
- `src/server/proposal/` — Proposal drafter + exporter
- `src/server/workflow-actions/` — `send-to-dust`, `draft-proposal`, `score-opportunity`
- `src/front/extensions/` — Opportunity 360 tab, intel ribbon, win-prediction gauge, …
- `src/front/dashboards/`, `src/front/navigation/`, `src/front/command-menu/`

The standalone build's TypeScript modules (under `apps/`) are the source of truth and can be lifted into this package when Twenty migration is greenlit.
