# Database Schema & Queries Audit Findings

## 1. Schema Normalization
- **Denormalization / Free-form Strings:** 
  Models like `Note`, `FileAttachment`, `AccountSolution`, `AccountProduct`, and `DocumentExtraction` map `accountId` as a free-form string (`VarChar(255)`) rather than a strict foreign key (e.g., `companyId`). This mimics relationships loosely and introduces risks of orphaned data or inconsistent tracking if names change.
- **Duplicated Fields:** 
  The `Opportunity.customer` and `Contact.customer` fields duplicate the company name while also often having an optional `companyId` foreign key.

## 2. Indexes
- **Missing GIN Indexes for `ILIKE` Queries:** 
  The search route (`search.ts`) utilizes Prisma `contains: q, mode: 'insensitive'` across multiple models, which translates to `ILIKE '%...%'`. Without `pg_trgm` GIN indexes, these execute sequential scans.
  - Affected fields: `Contact` (`name`, `email`, `role`), `CompanyEnrichment` (`normalizedName`, `domain`, `tradeName`), `Task` (`title`), `Note` (`title`, `bodyMd`), and `SalesOrder` (`number`, `customerName`).

## 3. Multi-tenancy Constraints
- **Missing Composite Primary Keys:** 
  Models use isolated `id String @id @db.Uuid` without including `orgId` as part of a composite primary key (`@@id([orgId, id])`). 
- **DB-Level Tenant Leak Risk:** 
  Because primary keys are not composite, foreign keys between tenant-scoped entities (e.g., linking an `Opportunity` to a `Company`) do not enforce the tenant boundary (`orgId`) at the database level. Multi-tenancy is completely reliant on application-level logic (e.g., passing `req.auth.orgId` in `where` clauses).

## 4. N+1 Queries
- **Recursive DB Queries (`companies.ts`):** 
  - Lines 266-281: The `buildTree` function performs a `findMany` query recursively for every child node to build the hierarchy tree, resulting in an unbounded N+1 loop for deep/wide hierarchies.
  - Lines 248-254: Ancestor tree generation uses a `while (ancestorId)` loop firing `findFirst` database queries sequentially.
- **Unbatched Upsert Loop (`companies.ts`):** 
  - Lines 200-218: Iterates over `patch.customFieldValues` using a `for...of` loop calling `prisma.customFieldValue.upsert` sequentially.
- **N+1 Update in Transaction (`notes.ts`):** 
  - Lines 675-685: Uses `Promise.all` wrapping an iteration of `tx.complianceCheck.update(...)` operations within a Prisma transaction, firing an N+1 query loop rather than executing a batch `updateMany`.

## 5. Raw SQL Usage
- **`search.ts`:** 
  Uses `prisma.$queryRaw` to leverage the GIN trigram index on the `opportunities` table via an `ILIKE` search.
- **`sales-dashboard.ts`:** 
  Uses `prisma.$queryRaw` for grouping by truncated dates (`date_trunc('month', order_date)`), calculating aggregations, and joining `sales_order_lines` to `products`. 
- **Security:** 
  All raw SQL instances correctly use Prisma's tagged template literal variables (e.g., `${req.auth.orgId}::uuid`), keeping them secure against SQL injection.
