# SERUM Control Plane Safe Foundation

## Problem

SERUM introduces a high-trust agent control plane. It must feel premium without implying autonomous behavior, fake activity, fake confidence, or hidden production actions before the backend guarantees exist.

## Pattern

- Start with a read-only status endpoint backed by real existing tables.
- Default all SERUM feature flags to off.
- Block demo mode in production.
- Return `Cache-Control: no-store` for live control-plane status.
- Surface disabled, empty, not-configured, and attention states honestly.
- Keep settings visible but disable publish/rollback until versioned persistence and audit trails exist.
- Use existing app tokens and components; add SERUM-specific tokens only as a thin visual language layer.
- Verify with rendered desktop and mobile smoke, not screenshots alone.

## Implementation Notes

- Gate read-only SERUM status under `settings:read` when it powers admin settings/control-plane UX.
- Do not return secret material. Return booleans or health/status labels only.
- Treat N+1 detector warnings as release risks even when local latency is low.
- Batch scalar status counts into a guarded aggregate query. Keep row-list
  details like provider and queue health separate only when they are bounded.
- Expose query diagnostics in test as well as development, then assert status
  endpoints stay under the N+1 threshold.
- Use CSS keyframes for Radix mobile drawer animation when Framer/Radix ref handoff creates warnings.
- Use segmented buttons with `aria-pressed` for list/board route switches. Do not model route navigation as tabs unless there are real tab panels.

## Verification

- API returns 200 and `Cache-Control: no-store`.
- Disabled mode clearly says autonomous loops are not exposed.
- Publish/rollback remain disabled until persistence exists.
- Mobile drawer opens and closes with no console warnings.
- Sidebar/nav hit targets remain at least 44px.
- Critical toolbar controls pass Playwright, including board/list switch, import validation, CSV export, new-opportunity dialog, topbar controls, and keyboard-reachable menus.
- Focused route tests assert `X-Query-Count <= 10` and no `N+1 detected`
  warning for `/api/v1/serum/status`.

## 2026-06-19 Dust Gateway Guard Default-Off Contract

The SERUM Dust/MCP Gateway is an enterprise safety rail, but SERUM remains
default-off until its versioned policies, approvals, and runtime gates are
configured. Existing Dust-backed workflows must therefore keep working when
`SERUM_ENABLED` is unset or `false`.

Pattern:

- API and worker Dust clients skip only the SERUM gateway runtime check when
  `SERUM_ENABLED !== 'true'`.
- When `SERUM_ENABLED=true`, the same guard remains fail-closed and blocks
  denied Dust reads/writes before any network request.
- Keep this invariant mirrored across API and worker Dust credential wrappers.

Implementation:

- `apps/api/src/lib/dust-credentials.ts`
- `apps/api/src/lib/dust-credentials.test.ts`
- `apps/worker/src/lib/dust-credentials.ts`
- `apps/worker/src/lib/dust-credentials.test.ts`

Verification:

- `pnpm --filter @bidstack/api exec vitest run src/lib/dust-credentials.test.ts --reporter=dot`:
  2/2 pass.
- `pnpm --filter @bidstack/worker exec vitest run src/lib/dust-credentials.test.ts --reporter=dot`:
  3/3 pass.
- API and worker TypeScript: pass.
- Targeted API and worker ESLint for Dust credential files: pass.

## 2026-06-19 Hot-Path Runtime Guard Query Budget

Runtime guards run on user-facing operations and MCP tool calls, so they must
not resolve the full SERUM control-plane snapshot when a decision needs only
one policy slice.

Pattern:

- Keep `resolveSerumRuntimePolicy` for admin snapshots and status views.
- Runtime guard functions read only their own active config row.
- Agent runtime checks remain a two-read path because they also need the
  current active crew-run count.
- Connector checks may read fresh connection-test evidence only after the
  connector policy itself requires it.
- Tests assert query shape, not only allow/deny behavior.

Implementation:

- `packages/db/src/serum-runtime-policy.ts`
- `packages/db/src/serum-runtime-policy.test.ts`

Verification:

- `pnpm --filter @bidstack/db exec vitest run src/serum-runtime-policy.test.ts --reporter=dot`:
  6/6 pass.
- `pnpm --filter @bidstack/db exec eslint --no-ignore --no-warn-ignored src/serum-runtime-policy.ts src/serum-runtime-policy.test.ts --max-warnings=0`:
  pass.
- `pnpm --filter @bidstack/db build`: pass.
- API, worker, and MCP server TypeScript checks: pass.
- `pnpm deploy:evidence:production`: expected block, 44 pass / 77 fail.

### Model Router Runtime Note

Model Router admin snapshots may check the org's active provider and provider
credential readiness for display. Per-request runtime checks must not do that
extra readiness probe when the caller supplies the provider being executed.

The runtime guard should:

- Read only `model_router/<configKey>`.
- Validate the requested provider against the policy default/fallback list.
- Check runtime credentials once for the requested provider only after provider
  allowlist, citation, token, and uncertainty-mode checks pass.
- Treat `gemma` as credential-ready without SQL side queries.

Regression: explicit Gemma route checks assert one active-config lookup and no
`$queryRaw` calls.
