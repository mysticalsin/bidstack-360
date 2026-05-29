# Audit Report — Companies & Contacts Domain

**Auditor:** Agent-18  
**Scope:** `apps/api/src/routes/companies.ts`, `apps/api/src/routes/contacts.ts`, `apps/api/src/routes/crm/companies.ts`, `apps/api/src/services/crm/company.service.ts`, `apps/api/src/services/crm/enrichment.service.ts`, `apps/api/src/serializers/company.ts`, `packages/db/prisma/schema.prisma` (Company & Contact models), `packages/shared/src/schemas/company.ts`, `packages/shared/src/schemas/contact.ts`  
**Rubric:** Functional 25 + Code 25  
**Score:** **58 / 100**

---

## 1. Score Breakdown

| Dimension      | Score   | Rationale                                                                                                                                                                                                                                                                                                      |
| -------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Functional** | 14 / 25 | Core CRUD, hierarchy traversal, and enrichment caching work. Critical gaps in data integrity (soft-delete + unique constraints, orphan hierarchies), missing contact→company linking, no duplicate detection, no automatic tier/territory logic, and activity timeline is purely manual.                       |
| **Code**       | 15 / 25 | Strong multi-tenancy enforcement, audit logging, and circular-reference guard. Hurt by N+1 hierarchy queries, custom-field upserts outside transactions, in-memory search loading up to 700 rows, hardcoded business values, missing tests for `companies.ts`, and no depth limits on recursive tree building. |

---

## 2. Strengths

- **Multi-tenancy enforced at every boundary.** All Prisma queries include `orgId` and `deletedAt: null` filters (e.g., `apps/api/src/routes/companies.ts:28-29`, `apps/api/src/routes/contacts.ts:51-52`).
- **Two-step find-then-update prevents cross-tenant UUID-guessing attacks.** Contacts PATCH first verifies ownership via `findFirst` before calling `update` (`apps/api/src/routes/contacts.ts:155-163`).
- **Circular-reference detection on company parent updates.** PATCH `/companies/:id` walks the ancestor chain to prevent loops (`apps/api/src/routes/companies.ts:166-176`).
- **Audit logging for contact mutations.** Every contact create/update/delete writes an `auditLog` row inside a transaction (`apps/api/src/routes/contacts.ts:120-129`, `176-185`, `236-245`).
- **Idempotent activity creation.** `logActivity` in `apps/api/src/services/activity.service.ts:44-54` deduplicates via `idempotencyKey`, preventing duplicate timeline entries on retries.
- **Enrichment fail-open with caching.** `upsertVerifiedCompanyEnrichment` catches provider errors, falls back to favicon, and caches results with a 30-day TTL (`apps/api/src/services/crm/enrichment.service.ts:52-63`, `106-148`).

---

## 3. P0 Gaps — Broken Hierarchy, Enrichment Failures, Data Loss Risks

### 3.1 Soft-deleted companies violate unique constraints

The `Company` model defines `@@unique([orgId, name])` and `@@unique([orgId, domain])` (`packages/db/prisma/schema.prisma:285-286`). Because these are database unique constraints (not filtered by `deletedAt`), soft-deleting a company named "Acme" permanently blocks creation of another "Acme" in the same org. This is a data-loss risk for users who delete and later re-import.

> **Evidence:** `packages/db/prisma/schema.prisma:285-286`
>
> ```prisma
> @@unique([orgId, name])
> @@unique([orgId, domain], map: "companies_org_domain_key")
> ```

### 3.2 Deleting a company orphans its children in the hierarchy

When a company is soft-deleted, `parentId` on children is never cleared. The hierarchy endpoint filters by `deletedAt: null`, so children of a deleted parent silently vanish from the tree even though they are active rows. If the parent is later restored, the linkage reappears unexpectedly.

> **Evidence:** `apps/api/src/routes/companies.ts:304-307`
>
> ```ts
> await prisma.company.updateMany({
>   where: { id: existing.id, orgId: req.auth.orgId },
>   data: { deletedAt: new Date() },
> });
> ```
>
> No re-parenting or `parentId` nullification is performed.

### 3.3 Contact `customer` string is decoupled from `companyId` FK

Contacts have a free-text `customer` field and a nullable `companyId` FK. The PATCH route updates `customer` but never syncs `companyId`, leaving the contact unlinked to the actual Company row. This breaks any feature relying on the FK (e.g., company-scoped contact lists, cascade deletes).

> **Evidence:** `apps/api/src/routes/contacts.ts:165`
>
> ```ts
> ...(req.body.customer !== undefined ? { customer: req.body.customer } : {}),
> ```
>
> `companyId` is never referenced in the update logic.

