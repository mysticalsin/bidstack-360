# Cockpit Command Center

## Problem

The account cockpit had strong raw panels, but executives need a first-glance presales command layer: readiness, source proof, buying-unit coverage, risk pressure, and the next operational move.

## Solution

- Add a deterministic `CommandCenter` component between the cockpit KPI strip and the detailed grid.
- Derive bid readiness from existing CRM fields: health score, compliance completion, source receipts, buying committee influence, and open-risk penalty.
- Derive the next move in code from blocked compliance, urgent risks, champion availability, and source coverage. No LLM is used for deterministic routing.
- Use motion sparingly: entrance blur, progress fills, and source-orbit treatment, all compatible with `prefers-reduced-motion`.
- Keep the section contract testable with `aria-label="BidStack command center"`.

## Verification

- `pnpm --filter @bidstack/web typecheck`
- `pnpm --filter @bidstack/web lint`
- `pnpm --filter @bidstack/web e2e`
- Browser smoke the active `/accounts/:id` cockpit for command-center render and console errors.
