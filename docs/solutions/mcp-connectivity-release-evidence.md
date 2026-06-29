# MCP Connectivity Release Evidence

## Problem

An MCP release gate that only checks discovery and `tools/list` can pass while
real tool execution is broken by auth scope, SERUM policy, session handling, or
handler/runtime drift.

## Contract

Production/staging MCP evidence must prove:

- `/.well-known/mcp` discovery exposes `/mcp`, accepting both array-shaped and
  object-shaped endpoint metadata.
- `/health` is green.
- Streamable HTTP `initialize` establishes a session.
- `notifications/initialized` is accepted.
- `tools/list` returns all required release tools.
- One read-only `tools/call` succeeds.

The default tool-call smoke is `crm_search_companies` with a no-match query and
`limit:1`. Override only with another read-only tool using
`BIDSTACK_MCP_CONNECTIVITY_SMOKE_TOOL` and JSON-object
`BIDSTACK_MCP_CONNECTIVITY_SMOKE_ARGS`.

## Privacy Rule

The release artifact must not store raw tool arguments, raw tool output, records,
JSON-RPC result bodies, or customer data. It may store tool names, status,
content/result-shape counts, and explicit `rawArgumentsIncluded:false` /
`rawOutputIncluded:false` flags.

## Verification

- `pnpm deploy:evidence:mcp:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`

Strict verification must fail missing `tools/call` proof and any artifact that
persists raw tool output.
