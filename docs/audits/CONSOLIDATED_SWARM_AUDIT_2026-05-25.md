# Consolidated Swarm Audit Report — BidStack 360°

**Date:** 2026-05-25  
**Auditors:** 10 Specialist Swarm Agents (Developer, API, DB, Security, UX/UI, MCP, QA, DevOps, Frontend, Observability)  
**Status:** Completed

---

## Executive Summary

This consolidated report combines the findings of all 10 autonomous specialist swarm agents after executing a deep, cross-layer audit of the CRM. 

Overall, the application features modern primitives, stable core routes, and highly capable frameworks (Fastify, React Query, Zustand, BullMQ, Tailwind v4). However, significant gaps exist in **security authorization, database-level tenant isolation, performance/load testing, container privilege management, and rendering optimization**.

---

## Swarm Scorecard

| Lens / Domain | Score | Status | Primary Concern |
|---|---|---|---|
| **Backend Architecture** | 6.5 / 10 | Action Needed | Fat controllers, God services (`dashboard.service.ts`), inline raw SQL. |
| **API Design & Contracts** | 7.0 / 10 | Action Needed | Missing pagination unique tie-breakers, missing response validation schemas. |
| **Database Schema & Queries** | 6.0 / 10 | Action Needed | Denormalized relationships, missing GIN indexes, missing composite primary keys. |
| **Cyber Security** | 8.0 / 10 | Action Needed | Webhook subscription endpoints missing admin RBAC hooks (data exfiltration risk). |
| **UX/UI & Design System** | 7.5 / 10 | Action Needed | Hardcoded spacing/type rules in legacy CSS, orphaned theme variables. |
| **MCP Integration** | 10.0 / 10 | **PASSED** | Official SDK compliance, Redis-backed rate limiting, bearer scopes. |
| **QA & Testing** | 5.0 / 10 | Action Needed | Silent skips on DB-less runs, missing component unit tests. |
| **DevOps, Performance & Infra** | 5.0 / 10 | Action Needed | Containers run as `root`, soak/spike tests lack write paths, BullMQ DLQ data loss risk. |
| **Frontend Architecture** | 8.5 / 10 | Action Needed | Zustand currency store bypasses react-query, rendering memoization defeats. |
| **Observability & Logging** | 9.0 / 10 | Usable | Background workers/queue producers bypass central logger factory. |
| **COMPOSITE SCORE** | **7.25 / 10** | **BLOCKED** | High-severity security, tenant leakage, and container risks. |

---

## Critical & High-Severity Flagged Issues

### 1. Cyber Security: Webhook Exfiltration Vulnerability (HIGH)
- **File:** [webhook-subscriptions.ts](file:///d:/BIDCRM/apps/api/src/routes/webhook-subscriptions.ts#L51-L143)
- **Finding:** The `POST`, `PATCH`, and `DELETE` routes for Webhook Subscriptions lack the `server.requireRole('admin')` hook. Any authenticated user (including low-privilege members) can register a webhook, allowing them to subscribe and stream sensitive organizational events to an external system.
- **Fix:** Prepend `preHandler: [server.requireRole('admin')]` to the webhook routes.

### 2. DevOps: Root User Containers (CRITICAL)
- **File:** [Dockerfile](file:///d:/BIDCRM/Dockerfile#L72)
- **Finding:** The final Docker stages run as the `root` user. If an attacker compromises a containerized node process, they gain root access to the container namespace.
- **Fix:** Add `USER node` to the `api`, `worker`, and `mcp-server` targets before execution.

### 3. Database: Missing Composite Keys & DB-Level Tenant Leakage (HIGH)
- **File:** [schema.prisma](file:///d:/BIDCRM/packages/db/prisma/schema.prisma)
- **Finding:** Table relationships use simple UUIDs rather than composite keys like `@@id([orgId, id])`. Consequently, foreign key constraints do not prevent linking a tenant-scoped record (e.g. an `Opportunity`) to an entity belonging to another tenant (`Company`). Database-level multi-tenancy is entirely unenforced, relying strictly on application-layer filters.
- **Fix:** Enable PostgreSQL Row-Level Security (RLS) on all tenant-scoped tables and set request context (`app.current_org_id`) in every transaction block.

### 4. QA: Silent database skips in tests (HIGH)
- **File:** [contacts.integration.test.ts](file:///d:/BIDCRM/apps/api/src/routes/crm/contacts.integration.test.ts#L48)
- **Finding:** The test suite uses a `skipIfNoDb` utility that silently skips integration tests if the database connection fails. This violates the "Fail Loud" principle (Rule 12), masking environment or configuration failures during CI.
- **Fix:** Throw an explicit error when DB or Redis connection fails in test setups instead of skipping.

### 5. DevOps: BullMQ Data Loss Risk (HIGH)
- **File:** [queue-config.ts](file:///d:/BIDCRM/packages/shared/src/queue-config.ts)
- **Finding:** BullMQ is configured to automatically drop failures: `removeOnFail: { age: ..., count: 100 }`. If an external API outage causes >100 failures, older jobs are hard-deleted.
- **Fix:** Integrate a Dead Letter Queue (DLQ) or raise failure retention counts substantially.

### 6. DevOps: Credential Leak in Test Logs (MEDIUM)
- **File:** [queues.test.ts](file:///d:/BIDCRM/apps/worker/src/queues/queues.test.ts#L34)
- **Finding:** If Redis is unreachable, the test logs print the raw `redisUrl` string, which may contain plaintext passwords.
- **Fix:** Parse and redact credentials from URLs before printing connection failure logs.

---

## Domain-Specific Reports

For detailed files, line numbers, and modular scores, please review the individual auditor outputs:
1. **Backend Code Architecture:** [findings_backend_architecture.md](file:///d:/BIDCRM/docs/audits/findings_backend_architecture.md)
2. **API Design & Contracts:** [findings_api_design.md](file:///d:/BIDCRM/docs/audits/findings_api_design.md)
3. **Database Schema & Queries:** [findings_database.md](file:///d:/BIDCRM/docs/audits/findings_database.md)
4. **Cyber Security Auditor:** [findings_cyber_security.md](file:///d:/BIDCRM/docs/audits/findings_cyber_security.md)
5. **UX/UI & Design System:** [findings_ux_ui.md](file:///d:/BIDCRM/docs/audits/findings_ux_ui.md)
6. **MCP Integration:** [findings_mcp.md](file:///d:/BIDCRM/docs/audits/findings_mcp.md)
7. **QA & Testing:** [findings_qa_testing.md](file:///d:/BIDCRM/docs/audits/findings_qa_testing.md)
8. **DevOps, Performance & Infra:** [findings_devops_perf.md](file:///d:/BIDCRM/docs/audits/findings_devops_perf.md)
9. **Frontend Architecture:** [findings_frontend_architecture.md](file:///d:/BIDCRM/docs/audits/findings_frontend_architecture.md)
10. **Observability & Logging:** [findings_observability.md](file:///d:/BIDCRM/docs/audits/findings_observability.md)
