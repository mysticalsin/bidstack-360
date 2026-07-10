# Hardening a hand-rolled Streamable-HTTP MCP client (Sillage connector)

**Date:** 2026-07-09 · **Files:** `apps/api/src/providers/sillage-mcp-client.ts`, `sillage-signals.ts`, `lib/sillage-intel-augment.ts`

## Problem

The env-activated Sillage buying-intent connector spoke MCP naively. Against a real
server it would fail in five ways that unit tests with a friendly fake never catch:

1. **Pinned protocol version.** Client sent `MCP-Protocol-Version: 2025-06-18` on every
   request. Spec: the client must echo the version the SERVER negotiated at initialize;
   servers MUST 400 otherwise.
2. **Naive SSE parsing.** Took the first `data:` line of the last frame. SSE lets one
   event span multiple `data:` lines (join with `\n`), and streams can carry
   notifications after the response — select the frame whose JSON-RPC `id` matches.
3. **No session reuse.** A fresh client per lookup = initialize + notifications/initialized
   + tools/call (3 sequential round trips) per call. The opportunity-read augment races
   the provider against a 1.5s budget — a cold handshake loses, and the empty result was
   **negative-cached for 300s**: the UI card stays silently empty while the direct route works.
4. **Failure shaped like success.** JSON-RPC errors without a `message` fell through to
   `envelope.result` (undefined) → mapped to "quiet account, source: mcp".
5. **Health = credential presence.** The Integrations badge showed healthy if env vars
   existed; none of the above failures were visible anywhere.

## Solution pattern

- Client cached per config key (`url::token::tool`), so the negotiated version +
  `Mcp-Session-Id` persist. `initPromise ??=` memoizes concurrent handshakes; cleared on
  rejection so the next caller retries.
- Session expiry (`HTTP 404` per spec) → reset + re-initialize once + retry once.
  **Race guard:** snapshot `sessionId` AFTER `await initialize()` (the session the failed
  request actually used) and reset only if it is unchanged — the second racing 404 must
  not clobber the first caller's fresh handshake. (Snapshotting at method entry is wrong:
  cold clients snapshot `undefined` and the guard blocks legitimate resets.)
- JSON-RPC failure = presence of `error` member; synthesize a message from `code` when
  the server omits one.
- Never negative-cache a timeout/error — only genuine empty successes (short in-memory
  backoff for failures instead).
- Probe endpoint runs a REAL initialize round trip (fresh session on purpose — reusing
  the cached client would report a stale handshake as healthy) and reports lane + latency.

## Gotchas

- The soft-delete middleware analog: any *query middleware* that changes matching
  semantics silently breaks `upsert`-revival call sites elsewhere (see MISTAKES 2026-07-09).
- `restSignalsPath` without a leading slash concatenates into the HOST — normalize.
- `createSafeFetch()` must be module-level: a per-call wrapper changes fetch identity and
  defeats the client cache's reuse check.
