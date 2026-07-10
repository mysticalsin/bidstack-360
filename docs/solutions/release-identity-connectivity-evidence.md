# Release identity in connectivity evidence

## Problem

API/MCP connectivity smoke tests can pass against a healthy but stale deployment
unless the live service proves which release commit is serving traffic.

## Contract

Deployed API and MCP services expose non-secret release identity:

- `BIDSTACK_RELEASE_COMMIT`
- `BIDSTACK_RELEASE_BRANCH`

`deploy:evidence:api` requires `/livez`, `/readyz`, and `/health` to report that
identity. `deploy:evidence:mcp` requires `/.well-known/mcp` and `/health` to
report it. Strict verification compares the evidence artifact against
`deploy:evidence:source`.

## Verification

- `pnpm deploy:evidence:api:selftest`
- `pnpm deploy:evidence:mcp:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`

