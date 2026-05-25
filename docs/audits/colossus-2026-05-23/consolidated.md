# Colossus Audit — Consolidated Report
**Date:** 2026-05-23  
**Scope:** Full BIDCRM 360° monorepo (apps/api, apps/web, apps/worker, apps/mcp-server, packages/*)  
**Agents:** 10 parallel domain-specific audits  
**Total findings:** 90+ across all domains

---

## Severity Summary

| Severity | Count | Domains |
|----------|-------|---------|
| 🔴 Critical | 3 | DevOps (1), Database (1), Web Performance (1) |
| 🟠 High | 18 | Security (3), API Arch (4), Database (3), Web Perf (2), Worker (3), MCP (1), DevOps (3), Integrations (2) |
| 🟡 Medium | 35 | API Arch (5), Database (3), Web Perf (3), Web Quality (5), Worker (5), MCP (4), DevOps (3), Integrations (4), Standards (3) |
| 🟢 Low | 25 | Security (2), API Arch (4), Database (3), Web Perf (4), Worker (2), MCP (3), DevOps (2), Integrations (2), Standards (3) |
| 🔵 Info | 9 | Web Quality (3), Standards (6) |

---

## Top 10 Critical/High Findings (Cross-Domain)

### 1. 🔴 CRITICAL — Worker & MCP containers have zero health probes
**Agent:** S8 DevOps  
**Files:** `Dockerfile` (worker/mcp targets), `apps/worker/src/main.ts`, `apps/mcp-server/src/main.ts`  
**Issue:** No `HEALTHCHECK` in Dockerfile, no `/health` endpoint in code. Orchestrators cannot detect failure → silent crashes, undetected downtime.  
**Fix:** Add `HEALTHCHECK` to Dockerfile targets; expose `/health` in worker and MCP server.

### 2. 🔴 CRITICAL — Unbounded parallel Prisma queries cause intermittent 500s
**Agent:** S2 API Architecture  
**Files:** `services/crm/dashboard.service.ts:1-1594`, `crm/summary.ts`  
**Issue:** 12–14 heavy Prisma queries fired via `Promise.all` with no transaction boundary, timeout, or circuit breaker. C-2 bug root cause identified.  
**Fix:** Wrap in `$transaction`, add query timeout, implement circuit breaker, consider materialized view for dashboard data.

### 3. 🔴 CRITICAL — Missing `@@index` on foreign keys causing table scans
**Agent:** S3 Database  
**Files:** `schema.prisma` — `ActivityAttendee.orgId`, `Note.authorUserId`, `Opportunity.territoryId`, `Company.keyAccountOwnerId`, `DocumentVersion.fileAttachmentId`  
**Issue:** 6+ missing `@index` directives on high-cardinality foreign keys → full table scans on joins.  
**Fix:** Add `@@index([field])` to each; generate and deploy migration.

### 4. 🟠 HIGH — Eager JS payload >300 KB gzip blocking FCP/LCP
**Agent:** S4 Web Performance  
**Files:** `apps/web/vite.config.ts`, build output  
**Issue:** Entry chunk 170 KB raw / 46.5 KB gzip + react-dom (130 KB) + vendor (133 KB) + motion (260 KB) + clerk + radix + tanstack + zod + sentry = ~300+ KB gzip before any lazy routes.  
**Fix:** Code-split clerk into auth-only route, defer motion library, analyze vendor bundle for duplication.

### 5. 🟠 HIGH — Microsoft/Salesforce plugins use naked `fetch` with no timeout/retry
**Agent:** S9 Integrations  
**Files:** `microsoft.ts`, `salesforce.ts` (placeholder routes)  
**Issue:** No `AbortSignal.timeout()`, no retry logic, no Pino logging on failure. Network hiccups = silent failures.  
**Fix:** Apply same retry/backoff pattern as `dust-client` and `odoo-mcp-client`.

### 6. 🟠 HIGH — `authorizedParties` can become empty array, weakening Clerk JWT verification
**Agent:** S1 Security  
**Files:** `apps/api/src/plugins/auth.ts:90`  
**Issue:** If `PUBLIC_BASE_URL` is unset, `authorizedParties` array is empty, bypassing audience validation.  
**Fix:** Enforce non-empty `authorizedParties` — throw if `PUBLIC_BASE_URL` missing in production.

### 7. 🟠 HIGH — `.env.example` missing required production env vars
**Agent:** S8 DevOps  
**Files:** `.env.example`  
**Issue:** Missing `STORAGE_DRIVER`, `STORAGE_SCAN_REQUIRED`, `JOB_SIGNING_SECRET`, OCR env vars. Production deploys fail or fall back to unsafe defaults.  
**Fix:** Audit all `process.env` references and sync to `.env.example` with descriptions.

### 8. 🟠 HIGH — Route bloat: 3 route files >700 lines mixing business logic inline
**Agent:** S2 API Architecture  
**Files:** `invoices.ts` (845), `territories.ts` (735), `agents.ts` (732)  
**Issue:** Business logic, serializers, and Prisma calls mixed in routes — violates 400-line cap, untestable, unmaintainable.  
**Fix:** Extract service layer per domain; routes should only validate + delegate.

### 9. 🟠 HIGH — Dust/Odoo clients don't retry on network-level errors (ECONNRESET)
**Agent:** S9 Integrations  
**Files:** `packages/dust-client/src/`, `packages/odoo-mcp-client/src/`  
**Issue:** Retry only on HTTP 429/5xx, not TCP-level failures. Transient network blips cause permanent job failures.  
**Fix:** Add `retry-on-network-error` flag with exponential backoff for `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`.

### 10. 🟠 HIGH — `document-extract` worker can leave stale `running` statuses forever on crash
**Agent:** S6 Worker  
**Files:** `apps/worker/src/processors/document-extract.ts`  
**Issue:** No crash-recovery or heartbeat mechanism. If worker crashes mid-extraction, status stays `running` indefinitely.  
**Fix:** Add heartbeat/lease pattern or stale-job reaper with timeout.

---

## Domain Summaries

### S1 — Security (7 findings)
- **Auth:** Clerk `authorizedParties` empty-array fallback; loose `publishableKey` falsy check; Dust API key prefix exposure
- **Injection:** Clean — no raw SQL interpolation, no `eval()`/`Function()`
- **XSS:** CSP gap (inline theme script without nonce/hash); no `dangerouslySetInnerHTML`
- **Secrets:** `check-secrets.sh` pattern list too narrow

### S2 — API Architecture (13 findings)
- **C-2 500 bug:** Root cause identified — unbounded `Promise.all` in dashboard service
- **Route bloat:** Top 3 files 732–845 lines; 213 inline Zod schemas
- **Transactions:** Only 41 `$transaction` calls across 38 Prisma files
- **Org-scoping:** 97% coverage (health endpoint unscoped by design)
- **Error handling:** Only 3 Prisma error codes mapped; timeouts become opaque 500s

### S3 — Database (9 findings)
- **76 models, 30 enums, 19 migrations**
- **108 unbounded `findMany`** without `take`/`skip`/`limit`
- **78 nested `include:`** — N+1 risk
- **Missing indexes:** 6+ foreign keys unindexed
- **Soft-delete inconsistency:** `isActive` + `deletedAt` + `revokedAt` + none — mixed patterns
- **66 JSON fields** with no DB-level validation
- **Junction tables** `RolePermission` and `UserRole` lack `orgId` and `deletedAt`

### S4 — Web Performance (10 findings)
- **~300 KB gzip eager payload**
- **40 lazy-loaded routes** (good)
- **52 `useEffect`** — potential re-render issues
- **1 `setTimeout` without cleanup** (`ApiKeysSection.tsx:85`)
- **8+ `<img>` tags** without `srcset` or modern formats
- **Hand-rolled service worker** (88 lines) — no `vite-plugin-pwa`

### S5 — Web Quality (16 findings)
- **TypeScript strictness strong:** `strict: true`, zero `@ts-ignore`, ~0 explicit `any`
- **16 test files** — sparse coverage; no Vitest coverage reporting configured
- **268 `as` type assertions** — mostly `JSON.parse` and DOM casts
- **9 Zustand stores** — all use hand-rolled localStorage persistence instead of `zustand/middleware/persist`
- **6 of 35 UI primitives** have tests (~17% UI test coverage)
- **3 `console.error`** in production entrypoints

### S6 — Worker Reliability (10 findings)
- **4 job processors** audited
- **Retry configs centralized** in `@bidstack/shared` ✓
- **3 HIGH:** deterministic signature failures retried 5×; stale `running` on crash; multi-step DB writes lack transactions
- **5 MEDIUM:** missing error handlers, non-atomic webhook processing, local-only circuit breaker, non-idempotent audit log, silent DB error swallowing

### S7 — MCP Server (8 findings)
- **22 tools, 100% Zod schema coverage** ✓
- **No `eval`/`fs`/raw SQL** in tools ✓
- **HIGH:** Raw `err.message` returned to clients (info disclosure)
- **MEDIUM:** Fire-and-forget `lastUsedAt` swallows DB errors; unsafe `as z.ZodObject` cast; in-process rate-limit `Map` (no replica scaling); unbounded session Maps (no TTL)

### S8 — DevOps & Infrastructure (10 findings)
- **Critical:** Zero health probes on worker/MCP
- **High:** Missing env vars in `.env.example`; `.dockerignore` bloat
- **Medium:** Web Dockerfile healthcheck hits `/` not `/health`; CI tests stub auth while prod uses Clerk; Redis lacks healthcheck

### S9 — Integrations (10 findings)
- **Dust & Odoo clients:** Well-hardened (timeout, retry, HMAC, typed errors) ✓
- **Webhook receiver:** Secured (replay window, dedup, constant-time HMAC) ✓
- **HIGH:** Microsoft/Salesforce naked `fetch` (no timeout/retry)
- **MEDIUM:** No retry on `ECONNRESET`; orphaned `IntegrationRegistry`; undocumented `odoo_status_probe` tool

### S10 — Code Standards (10 findings)
- **HIGH:** `@typescript-eslint/no-unsafe-*` fully disabled project-wide
- **MEDIUM:** `no-explicit-any` disable without WHY; vague `WHY: see above`; 6× `react-refresh` disables
- **INFO:** 10+ repeat violations in `MISTAKES.md`; `docs/solutions/` (22 files) has zero code references
- **Clean:** Zero deep relative imports (`../../..`); only 1 default export in packages (config file); zero TODO/FIXME/HACK comments

---

## Files Modified
**None** — all agents operated read-only per audit scope.

## Next Steps
See `action-items.md` for prioritized fix list.
