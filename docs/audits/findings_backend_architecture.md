# Backend Architecture Audit Findings

## Overview
This audit examines the `apps/api/src/routes` and `apps/api/src/services` directories against the project's architectural standards. Focus areas included identifying fat controllers (> 400 lines), missing service boundaries, improper imports, and general code smells.

## 1. Fat Controllers & Missing Service Layers
The codebase frequently implements direct database access, data transformations, and heavy business logic inside Fastify route handlers rather than delegating to a dedicated service layer.

| File Path | Lines | Finding |
|-----------|-------|---------|
| `apps/api/src/routes/notes.ts` | 1004 | **High Severity**: Massive controller handling meeting extraction (`extractMeetingNotes`), regex parsing, and complex Prisma transactions inline. |
| `apps/api/src/routes/invoices.ts` | 824 | **High Severity**: State transitions, PDF formatting logic, and invoice number generation (`mintNextInvoiceNumber`) are inline instead of in an `invoice.service.ts`. |
| `apps/api/src/routes/odoo-integration.ts` | 791 | **High Severity**: Odoo API response formatting, domain building, and local fallback data merging (`searchLocalCompanies`) are mixed into route logic. |
| `apps/api/src/routes/territories.ts` | 736 | **Medium Severity**: Includes a massive `A2_TO_A3` hardcoded dictionary and complex inline analytics aggregations for `GET /api/territories/analytics`. |
| `apps/api/src/routes/opportunities.ts` | 555 | **Medium Severity**: DB transaction retries (`mintNextCode`), territory auto-assignments, and dust-agent push logic are tangled in route handlers. |
| `apps/api/src/routes/sales-dashboard.ts` | 539 | **High Severity**: Date window bucketing logic (`resolveWindow`) and complex raw SQL aggregations (e.g., `dominantCurrency`) are executed directly in the controller. |
| `apps/api/src/routes/sales-orders.ts` | 448 | **Medium Severity**: Missing service layer. Route includes inline Prisma DB transactions, arithmetic transformations (`parseQuantityThousandths`), and helper `mintNextNumber`. |

## 2. Fat Services (God Objects)
Some service layers exist but have accumulated too many responsibilities, violating Single Responsibility Principle (SRP).

| File Path | Lines | Finding |
|-----------|-------|---------|
| `apps/api/src/services/crm/dashboard.service.ts` | 1559 | **Critical Severity**: Acts as a "God Object." Accumulates insight generation, cockpit building, activity formatting, UI widget serialization, and massive DB data fetching into a single file. |
| `apps/api/src/services/reports/sales-intelligence.service.ts` | 832 | **Medium Severity**: Merges raw SQL fetches with multiple complex aggregation algorithms (Win-Loss, Pipeline by stage, Top Countries) into one location. |

## 3. Imports
- **Pass**: The rule `never ../../..` is strictly followed. A comprehensive search confirmed zero deep relative imports crossing the `../../../` threshold.
- **Pass**: Workspace aliases (`@bidstack/db`, `@bidstack/shared`) are consistently used for cross-package imports. 
- **Pass**: No default exports (`export default`) were found in library packages (excluding config files like `vitest.config.ts`, which is compliant).

## 4. Code Smells
- **Hardcoded Domain Data**: `dashboard.service.ts` contains hardcoded `COMPANY_DOMAINS` and `COMPANY_WEBSITES`. `territories.ts` contains a hardcoded 120-line `A2_TO_A3` country dictionary. These should be extracted to configuration files, constants files, or the database.
- **Raw SQL Mixed with Domain Logic**: Files like `sales-dashboard.ts` and `sales-intelligence.service.ts` execute `prisma.$queryRaw` inline alongside mapping and formatting loops. Data access should be isolated into a repository/data-access layer.
- **Leaking DB Types**: Route handlers frequently cast types like `PrismaStage` manually and manage transactional retry loops (e.g. `mintNextCode`) directly inside HTTP handlers.