### 3.4 Custom-field upserts happen outside the main transaction

In both `companies.ts` and `contacts.ts`, the PATCH transaction commits before custom-field values are upserted. If the custom-field write fails, the entity update is already persisted and cannot roll back.

> **Evidence:** `apps/api/src/routes/companies.ts:178-220`
>
> ```ts
> const updateResult = await prisma.company.updateMany({...}); // transaction-like but not wrapping custom fields
> // ...
> if (patch.customFieldValues !== undefined) {
>   for (const { definitionId, value } of patch.customFieldValues) {
>     await prisma.customFieldValue.upsert({...}); // outside tx
>   }
> }
> ```

### 3.5 Hierarchy endpoint has unbounded N+1 recursion with no depth limit

`buildTree` in `GET /companies/:id/hierarchy` recursively fetches children in a loop. A deep hierarchy or a circular reference (if created via race condition or DB manipulation) causes unbounded queries and potential stack overflow. There is no `MAX_DEPTH` guard.

> **Evidence:** `apps/api/src/routes/companies.ts:266-282`
>
> ```ts
> async function buildTree(id: string, name: string, parentId: string | null): Promise<CompanyHierarchyNode> {
>   const kids = await prisma.company.findMany({...});
>   const children: CompanyHierarchyNode[] = await Promise.all(
>     kids.map((k): Promise<CompanyHierarchyNode> => buildTree(k.id, k.name, id)),
>   );
>   return { id, name, parentId, children };
> }
> ```

### 3.6 No unique index on Contact.email allows duplicate contacts

`Contact.email` is nullable `Citext` with no `@@unique` constraint (`packages/db/prisma/schema.prisma:405-406`, `421-425`). The same org can have unlimited contacts with identical emails, making deduplication impossible at the DB layer.

> **Evidence:** `packages/db/prisma/schema.prisma:398-426` — no unique index on `[orgId, email]`.

---

## 4. P1 Gaps — Performance, Missing Features

### 4.1 Company lookup "fuzzy" matching is just substring search

`GET /crm/companies/lookup` claims to support `fuzzy_name` but implements a simple `.includes(name)` substring filter in JavaScript after loading all enrichments + opportunities into memory (`getCompaniesOnly` fetches up to 700 rows). It does not use the `pg_trgm` extension already declared in the Prisma schema (`packages/db/prisma/schema.prisma:14`).

> **Evidence:** `apps/api/src/routes/crm/companies.ts:134-146`
>
> ```ts
> const alternatives = companies
>   .filter((item) =>
>     [item.name, item.legalName ?? '', item.domain ?? ''].join(' ').toLowerCase().includes(name),
>   )
>   .slice(0, 5);
> ```

### 4.2 Main company search uses naive LIKE instead of trigram

`GET /companies` uses Prisma `contains` (SQL `LIKE '%term%'`) which cannot use btree indexes and performs full table scans on large orgs. The `pg_trgm` extension is available but unused.

> **Evidence:** `apps/api/src/routes/companies.ts:34-36`
>
> ```ts
> OR: [
>   { name: { contains: s, mode: 'insensitive' } },
>   { domain: { contains: s, mode: 'insensitive' } },
>   { industry: { contains: s, mode: 'insensitive' } },
> ],
> ```

### 4.3 No duplicate detection or merge for contacts

There is no endpoint, service, or DB constraint to detect contacts with the same email, phone, or name+company combination. The `mergeSalesCompanyCandidates` function exists for companies (`apps/api/src/services/crm/company.service.ts:92-114`) but nothing equivalent exists for contacts.

### 4.4 No automatic territory assignment for companies

Territories are auto-assigned to Opportunities based on `country` (`apps/api/src/routes/opportunities.ts:145-156`), but Companies have no equivalent logic despite having `countryCode` in the schema.

### 4.5 Account tier logic is completely manual

`AccountTier` enum and `tier` column exist, but there is no automated logic to promote/demote companies based on revenue, deal velocity, or employee count. `keyAccountSince` is never auto-populated.

### 4.6 Activity timeline does not auto-log company/contact changes

The activity service supports `company` and `contact` `entityType` values, but no hooks or triggers automatically create timeline events when a company or contact is created, updated, or deleted. Users must manually POST activities.

### 4.7 `ContactDetail` schema is not implemented by the route

`packages/shared/src/schemas/contact.ts:27-57` defines `relatedOpportunities`, `relatedTasks`, and `relatedNotes` for `ContactDetail`, but `GET /contacts/:id` only returns `customFieldValues` and never resolves these relations.

> **Evidence:** `apps/api/src/routes/contacts.ts:84-95`
>
> ```ts
> const customFieldValues = await prisma.customFieldValue.findMany({...});
> return { ...serializeContact(contact), customFieldValues };
> ```

