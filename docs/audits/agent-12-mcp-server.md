# MCP Server Domain Audit — BidStack 360°

**Scope:** `apps/mcp-server/src/**/*.ts`  
**Rubric:** Functional 25 + Code 25 (scaled to 0–100)  
**Auditor:** Agent-12  
**Date:** 2026-05-23

---

## 1. Score: 74 / 100

| Dimension      | Points  | Notes                                                                                                                                                                                                                                   |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Functional** | 17 / 25 | All 22 tools register and execute. Auth + rate-limiting work. Stub paths (proposal draft, insights) are documented. Gaps: raw error disclosure to clients, inconsistent JSON Schema fidelity, split-transaction bug in lead conversion. |
| **Code**       | 18 / 25 | Clean modular structure, good TypeScript, solid auth/rate-limit tests. Gaps: unsafe runtime cast, unbounded in-memory Maps, no graceful shutdown, missing transport-layer tests.                                                        |

---

## 2. Strengths

- **Dual-transport architecture with session isolation.** The server simultaneously exposes the modern Streamable HTTP transport (`/mcp`) and the legacy SSE transport (`/mcp/sse` + `/mcp/messages`). Sessions are bound to the authenticated API key and validated on every request (`server.ts:145-154`, `server.ts:222-229`).
- **Redis-backed sliding-window rate limiter.** The custom hourly plugin (`plugins/hourly-rate-limit.ts:24-159`) uses a one-minute-bucket algorithm pipelined to Redis, sharing the per-key budget across all replicas. It fails open when Redis is unreachable, matching the short-window `@fastify/rate-limit` behaviour (`server.ts:94-112`).
- **Cryptographically-sampled audit logging.** `auth.ts` emits an `apikey.used` audit row at exactly 1 % using `crypto.randomInt`, with a test seam for deterministic coverage (`auth.ts:23-39`, `auth.ts:95-109`). The full token is never persisted—only a 12-char prefix.
- **100 % Zod schema coverage on tools.** Every registered tool declares a Zod input validator and a manual JSON Schema mirror (`tools/index.ts:31-36`). Scope-based RBAC (`read` vs `write`) is enforced for all 22 tools (`tools/index.ts:78-107`).
- **Deterministic, well-commented failure modes.** The Redis client (`redis.ts:13-18`) disables the offline queue and caps retries, preventing thundering-herd reconnects. The hourly rate-limit plugin documents the trade-off of fail-open vs fail-closed (`plugins/hourly-rate-limit.ts:16-22`).

---

## 3. P0 Gaps — Protocol Violations, Auth Flaws, Broken Tools

### 3.1 Raw error messages leaked to MCP clients (Information Disclosure)

**File:** `apps/mcp-server/src/server.ts` **Lines:** 59–61  
The global `try/catch` in `createAuthenticatedMcp` returns `err.message` directly inside the MCP error payload:

```ts
catch (err) {
  const message = err instanceof Error ? err.message : 'Internal error';
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
```

Prisma `P2025` or `P2002` messages, stack traces from internal utilities, or file-system paths can leak database structure and internal topology to the LLM client. This is both an auth/confidentiality flaw and a protocol-compliance issue: the MCP spec expects tool errors to be machine-safe; raw ORM errors are not.

### 3.2 Unsafe runtime cast of Zod schemas

**File:** `apps/mcp-server/src/server.ts` **Line:** 52–53

```ts
mcp.tool(
  name,
  tool.description,
  (tool.input as z.ZodObject<z.ZodRawShape>).shape,
  async (args: unknown) => { ... }
);
```

If a future tool registers a non-object Zod type (`z.string()`, `z.array(...)`, or a `z.union()`), this cast will crash at runtime during server startup or session creation. A runtime guard (`tool.input instanceof z.ZodObject`) is required before extracting `.shape`.

### 3.3 Unbounded session Maps with no TTL or eviction sweep

**File:** `apps/mcp-server/src/server.ts` **Lines:** 133–134, 164–172, 201–209  
`streamableTransports` and `sseTransports` are in-memory `Map`s. Entries are deleted only when the transport `onclose` callback fires. A buggy or malicious client that opens sessions without closing them (or aborts the underlying TCP connection before the SDK detects closure) will cause unbounded memory growth. In a multi-replica deployment this is capped per pod, but it is still a local DoS vector.

### 3.4 Lead-convert tool leaves DB in inconsistent state on partial failure

**File:** `apps/mcp-server/src/tools/leads-convert.ts` **Lines:** 49–90  
The Prisma transaction updates the lead status to `'converted'` but does **not** set `convertedToOpportunityId` (it passes a no-op `set: undefined`). The actual opportunity ID is written in a **second, non-transactional** update immediately after:

