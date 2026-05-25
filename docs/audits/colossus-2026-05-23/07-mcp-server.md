# MCP Server Audit

## Summary
- **Tools:** 22 (15 legacy dotted + 7 crm_\*)
- **Auth method:** Bearer API key (SHA-256 hashed, checked against `prisma.apiKey`, scoped `mcp` / `read` / `write`)
- **Input validation coverage:** 100% — every tool registers a Zod schema
- **Top risk:** Raw error messages are returned to MCP clients, risking information disclosure

## Findings
| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| High | `server.ts` | 59–60 | Tool errors return `err.message` directly to the client (`isError: true`). Prisma or internal exceptions can leak DB structure or stack traces. | Return generic "Tool execution failed" to the client; log the original error server-side via `req.log.error`. |
| Medium | `auth.ts` | 39 | Fire-and-forget `lastUsedAt` update silently swallows all DB failures (`.catch(() => {})`). | Log the error (e.g., `.catch((e) => req.log.warn(e, 'lastUsedAt update failed'))`) or await the call. |
| Medium | `server.ts` | 52 | Unsafe cast `(tool.input as z.ZodObject<...>).shape`; runtime crash if a non-object Zod schema is ever registered. | Add a runtime guard: `if (!(tool.input instanceof z.ZodObject)) throw new Error(...)` before extracting `.shape`. |
| Medium | `plugins/hourly-rate-limit.ts` | 13 | Rate-limit store is an in-process `Map`; does not share state across replicas and resets on deploy. | Back the store with Redis, as noted in `docs/MCP.md`. |
| Medium | `server.ts` | 122–123 | `sseTransports` and `streamableTransports` Maps grow unbounded; abandoned sessions are never evicted. | Add a TTL (e.g., 24 h) and a periodic cleanup sweep for stale entries. |
| Low | `proposal-draft.ts` | 47–49 | Stub markdown leaks internal env-var names (`DUST_API_KEY`, `ANTHROPIC_API_KEY`) to the client. | Remove or redact env-var names from user-facing tool output. |
| Low | `crm-tools.ts` | 175 | `inputJsonSchema` for `patch` declares `additionalProperties: true`, contradicting the Zod `Patch` schema which rejects unknown keys. | Align JSON Schema with Zod: set `additionalProperties: false` inside the `patch` object. |
| Low | `crm-tools.ts` | 17 | `query: z.string().min(1).optional()` has no `maxLength`; long strings can be passed to the DB `contains` filter. | Add `.max(200)` (or appropriate bound) to the Zod schema. |

## Architecture Notes
- **No `eval` / `Function` / direct `fs` access** in tool handlers.
- **All DB access** goes through the shared `@bidstack/db` Prisma client; no raw SQL or file-system persistence in the MCP layer.
- **Audit logging** is present on every mutation tool (`auditLog.create`).
- **CORS / helmet middleware** is not configured; acceptable for a server-to-server MCP endpoint, but verify at the load-balancer / ingress level.