---

## 5. P2 Gaps — Nice-to-Have Improvements

### 5.1 Hardcoded Mantu business constants in enrichment service

`upsertVerifiedCompanyEnrichment` hardcodes Mantu employee count (12,000) and revenue (€1T micros) inline. This should be configuration-driven or stored in a seed table.

> **Evidence:** `apps/api/src/services/crm/enrichment.service.ts:73`, `123-124`
>
> ```ts
> const isMantu = domain === 'mantu.com' || normalizedName === 'mantu';
> employeeCount: isMantu ? 12_000 : (openProfile?.employeeCount ?? null),
> annualRevenueMicros: isMantu ? 1_000_000_000_000_000n : null,
> ```

### 5.2 Custom field values lack schema validation on write

The `customFieldValue.upsert` calls accept `value: unknown` with no runtime check against the `CustomFieldDefinition`’s `fieldType`, `options`, or `required` flag. Invalid data can be persisted silently.

> **Evidence:** `apps/api/src/routes/companies.ts:201-218`
>
> ```ts
> await prisma.customFieldValue.upsert({
>   update: { value: value as Prisma.InputJsonValue },
>   create: { ..., value: value as Prisma.InputJsonValue },
> });
> ```

### 5.3 Missing unit/integration tests for `apps/api/src/routes/companies.ts`

There is a test file for `crm/companies.test.ts` (dashboard/enrichment routes) but no test file for the core `/companies` CRUD and hierarchy routes. This leaves the circular-reference guard, custom-field PATCH, and hierarchy tree untested.

### 5.4 `serializeCompanyDetail` fetches custom fields via separate query

The serializer performs an extra `findMany` on `customFieldValue` rather than using a Prisma `include` in the parent query, adding an unnecessary round-trip.

> **Evidence:** `apps/api/src/serializers/company.ts:90-93`
>
> ```ts
> const customFieldValues = await prisma.customFieldValue.findMany({
>   where: { orgId: c.orgId, entityType: 'company', entityId: c.id },
>   select: { id: true, definitionId: true, value: true },
> });
> ```

### 5.5 No bulk import or merge endpoint for companies

Unlike opportunities or leads, companies cannot be bulk-created or merged, forcing clients to make serial API calls.

---

## 6. Evidence — Specific Code Snippets

### 6.1 Hierarchy circular check (good)

`apps/api/src/routes/companies.ts:166-176`

```ts
let currentId: string | null = patch.parentId;
while (currentId) {
  if (currentId === req.params.id) {
    throw server.httpErrors.badRequest('Circular reference detected');
  }
  const row: { parentId: string | null } | null = await prisma.company.findFirst({...});
  currentId = row?.parentId ?? null;
}
```

### 6.2 Contact multi-tenancy guard (good)

`apps/api/src/routes/contacts.ts:155-159`

```ts
const existing = await prisma.contact.findFirst({
  where: { id: req.params.id, orgId: req.auth.orgId, deletedAt: null },
  select: { id: true },
});
if (!existing) throw server.httpErrors.notFound('Contact not found');
```

### 6.3 Enrichment cache TTL (good)

`apps/api/src/services/crm/enrichment.service.ts:128`

```ts
cacheExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
```

### 6.4 Company delete orphans children (bad)

`apps/api/src/routes/companies.ts:304-307`

```ts
await prisma.company.updateMany({
  where: { id: existing.id, orgId: req.auth.orgId },
  data: { deletedAt: new Date() },
});
```

### 6.5 Contact email has no unique constraint (bad)

`packages/db/prisma/schema.prisma:405-406`

```prisma
email     String?    @db.Citext
```

No `@@unique([orgId, email])` or even `@@index([orgId, email])`.

### 6.6 Fuzzy matching is substring (bad)

`apps/api/src/routes/crm/companies.ts:137-139`

```ts
[item.name, item.legalName ?? '', item.domain ?? ''].join(' ').toLowerCase().includes(name);
```

---

## 7. Summary

The Companies & Contacts domain delivers functional CRUD, a working enrichment cache, and solid security boundaries, but it falls short on **data integrity** (soft-delete unique collisions, orphan hierarchies, decoupled contact→company linkage) and **automation** (no auto-tier, no auto-territory, no auto-activity logging, no duplicate detection). The hierarchy endpoint is a performance liability due to unbounded N+1 recursion, and the so-called "fuzzy" company lookup is a memory-bound substring scan. Closing the P0 gaps—especially the unique-constraint/soft-delete interaction and transaction-wrapped custom fields—should be the first priority before adding new features.
