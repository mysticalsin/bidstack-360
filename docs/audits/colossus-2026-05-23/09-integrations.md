# Integration Audit

## Summary
- **Dust client:** Good — bearer auth, 10 s timeout, exponential-backoff retry (429/5xx), typed `DustError`, constant-time HMAC verification.
- **Odoo client:** Good — 15 s timeout, exponential-backoff retry (429/5xx), MCP session reuse, SSE parsing, typed `OdooMcpError`.
- **Webhook verification:** Good — HMAC-SHA256 with constant-time compare, 5-minute replay window, Redis-backed dedup (7 d) with in-memory fallback, subscription-based org resolution, payload-org mismatch rejection.
- **Top risk:** Microsoft and Salesforce plugins use naked `fetch` without timeout, retry, or logging, violating the resilience pattern established by Dust/Odoo clients. Additionally, the `IntegrationRegistry` in `packages/integrations` is instantiated but never imported by `apps/api`, leaving the plugin architecture orphaned.

## Findings

| Severity | File | Line | Issue | Fix |
|----------|------|------|-------|-----|
| **High** | `packages/integrations/src/microsoft/index.ts` | 49, 87, 106, 156, 174 | Naked `fetch` calls (token exchange, Graph API, refresh, tool execution) have **no timeout, no retry, and no structured logging**. Transient failures hang or propagate raw to users. | Wrap all outbound calls in a shared resilient HTTP helper (timeout + exponential-backoff retry + Pino logging), matching `DustClient.request` and `OdooMcpClient.fetchWithRetry`. |
| **High** | `packages/integrations/src/salesforce/index.ts` | 48, 89, 108, 157, 176 | Same as above: all `fetch` calls lack timeout, retry, and logging. | Same fix: adopt the shared resilient HTTP helper. |
| **Medium** | `packages/dust-client/src/index.ts` | 200 | Network-level errors (`ECONNRESET`, `ETIMEDOUT`, DNS failure) are **not retried**; only HTTP 429/5xx trigger retry. A flaky connection fails permanently on the first transient TCP error. | Catch `TypeError` / network errors in the `catch` block and retry them with the same backoff policy (up to 3 attempts). |
| **Medium** | `packages/odoo-mcp-client/src/index.ts` | 364 | Same network-error retry gap as Dust client. | Same fix: retry on network-level `fetch` rejections. |
| **Medium** | `packages/integrations/src/odoo/index.ts` | 17–25 | `getClient` instantiates a **new `OdooMcpClient` on every call**, causing redundant MCP `initialize` handshakes and session proliferation on the sidecar. | Cache the client instance (e.g., per-org singleton) or reuse the memoized pattern from `apps/api/src/routes/erp-integration.ts`. |
| **Medium** | `packages/integrations/src/odoo/index.ts` | 40 | `connect` calls `client.callTool('odoo_status_probe', {})`, but **`odoo_status_probe` is not a documented/standard tool** in the MCP client or server spec. The probe will 500 if the sidecar doesn't expose it. | Use `client.listTools()` or `client.searchRecords` as the health probe. |
| **Medium** | `packages/integrations/src/index.ts` | 12–17 | `integrationRegistry` is instantiated and populated, but **no API route imports or uses it**. The plugin architecture is orphaned; `apps/api` still uses legacy/placeholder routes (`microsoft.ts`, `erp-integration.ts`, `dust-integration.ts`). | Create `apps/api/src/routes/integrations.ts` to mount the registry, or remove the unused plugin layer to reduce maintenance surface. |
| **Low** | `packages/integrations/src/microsoft/index.ts` | 23 + `packages/integrations/src/salesforce/index.ts` | 23 | OAuth `state` is deterministic (`base64url({ orgId, provider })`) with **no cryptographically random nonce**, and the `connect` method never verifies it. Weakens CSRF protection. | Append `crypto.randomBytes(16).toString('hex')` to state and verify it in the OAuth callback handler. |
| **Low** | `packages/integrations/src/odoo/index.ts` | 21–24 | `getClient` omits the `logger` option, so Odoo client falls back to a default unnamed Pino instance. Breaks request-scoped log correlation. | Accept and pass a `logger` parameter (or use `req.log.child`) into `OdooMcpClient`. |
| **Low** | `packages/integrations/src/microsoft/index.ts` | 137 + `packages/integrations/src/salesforce/index.ts` | 141 | `sync()` is a TODO stub returning `{ created: 0, updated: 0, deleted: 0, errors: [] }`. If scheduled by a worker it silently does nothing. | Implement incremental sync or remove the stub and document the integration as "connect only" in the UI. |

## Notes
- `apps/api/src/routes/integrations.ts` (requested in scope) **does not exist**. The API uses `dust-integration.ts`, `erp-integration.ts`, and the placeholder `microsoft.ts` instead.
- Webhook route (`apps/api/src/routes/webhooks.ts`) correctly implements the full security chain: signature → timestamp → dedup → org resolution → payload validation. No findings.
- No `TODO`/`FIXME`/`HACK` items were found in the audited `packages/` source files (only in Prisma generated code, which is out of scope).
