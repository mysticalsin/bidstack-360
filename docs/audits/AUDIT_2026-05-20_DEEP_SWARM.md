# Platform Deep Audit - Wave 1 Synthesis (2026-05-20)

This document synthesizes the findings from the first wave of specialized Kimi Code CLI agents analyzing the BidStack 360° platform.

## 1. Developer Architecture (DEV)
**Score:** 6.5/10
**Focus:** Code structure, fat controllers, standard conformance, missing service layers.

| ID | Severity | Location | Finding |
|---|---|---|---|
| DEV-1 | High | `apps/api/src/routes/notes.ts` | Fat controller (1,004 lines) with heavy inline business logic and extraction utilities. |
| DEV-2 | High | `apps/api/src/routes/invoices.ts` | Fat controller (824 lines) missing a service layer for domain logic. |
| DEV-3 | High | `apps/api/src/routes/odoo-integration.ts` | Fat controller (791 lines) mixing complex data mapping with routes. |
| DEV-4 | High | `apps/api/src/routes/sales-dashboard.ts` | Fat controller (539 lines) mixing SQL queries and bucket math. |
| DEV-5 | High | `apps/api/src/services/crm/dashboard.service.ts` | Catch-all monolith service (1,559 lines) with too many responsibilities. |

## 2. API Design & Contracts (API)
**Score:** 7/10
**Focus:** Fastify routes, Zod schemas, OpenAPI parity, pagination correctness.

| ID | Severity | Location | Finding |
|---|---|---|---|
| API-1 | High | `apps/api/src/routes/accounts.ts` | Missing `response` blocks on `/accounts/key`, `/accounts/top`, `/accounts/industries`, causing validation skipping. |
| API-2 | Medium | `apps/api/src/routes/contacts.ts`, `tasks.ts`, `companies.ts` | Missing unique tie-breaker (`id`) in `orderBy` for cursor pagination, risking duplicate records on `createdAt` collision. |
| API-3 | Medium | `apps/api/src/routes/dust-integration.ts`, `files.ts` | DELETE endpoints lack `response: { 204: z.null() }` schemas. |
| API-4 | Low | `handoff/openapi.yaml` | OpenAPI spec lacks parity with Fastify on `POST /opportunities/:id/stage`, `GET /contacts`, and `GET /tasks` payloads. |

## 3. Database Schema & Queries (DB)
**Score:** 6/10
**Focus:** Prisma models, indices, relationships, multi-tenancy boundaries, N+1 patterns.

| ID | Severity | Location | Finding |
|---|---|---|---|
| DB-1 | High | `packages/db/prisma/schema.prisma` | Missing composite keys (`@@id([orgId, id])`) for DB-level multi-tenancy enforcement. |
| DB-2 | Medium | `schema.prisma` | `accountId` is defined as a free-form string (`VarChar(255)`) instead of a true Foreign Key across 5 models (Note, FileAttachment, etc.). |
| DB-3 | Medium | `apps/api/src/routes/notes.ts` | N+1 query pattern (`Promise.all` inside transaction loop in `persistCompliance`). |

## Immediate Remediation Steps (In Progress)
- [x] Extract `notes.ts` business logic into `apps/api/src/services/crm/notes.service.ts`
- [x] Add missing response schemas to `accounts.ts`, `dust-integration.ts`, and `files.ts`.
- [x] Add `id` as secondary sort key for cursor pagination in `contacts.ts`, `tasks.ts`, and `companies.ts`.

## 4. QA and Testing (QA)
**Score:** 2/10
**Focus:** Vitest, Playwright, test coverage, brittle tests, mocking.

| ID | Severity | Location | Finding |
|---|---|---|---|
| QA-1 | Critical | `apps/web/e2e/fixtures.ts` | E2E suite silently skips all tests if API is unreachable (`test.skip(!healthy)`) instead of failing the test run. |
| QA-2 | Critical | `apps/web/src/pages/` | Complete lack of unit test coverage for complex React components and page controllers. |
| QA-3 | High | `apps/web/e2e/contacts.spec.ts` | E2E tests rely on tautologies, guaranteeing a pass regardless of whether data correctly loaded or not. |
| QA-4 | High | `apps/web/e2e/opportunities.spec.ts`, `smoke.spec.ts` | Brittle conditional testing that skips assertions if elements are unexpectedly missing. |
| QA-5 | High | `apps/api/src/routes/**/*.test.ts` | API integration tests use `skipIfNoDb` to silently abort and skip tests if the local database isn't reachable. |
| QA-6 | High | `apps/worker/src/queues/queues.test.ts` | Worker queue tests silently return if Redis is unreachable (`if (!redisUp) return;`). |
| QA-7 | Medium | E2E tests, `apps/api/src/plugins/auth.test.ts` | Complete lack of real Clerk authentication testing. |

## 5. DevOps, Performance, and Infra (DevOps)
**Score:** 6/10
**Focus:** BullMQ/Redis workers, Fastify limits, DB query patterns in workers, unhandled rejections.