```ts
await prisma.$transaction([
  prisma.opportunity.create({...}),
  prisma.contact.create({...}),
  prisma.lead.update({
    where: { id: lead.id },
    data: { status: 'converted', convertedToOpportunityId: { set: undefined } },
  }),
]);

// If this fails, the lead is 'converted' with no linked opportunity.
await prisma.lead.update({
  where: { id: lead.id },
  data: { status: 'converted', convertedToOpportunityId: opp.id, convertedAt: new Date() },
});
```

If the process crashes or the DB connection drops between the transaction commit and the second update, the lead remains permanently in `status: 'converted'` with `convertedToOpportunityId: null`. This is a broken business-logic invariant.

---

## 4. P1 Gaps — Performance, Error Handling, Schema Compliance

### 4.1 Fire-and-forget `lastUsedAt` update silently swallowed

**File:** `apps/mcp-server/src/auth.ts` **Line:** 90

```ts
prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
```

All failures (connection loss, lock timeout, replica lag) are silently discarded. Operational degradation is invisible. The comment acknowledges the fire-and-forget pattern, but at minimum the error should be logged (`req.log.warn`).

### 4.2 Manually maintained JSON Schema diverges from Zod definitions

**Files:** Multiple  
The `inputJsonSchema` field is hand-written alongside every Zod schema, creating a dual-maintenance hazard. Concrete divergences found:

- **`tools/opportunities-get.ts:21-28`** — The Zod schema uses `.refine((v) => v.id || v.code, { message: 'Provide either id or code' })`, but the JSON Schema does not declare `required: []` or a `oneOf` constraint, so a client that passes `{}` will receive a runtime validation error rather than a schema-level rejection.
- **`tools/crm-tools.ts:170-178`** (`crmUpdateDeal`) — The `patch` object declares `additionalProperties: true`, while the Zod `Patch` schema rejects unknown keys. Clients that rely on the JSON Schema for auto-complete may send extra keys and then receive a Zod error.
- **`tools/crm-tools.ts:17`** (`crmSearchCompanies`) — `query: z.string().min(1).optional()` has no `.max(200)` bound; the JSON Schema likewise omits `maxLength`, allowing arbitrarily long `contains` queries.

### 4.3 No graceful shutdown on SIGTERM / SIGINT

**File:** `apps/mcp-server/src/main.ts` **Lines:** 14–37  
The Fastify MCP server and the standalone Node.js health server are never closed on process termination signals. Under Kubernetes rollouts or Docker Stop, in-flight requests are aborted at the kernel level rather than drained, which can leave MCP sessions half-closed and Redis rate-limit buckets in an odd state.

### 4.4 Missing test coverage for crm\_\* tools and leadsConvert

**File:** `apps/mcp-server/src/tools/tools.test.ts`  
The existing DB-backed tests exercise ~11 of the 22 tools. The following are **not** tested:

- All 7 `crm_*` tools (`crm_search_companies`, `crm_create_deal`, `crm_update_deal`, `crm_enrich_company`, `crm_list_activities`, `crm_create_activity`, `crm_generate_insights`)
- `leads.convert`
- `contacts.list` (only `contacts.create` + `contacts.get`)
- `opportunities.list` (only `opportunities.get`)

### 4.5 No transport-layer integration tests

**File:** `apps/mcp-server/src/server.ts`  
There are zero tests for the Streamable HTTP handler (`/mcp`), the SSE endpoint (`/mcp/sse`), or the message POST endpoint (`/mcp/messages`). Session lifecycle, key binding, `mcp-session-id` reuse, and JSON-RPC error formatting are all exercised only in production.

### 4.6 Internal environment-variable names leaked in tool output

**File:** `apps/mcp-server/src/tools/proposal-draft.ts` **Lines:** 45–49  
The stub response includes literal env-var names:

```ts
const markdown = `...set:
- \`DUST_API_KEY\`
- \`DUST_AGENT_EXEC_BRIEF\`...
`;
```

This discloses internal integration surface area to any MCP client.

---

## 5. P2 Gaps — Nice-to-Have Improvements

### 5.1 Inconsistent audit action naming convention

**Files:** `apps/mcp-server/src/tools/tasks-create.ts:54` vs `tasks-update.ts:64`  
Most mutation tools suffix the action with `.mcp` (e.g., `task.update.mcp`, `lead.create.mcp`), but `tasksCreate` writes `task.create` without the suffix. This complicates audit-log filtering and reporting.

### 5.2 Non-deterministic author selection for notes

**File:** `apps/mcp-server/src/tools/notes-create.ts` **Lines:** 30–33

```ts
const author = await prisma.user.findFirst({
  where: { orgId: ctx.orgId },
});
```

`findFirst` without an `orderBy` returns an arbitrary user, making attribution random. The tool should either require an explicit `authorEmail` parameter or use a deterministic fallback (e.g., the org’s oldest admin).

### 5.3 Search query fields lack upper-bound validation

**Files:** `apps/mcp-server/src/tools/crm-tools.ts:17`, `leads-list.ts:19`, `opportunities-list.ts:13`  
Multiple `search` / `query` fields accept unbounded strings. Adding `.max(200)` or `.max(500)` in Zod (and the corresponding JSON Schema `maxLength`) prevents accidental or malicious large `LIKE` payloads.

### 5.4 Inconsistent nullish-coalescing operators in main.ts

**File:** `apps/mcp-server/src/main.ts` **Lines:** 10, 12

```ts
const port = Number(process.env.PORT_MCP ?? 4001);
const healthPort = Number(process.env.MCP_HEALTH_PORT || 4003);
```

`PORT_MCP` uses `??` (nullish) while `MCP_HEALTH_PORT` uses `||` (falsy). An empty-string value for `MCP_HEALTH_PORT` will fall back to `4003`, but `PORT_MCP` will become `NaN`. Standardise on `??` everywhere.

### 5.5 Redis client swallows all connection errors silently

**File:** `apps/mcp-server/src/redis.ts` **Lines:** 20–23

```ts
redis.on('error', () => {
  // Swallow connection errors here...
});
```

While the comment explains that the rate-limit plugin handles visibility via `skipOnError`, a permanently broken Redis is invisible to operators except through the `/health` endpoint (which is not guaranteed to test Redis connectivity). A periodic log line or metric emission would aid observability.

---

## 6. Evidence

### 6.1 Error disclosure (P0)

```ts
// apps/mcp-server/src/server.ts  L59-61
catch (err) {
  const message = err instanceof Error ? err.message : 'Internal error';
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}
```

### 6.2 Unsafe ZodObject cast (P0)

```ts
// apps/mcp-server/src/server.ts  L52-53
mcp.tool(
  name,
  tool.description,
  (tool.input as z.ZodObject<z.ZodRawShape>).shape,
  async (args: unknown) => { ... }
);
```

### 6.3 Unbounded Maps (P0)

```ts
// apps/mcp-server/src/server.ts  L133-134
const sseTransports = new Map<string, SseSession>();
const streamableTransports = new Map<string, StreamableSession>();
```

No TTL, max-size, or periodic sweep is configured.

### 6.4 leadsConvert split transaction (P0)

```ts
// apps/mcp-server/src/tools/leads-convert.ts  L49-90
const [opp, contact] = await prisma.$transaction([
  prisma.opportunity.create({...}),
  prisma.contact.create({...}),
  prisma.lead.update({ where: { id: lead.id }, data: { status: 'converted', convertedToOpportunityId: { set: undefined } } }),
]);

await prisma.lead.update({
  where: { id: lead.id },
  data: { status: 'converted', convertedToOpportunityId: opp.id, convertedAt: new Date() },
});
```

### 6.5 Silent lastUsedAt failure (P1)

```ts
// apps/mcp-server/src/auth.ts  L90
prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
```

### 6.6 JSON Schema / Zod divergence (P1)

```ts
// apps/mcp-server/src/tools/opportunities-get.ts  L7-15
const Input = z.object({ id: z.string().uuid().optional(), code: z.string().regex(/^OP-\d{4}$/).optional() })
  .refine((v) => v.id || v.code, { message: 'Provide either id or code' });

// apps/mcp-server/src/tools/opportunities-get.ts  L21-28
inputJsonSchema: {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^OP-\d{4}$' } },
  additionalProperties: false,
},
```

The JSON Schema does not encode the `oneOf` / `required` semantics that the Zod `.refine()` enforces.

### 6.7 Missing graceful shutdown (P1)

```ts
// apps/mcp-server/src/main.ts  L14-37
const server = await buildMcpServer();
try {
  await server.listen({ port, host });
} catch (err) { ... }

const healthServer = createServer((req, res) => { ... });
healthServer.listen(healthPort, host, () => { ... });
```

No `process.on('SIGTERM', ...)` or `process.on('SIGINT', ...)` hooks are present.

---

## 7. Action Summary

| Priority | Count | Top fix                                                                                                                                                                                                                          |
| -------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | 4     | Sanitise tool errors to generic messages; add ZodObject guard; cap session Maps with a TTL + sweep; merge leadsConvert into a single interactive transaction.                                                                    |
| **P1**   | 6     | Log `lastUsedAt` failures; derive JSON Schema from Zod automatically (or add parity tests); add graceful shutdown; expand tool tests to cover all 22 tools; add transport integration tests; redact env vars from proposal stub. |
| **P2**   | 5     | Standardise audit action names; deterministic note author; add `.max()` bounds to search fields; unify `??` operators; emit Redis error metrics.                                                                                 |
