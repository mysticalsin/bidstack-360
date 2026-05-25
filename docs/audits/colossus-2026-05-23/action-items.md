# Colossus Audit — Action Items
**Date:** 2026-05-23  
**Source:** 10-agent parallel deep audit (`docs/audits/colossus-2026-05-23/`)

---

## P0 — Fix This Week (Critical)

| # | Issue | Owner | Effort | Files |
|---|-------|-------|--------|-------|
| 1 | **Add health endpoints to worker & MCP server** — orchestrators cannot detect failure | DevOps | 2h | `apps/worker/src/main.ts`, `apps/mcp-server/src/main.ts`, `Dockerfile` |
| 2 | **Fix C-2 intermittent 500** — wrap dashboard queries in `$transaction` with timeout | Backend | 4h | `services/crm/dashboard.service.ts`, `crm/summary.ts` |
| 3 | **Add missing DB indexes** — 6 foreign keys causing table scans | Backend | 3h | `packages/db/prisma/schema.prisma` + migration |
| 4 | **Sync `.env.example`** with all required production env vars | DevOps | 2h | `.env.example` |
| 5 | **Fix Clerk `authorizedParties` empty-array fallback** — throw if `PUBLIC_BASE_URL` missing in prod | Security | 1h | `apps/api/src/plugins/auth.ts:90` |

## P1 — Fix This Sprint (High)

| # | Issue | Owner | Effort | Files |
|---|-------|-------|--------|-------|
| 6 | **Add timeout/retry to Microsoft/Salesforce `fetch` calls** | Integrations | 3h | `microsoft.ts`, `salesforce.ts` |
| 7 | **Reduce eager JS payload** — code-split Clerk, defer motion, vendor dedup | Frontend | 8h | `apps/web/vite.config.ts`, `main.tsx` |
| 8 | **Extract service layer from bloated routes** — `invoices.ts`, `territories.ts`, `agents.ts` | Backend | 2d | `apps/api/src/routes/` |
| 9 | **Add network-error retry to Dust/Odoo clients** (`ECONNRESET`, `ETIMEDOUT`) | Integrations | 4h | `packages/dust-client/src/`, `packages/odoo-mcp-client/src/` |
| 10 | **Fix `document-extract` crash recovery** — heartbeat or stale-job reaper | Backend | 4h | `apps/worker/src/processors/document-extract.ts` |
| 11 | **Enable Vitest coverage reporting** with thresholds | Frontend | 2h | `vitest.config.ts`, CI |
| 12 | **Add CSP nonce/hash to inline theme script** | Security | 3h | `apps/web/index.html`, nginx/CI |
| 13 | **Fix MCP server raw error disclosure** — sanitize `err.message` before sending | Security | 1h | `apps/mcp-server/src/server.ts:59-60` |

## P2 — Fix Next Sprint (Medium)

| # | Issue | Owner | Effort | Files |
|---|-------|-------|--------|-------|
| 14 | **Standardize soft-delete pattern** — pick one (`deletedAt` vs `isActive` vs `revokedAt`) | Backend | 1d | `schema.prisma`, migration |
| 15 | **Add `orgId` + `deletedAt` to junction tables** (`RolePermission`, `UserRole`) | Backend | 4h | `schema.prisma`, migration |
| 16 | **Add query timeout to all unbounded `findMany`** | Backend | 1d | `apps/api/src/routes/*.ts` |
| 17 | **Replace hand-rolled localStorage persistence with `zustand/middleware/persist`** | Frontend | 4h | `apps/web/src/stores/*.ts` |
| 18 | **Add `srcset` + WebP/AVIF to all `<img>` tags** | Frontend | 3h | Component audit |
| 19 | **Fix `.dockerignore`** — exclude dev/tooling directories | DevOps | 1h | `.dockerignore` |
| 20 | **Expand Prisma error code mapping** — add timeout/connection errors | Backend | 2h | `apps/api/src/plugins/error-handler.ts` |
| 21 | **Add TTL/eviction to MCP session Maps** | Security | 2h | `apps/mcp-server/src/server.ts:122-123` |
| 22 | **Enable `@typescript-eslint/no-unsafe-*` rules** (fix or suppress with WHY) | Standards | 2d | `eslint.config.js`, codebase |
| 23 | **Add UI primitive test coverage** (target 50%+) | Frontend | 3d | `apps/web/src/components/ui/` |

## P3 — Backlog (Low/Info)

| # | Issue | Owner | Effort |
|---|-------|-------|--------|
| 24 | Replace hand-rolled PWA with `vite-plugin-pwa` | Frontend | 4h |
| 25 | Fix `setTimeout` cleanup in `ApiKeysSection.tsx` | Frontend | 30min |
| 26 | Replace in-process rate-limit `Map` with Redis-backed limiter | Backend | 4h |
| 27 | Add `HEALTHCHECK` to Redis in prod compose | DevOps | 30min |
| 28 | Document `Permission` table global scope (if intentional) | Backend | 30min |
| 29 | Link `docs/solutions/` entries in code comments | Standards | 2h |
| 30 | Expand `check-secrets.sh` patterns (`password=`, `token=`, base64 keys) | Security | 1h |
| 31 | Fix web Dockerfile healthcheck to hit `/health` not `/` | DevOps | 30min |
| 32 | Audit 268 `as` type assertions for unsoundness | Frontend | 1d |
| 33 | Add `exhaustive-deps` justifications or fix deps | Frontend | 2h |

---

## Quick Wins (< 1 hour each)

1. Fix `authorizedParties` empty-array fallback (`auth.ts:90`)
2. Sync `.env.example` missing vars
3. Fix MCP error disclosure (`server.ts:59-60`)
4. Fix `setTimeout` cleanup (`ApiKeysSection.tsx:85`)
5. Fix web Dockerfile healthcheck path
6. Add Redis healthcheck to compose
7. Document `Permission` global scope
8. Expand `check-secrets.sh` patterns

---

## Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Critical findings | 3 | 0 |
| High findings | 18 | ≤5 |
| Eager JS payload | ~300 KB gzip | <200 KB gzip |
| Unbounded `findMany` | 108 | 0 |
| Missing DB indexes | 6+ | 0 |
| UI primitive test coverage | ~17% | ≥50% |
| Worker health probes | 0 | 2 |
| MCP health probes | 0 | 1 |