| ID | Severity | Location | Finding |
|---|---|---|---|
| DevOps-1 | Critical | `apps/worker/src/queues/document-extract.ts` | Unhandled exception: `JobData.parse(job.data)` called synchronously inside `queue.on('failed')` crashes the worker. |
| DevOps-2 | High | `apps/api/src/routes/webhooks.ts` | Memory leak: `fallbackSeen` Map retains deduplication keys for 7 days without a max size limit. |
| DevOps-3 | High | `apps/worker/src/queues/webhook-processor.ts` | Sub-optimal DB Query: `prisma.syncEvent.findMany` polls for work without row-level locking (`FOR UPDATE SKIP LOCKED`). |
| DevOps-4 | High | `apps/api/src/server.ts` | Fastify Configuration: Default `bodyLimit` of 1MiB is not overridden, rejecting large webhooks. |
| DevOps-5 | Medium | `apps/worker/src/queues/document-extract.ts` | Missing Retry Logic: Network errors from `dust.runAgent` are swallowed instead of leveraging BullMQ retries. |
| DevOps-6 | Medium | `apps/worker/src/queues/dust-poll.ts` | N+1 query pattern: `prisma.syncEvent.create` in a loop over `targetOrgIds`. |

## 6. UX/UI and Design System (UX)
**Score:** 6.5/10
**Focus:** Apple HIG, grid alignment, type scale, WCAG compliance.

| ID | Severity | Location | Finding |
|---|---|---|---|
| UX-1 | High | `apps/web/src/index.css` | Legacy prototype typography uses fractional/arbitrary font sizes outside the 9-step scale. |
| UX-2 | High | `apps/web/src/index.css` | Legacy prototype spacing uses arbitrary pixel padding/margins violating the 8px grid. |
| UX-3 | High | `Input.tsx`, `Select.tsx` | Base inputs and selects lack `pointer-coarse:min-h-11` classes for 44px mobile touch targets. |
| UX-4 | Medium | `Input.tsx`, `Select.tsx` | Missing interactive hover states for form controls. |
| UX-5 | Medium | `Tabs.tsx` | `TabsTrigger` missing disabled and active/pressed states. |
| UX-6 | Low | `Button.tsx` | `secondary` and `destructive` variants lack distinct active/pressed CSS state. |
| UX-7 | Low | `Input.tsx`, `Select.tsx`, `Button.tsx` | Sub-grid spacing: components use `py-1.5` or `gap-1.5` (6px) which violates 4px/8px grid. |

## 7. MCP Integration (MCP)
**Score:** 3/10
**Focus:** `@modelcontextprotocol/sdk` usage, tool errors, SSE transport.

| ID | Severity | Location | Finding |
|---|---|---|---|
| MCP-1 | Critical | `apps/mcp-server/src/rpc.ts`, `server.ts` | Missing `@modelcontextprotocol/sdk`. Implements a custom JSON-RPC dispatcher instead of official SDK. |
| MCP-2 | High | `apps/mcp-server/src/rpc.ts`, `opportunity-update.ts` | Non-compliant tool error handling (throws exceptions returning `-32603` instead of `isError: true` in content block). |
| MCP-3 | Medium | `apps/mcp-server/src/server.ts` | False SSE Endpoint Advertising: advertises `http+sse` but mounts no SSE route, breaking standard clients. |
| MCP-4 | Medium | `apps/mcp-server/src/server.ts` | Non-standard Request/Response Loop: relies strictly on HTTP POST rather than `SSEServerTransport`. |
| MCP-5 | Low | `apps/mcp-server/src/rpc.ts` | Non-standard Response Payload: uses `structuredContent` key instead of just `content`. |

## 8. Frontend State Management & Architecture (Frontend Arch)
**Score:** 8/10
**Focus:** Zustand, React Query, re-renders, component coupling.

| ID | Severity | Location | Finding |
|---|---|---|---|
| Arch-1 | High | `apps/web/src/pages/ContactsPage.tsx` | Excessive re-renders due to non-memoized inline functions for table rows coupled with page-level state. |
| Arch-2 | Medium | `apps/web/src/stores/currency.ts` | Bypasses React Query to fetch exchange rates via raw `fetch` and manual state management. |

## 9. Error Handling and Logging (Observability)
**Score:** 9.5/10
**Focus:** Pino usage, request-scoped loggers, Fastify error mapping, no `console.log`.

| ID | Severity | Location | Finding |
|---|---|---|---|
| Obs-1 | High | `apps/api/src/lib/dust-push.ts` | Creates a static Pino root logger instead of accepting a request-scoped child logger. |
| Obs-2 | Low | `apps/worker/src/queues/document-extract.ts` | Passes root worker logger instead of job-scoped child logger (`log.child({ jobId: job.id })`). |

## 10. Cyber Security (Cyber)
**Score:** 8/10
**Focus:** Authentication, RBAC, data leaks, security headers, webhooks.

| ID | Severity | Location | Finding |
|---|---|---|---|
| Cyber-1 | High | `apps/api/src/routes/webhook-subscriptions.ts` | Improper Authorization: Mutations lack `server.requireRole('admin')` RBAC protection. |
| Cyber-2 | Low | `apps/api/src/server.ts` | Unnecessarily generous Allowed Origins in CORS. |

*All 10 Agents have completed their audits. The swarm audit is now complete.*
