# Cyber Security Audit Findings

## Executive Summary
Overall, the application maintains a robust security posture. It enforces strict multi-tenancy by scoping Prisma queries with `orgId` natively within the API routes. Authentication leverages `@clerk/fastify` properly, mitigating CSRF by relying entirely on `Authorization: Bearer` headers rather than cookies for API calls. Rate limiting is active globally (600 max per minute per user/IP), with stricter limits applied to sensitive endpoints (e.g., 10-30 max per minute). Fastify's helmet and CORS policies are properly customized to avoid typical SSRF and XSS vectors.

However, a High severity authorization flaw was identified in the Webhook Subscriptions functionality.

## Findings

| ID | Severity | Location | Finding | Fix Effort |
|---|---|---|---|---|
| 1 | High | `apps/api/src/routes/webhook-subscriptions.ts` (Lines 51-92, 94-124, 126-143) | **Improper Authorization (Data Exfiltration Risk):** The `POST`, `PATCH`, and `DELETE` routes for Webhook Subscriptions lack the `server.requireRole('admin')` RBAC hook. Because any authenticated user can create a webhook, a standard member can maliciously or accidentally stream sensitive organization events to an external webhook endpoint. | Low |
| 2 | Low | `apps/api/src/server.ts` (Lines 168-182) | **Unnecessarily Generous Allowed Origins:** The CORS configuration pushes local development origins, but allows `process.env.PUBLIC_BASE_URL` without strict multi-origin array checks. Although production correctly strips localhost to prevent SSRF overlap, it could be hardened to strictly parse multiple origins if needed. | Low |

## Detailed Observations

### Multi-tenant Boundaries (orgId)
Comprehensive checks of `findMany`, `update`, `delete`, and `upsert` queries across `apps/api/src/routes` confirm that the application consistently applies `orgId: req.auth.orgId` filtering in all cross-tenant endpoints. Queries matching records by `req.params.id` successfully validate the entity against the tenant's `orgId`.

### Authentication and Authorization
- **Authentication**: JWT verification via Clerk is securely implemented in `authPlugin.ts`, validating signatures, audiences, and active users properly.
- **Authorization hooks**: Route-level Role-Based Access Control (`rbacPlugin.ts`) is efficiently applied to admin-level routes such as API Key creation and Role administration (`roles.ts`). The webhook subscriptions route is the only critical omission.

### Rate Limiting
Fastify's `@fastify/rate-limit` is securely configured. Authenticated users are bucketed by `userId`, preventing single tenants from exhausting connection limits for the whole system, while unauthenticated requests gracefully degrade to IP tracking. 

### PII Protection
Fastify logging is properly restricted in `server.ts`. It proactively redacts tokens, cookies, and secrets using Pino's redact options. Standard endpoints limit PII disclosure strictly to the authenticated organization boundary.

**Final Cyber Security Score: 8/10**
