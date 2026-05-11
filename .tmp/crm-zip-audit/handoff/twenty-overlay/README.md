# BidStack overlay — installation

This folder is the **drop-in overlay** that turns [`mysticalsin/twenty`](https://github.com/mysticalsin/twenty) into BidStack 360° while keeping every other part of Twenty intact and changeable.

## What gets touched in the upstream repo

**Two lines.** That's it.

1. `packages/twenty-server/src/modules/modules.module.ts` — one import + one entry in `imports[]`.
2. `packages/twenty-front/src/modules/applications/registry.ts` — one import + one `registerApplication()` call.

The exact diff is in `patches/00-register-bidstack.patch`. Apply with `git apply` or paste manually.

## What gets added

A new package `packages/twenty-bidstack/` containing:
- 8 standard objects (OpportunityIntel, BuyingTrigger, DecisionMember, CompetitorBid, WinPrediction, RfpRequirement, ProposalDocument, DustSyncEvent)
- Dust client + webhook receiver + MCP server
- 3 workflow actions registered to Twenty's WF builder
- 1 AI agent registered to Twenty's AI sidebar
- Frontend extensions: opportunity 360° tab, intel ribbon, financial-health widget, triggers widget, decision-unit widget, win-prediction gauge, competitor radar, account brief, Dust sidebar, proposal composer
- Command-menu commands, navigation entries, dashboard presets

## Install

```
git clone https://github.com/mysticalsin/twenty.git
cd twenty
git checkout -b feat/bidstack-overlay

# 1. Drop in the package
cp -R <prototype>/handoff/twenty-overlay/packages/twenty-bidstack \
      packages/

# 2. Apply the 2-line registration
git apply <prototype>/handoff/twenty-overlay/patches/00-register-bidstack.patch

# 3. Standard install + DB upgrade
yarn
bash packages/twenty-utils/setup-dev-env.sh
npx nx run twenty-server:database:migrate:generate --name add-bidstack-standard-objects --type slow
npx nx run twenty-server:database:migrate:prod
npx nx run twenty-front:graphql:generate

# 4. Run
yarn start
```

## Uninstall

`twenty-bidstack` ships as a Twenty marketplace app. From the marketplace, click *Uninstall*. The two patch lines can stay (the import becomes dead code if the package is removed); deleting the package directory + reverting `00-register-bidstack.patch` returns the tree to upstream-clean.

The 8 standard objects are preserved on uninstall by default (data safety) and can be archived from Settings → Data Model.

## Read the plan

See `MIGRATION-PLAN.md` in this folder for the full architecture, the table of which Twenty primitive serves which BidStack need, the standard-object data model, and the backwards-compatibility checklist.
