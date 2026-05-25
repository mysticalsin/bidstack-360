# Audit Report: Account/Contact Hierarchies & Relationships
**Agent:** A3  
**Domain:** Core CRM Data Model — Account/Contact Hierarchies & Relationships  
**Date:** 2026-05-23  
**Scope:** `packages/db/prisma/schema.prisma`, `apps/api/src/routes/companies.ts`, `apps/api/src/routes/contacts.ts`, `apps/api/src/routes/opportunity-contacts.ts`, `apps/api/src/routes/crm/companies.ts`, `apps/web/src/pages/CompanyDetailPage.tsx`, `apps/web/src/pages/ContactDetailPage.tsx`, `apps/web/src/components/opportunity/OpportunityTabs.tsx`

---

## 1. Current State

### 1.1 Company (Account) Model
**File:** `packages/db/prisma/schema.prisma` (lines 165–213)

BidStack’s `Company` model is a **completely flat, single-level entity** with no parent/child capability:

```prisma
model Company {
  id                String      @id @default(uuid()) @db.Uuid
  orgId             String      @map("org_id") @db.Uuid
  name              String
  legalName         String?     @map("legal_name")
  domain            String?
  industry          String?
  employeeCount     Int?        @map("employee_count")
  countryCode       String?     @map("country_code")
  address           Json?
  billingEmail      String?     @map("billing_email")
  taxId             String?     @map("tax_id")
  logoUrl           String?     @map("logo_url")
  website           String?
  tier              AccountTier @default(standard)
  keyAccountOwnerId String?     @map("key_account_owner_id")
  keyAccountNotes   String?     @map("key_account_notes")
  topAccountRank    Int?        @map("top_account_rank")
  // ... relations only to children (contacts, opps, cases, notes, etc.)
  // NO parentId, NO hierarchy depth field, NO ultimateParentId
}
```

The API (`apps/api/src/routes/companies.ts`) exposes standard list/get/create/patch/delete. The GET `/companies/:id` include block fetches `contacts`, `opportunities`, `serviceCases`, and `notes` — but **no parent or child companies**.

### 1.2 Contact Model
**File:** `packages/db/prisma/schema.prisma` (lines 320–346)

Contacts are **single-homed** to one company via a nullable `companyId` FK. There is no self-referencing `reportsToId`, no social URL fields, and no junction table for multi-account affiliation:

```prisma
model Contact {
  id        String     @id @default(uuid()) @db.Uuid
  orgId     String     @map("org_id") @db.Uuid
  customer  String     // legacy free-text tag
  companyId String?    @map("company_id") @db.Uuid  // ← single company only
  name      String
  role      String?    // job title, NOT a CRM role
  email     String?    @db.Citext
  phone     String?
  influence Int?
  sentiment Sentiment?
  // NO reportsToId, NO linkedInUrl, NO twitterUrl, NO multi-account junction
}
```

The `contacts` route (`apps/api/src/routes/contacts.ts`) is basic CRUD. PATCH allows reassigning `customer` (free-text) but does not touch `companyId`.

### 1.3 Opportunity-Contact Roles (What BidStack *Does* Have)
**File:** `packages/db/prisma/schema.prisma` (lines 2107–2131)

BidStack implements **opportunity-scoped contact roles** via `OpportunityContact`:

```prisma
model OpportunityContact {
  id            String     @id @default(uuid()) @db.Uuid
  opportunityId String     @map("opportunity_id") @db.Uuid
  contactId     String     @map("contact_id") @db.Uuid
  role          String     @default("stakeholder")
  isPrimary     Boolean    @default(false)
  influence     Int?
  sentiment     Sentiment?
  notes         String?
}
```

The UI (`apps/web/src/components/opportunity/OpportunityTabs.tsx`, lines 284–402) renders a “Linked contacts” panel with a role dropdown (`stakeholder | decision_maker | influencer | champion | blocker`) and a primary-star toggle. The API (`apps/api/src/routes/opportunity-contacts.ts`) supports full CRUD and enforces single-primary semantics.

### 1.4 Company Detail UI
**File:** `apps/web/src/pages/CompanyDetailPage.tsx`

The page renders four tabs: **Contacts**, **Opportunities**, **Cases**, **Notes**. The Contacts tab is a flat table (`Name | Role | Email | Phone`). There is **no “View Hierarchy” link**, no parent/child badges, and no org-chart visualization.

### 1.5 Contact Detail UI
**File:** `apps/web/src/pages/ContactDetailPage.tsx`

Shows a single company link via the legacy `customer` free-text field (routing to `/accounts/${c.customer}`, which is inconsistent with the UUID-based `/companies/:id` route). Related opportunities are fetched by filtering **all** opportunities on the `customer` string match client-side — not via `companyId` or a proper junction. There is **no “Reports To” section**, no multiple-account cards, and no social profile links.

### 1.6 Enrichment & Matching
**File:** `apps/api/src/services/crm/enrichment.service.ts`, `apps/api/src/routes/crm/companies.ts`

- Enrichment pulls from Wikidata/Wikimedia + favicon fetch. It stores `domain`, `legalName`, `employeeCount`, `industryCodes`, `registryIds` (empty JSON default).
- No LinkedIn, Twitter, or other social profile data is fetched or stored.
- The `/crm/companies/lookup` endpoint does exact-domain, exact-name, registry-id, and fuzzy-name matching — but this is **lookup/ search**, not duplicate management.
- No fuzzy duplicate-detection job, no merge API, no merge UI for companies or contacts.

---

## 2. Gap List

| # | Capability | Salesforce Equivalent | Severity | Evidence |
|---|------------|----------------------|----------|----------|
| 1 | **Parent-Child Account Hierarchies** | `Account.ParentId` self-relation, multi-level tree | **Critical** | `Company` model has no `parentId`; API does not include children; UI has no hierarchy tab |
| 2 | **Global Ultimate Parent Tracking** | `Account.UltimateParent__c` (D-U-N-S rollup) | **High** | No `ultimateParentId` or D-U-N-S number fields in schema or enrichment |
| 3 | **"Reports To" Contact Hierarchy** | `Contact.ReportsToId` self-relation | **High** | `Contact` model has no `reportsToId`; UI has no reporting structure display |
| 4 | **Contact-to-Multiple-Accounts** | `AccountContactRelation` junction (buyer, partner, previous employer) | **High** | Contact has single `companyId` FK only; no `AccountContactRelation` equivalent |
| 5 | **Contact Roles on Accounts** | `AccountContactRole` (Decision Maker, Influencer, etc. at account level) | **Medium-High** | Only `OpportunityContact` exists; no company-scoped role junction |
| 6 | **Social Data Enrichment** | LinkedIn, Twitter matching & URL storage | **Medium** | Enrichment service stores only Wikidata/Wikimedia + favicon; zero social fields |
| 7 | **Duplicate Management (Fuzzy + Merge)** | Duplicate Rules, Merge wizard | **Medium** | Lookup endpoint does fuzzy name search but no automated duplicate detection, no merge API |
| 8 | **Relationship Maps / Visual Org Chart** | Lightning Relationship Map, org-chart with influence lines | **Medium** | No org-chart component; no graph/hierarchy visualization anywhere in UI |

---

## 3. Effort Estimate (T-Shirt Size)

| # | Gap | Size | Rationale |
|---|-----|------|-----------|
| 1 | Parent-Child Account Hierarchies | **L** | Schema migration + self-relation + recursive query API + tree UI component + cycle prevention |
| 2 | Global Ultimate Parent Tracking | **M** | New fields (`dunsNumber`, `ultimateParentId`) + enrichment provider integration + rollup worker |
| 3 | "Reports To" Contact Hierarchy | **M** | Schema migration + self-relation + API updates + org-chart UI component |
| 4 | Contact-to-Multiple-Accounts | **L** | New junction table (`ContactCompanyRelation`) + migrate `companyId` → junction + update all queries + UI |
| 5 | Contact Roles on Accounts | **S-M** | New `CompanyContact` junction table (clone of `OpportunityContact`) + API + UI tab on CompanyDetailPage |
| 6 | Social Data Enrichment | **M** | New provider integration (Apollo.io, Clearbit, or LinkedIn API) + schema fields + UI display |
| 7 | Duplicate Management | **L** | Fuzzy matching engine (pg_trgm / Levenshtein) + duplicate detection job + merge API + merge UI wizard |
| 8 | Relationship Maps / Visual Org Chart | **L** | Custom D3/React-Flow canvas component + influence-line data model + interactive editing |

---

## 4. Dependency Map

```
Gap 4 (Contact-to-Multiple-Accounts)
  └─ MUST complete before Gap 5 (Contact Roles on Accounts)
  └─ MUST complete before Gap 3 (Reports To) if contacts need multi-homed context

Gap 1 (Parent-Child Accounts)
  └─ MUST complete before Gap 2 (Global Ultimate Parent) — ultimate parent is a rollup over the tree
  └─ SHOULD complete before Gap 8 (Relationship Maps) — org chart needs account hierarchy as one axis

Gap 3 (Reports To)
  └─ SHOULD complete before Gap 8 (Relationship Maps) — org chart needs contact hierarchy as the other axis

Gap 7 (Duplicate Management)
  └─ SHOULD complete before Gap 1 & 4 — merging prevents orphaned hierarchy/junction records

Gap 6 (Social Enrichment)
  └─ Independent, but SHOULD land before Gap 8 if social URLs are nodes in the relationship map
```

---

## 5. Recommended Priority

| Priority | Gap | Why |
|----------|-----|-----|
| **P0** | Gap 1 — Parent-Child Account Hierarchies | Foundation of enterprise CRM; required for rollup forecasting, territory planning, and accurate pipeline attribution |
| **P0** | Gap 4 — Contact-to-Multiple-Accounts | Currently a single `companyId` is a hard constraint that blocks partner/channel sales models and contact portability |
| **P1** | Gap 5 — Contact Roles on Accounts | Natural follow-on to Gap 4; enables account-based selling and key-stakeholder tracking outside of individual deals |
| **P1** | Gap 3 — "Reports To" Contact Hierarchy | Enables org-chart selling and influence mapping; blocked by Gap 4 (multi-account) for clean data model |
| **P1** | Gap 7 — Duplicate Management | Data-quality gate; should be built before hierarchy data accumulates duplicates that become expensive to merge |
| **P2** | Gap 2 — Global Ultimate Parent Tracking | Valuable for enterprise account planning, but only meaningful once Gap 1 (hierarchy) exists |
| **P2** | Gap 6 — Social Data Enrichment | Nice-to-have for seller productivity; no downstream blockers |
| **P3** | Gap 8 — Relationship Maps / Visual Org Chart | High visual impact, but requires P0/P1 data-model gaps to be useful; pure frontend effort once data is ready |

---

## 6. Implementation Notes

### 6.1 Schema Changes Required

**Company self-relation (Gap 1):**
```prisma
model Company {
  // ... existing fields
  parentId          String?   @map("parent_id") @db.Uuid
  hierarchyDepth    Int       @default(0) @map("hierarchy_depth")
  globalUltimateId  String?   @map("global_ultimate_id") @db.Uuid
  parent            Company?  @relation("CompanyHierarchy", fields: [parentId], references: [id])
  children          Company[] @relation("CompanyHierarchy")
}
```
- Add `@@index([orgId, parentId])`
- Add cycle-prevention trigger or application-layer check (Prisma does not support self-relation cycle constraints natively).

**Contact multi-account junction (Gap 4 + 5):**
```prisma
model ContactCompany {
  id          String   @id @default(uuid()) @db.Uuid
  orgId       String   @map("org_id") @db.Uuid
  contactId   String   @map("contact_id") @db.Uuid
  companyId   String   @map("company_id") @db.Uuid
  role        String   @default("stakeholder")
  isPrimary   Boolean  @default(false) @map("is_primary")
  createdAt   DateTime @default(now())
  contact     Contact  @relation(fields: [contactId], references: [id])
  company     Company  @relation(fields: [companyId], references: [id])
  @@unique([orgId, contactId, companyId])
}
```
- Deprecate `Contact.companyId` after backfill migration.

**Contact self-relation (Gap 3):**
```prisma
model Contact {
  // ... existing fields
  reportsToId String?  @map("reports_to_id") @db.Uuid
  reportsTo   Contact? @relation("ContactReportsTo", fields: [reportsToId], references: [id])
  reports     Contact[] @relation("ContactReportsTo")
}
```

**Social fields (Gap 6):**
```prisma
model Contact {
  linkedInUrl  String? @map("linkedin_url")
  twitterUrl   String? @map("twitter_url")
  // optionally: xingUrl, facebookUrl
}
```

### 6.2 API Impact

- `apps/api/src/routes/companies.ts`:
  - GET `/companies/:id` must `include: { children: true, parent: true, contacts: { include: { contactCompanies: true } } }`
  - PATCH must reject `parentId` that creates a cycle.
- `apps/api/src/routes/contacts.ts`:
  - GET `/contacts/:id` must resolve `contactCompanies` with roles, not single `companyId`.
  - PATCH must allow updating `reportsToId`.
- `apps/api/src/routes/opportunity-contacts.ts`:
  - No breaking changes, but opportunity-contact role enum should probably be unified with the new `ContactCompany` role vocabulary.

### 6.3 UI Impact

- `CompanyDetailPage.tsx`:
  - Add a **Hierarchy** tab or sidebar card showing parent/children.
  - Add a **“View Hierarchy”** button/link (even if initially just a tree list).
  - Contacts tab must show the contact’s *account-level* role, not just job title.
- `ContactDetailPage.tsx`:
  - Replace single-account link with a card list of affiliated accounts + roles.
  - Add **“Reports To”** field and subordinate list.
  - Add social icon links if URLs present.
- New component needed: `AccountHierarchyTree`, `ContactOrgChart` (can start with nested `<ul>`/`<li>` and upgrade to D3/React-Flow for Gap 8).

### 6.4 Data Migration Risks

- **Gap 4 (Multi-account)** is the riskiest: every existing `Contact.companyId` must be migrated into a `ContactCompany` row with `isPrimary: true`. The `customer` free-text field must be reconciled against actual `Company` rows.
- **Gap 1 (Hierarchy)** is low-risk if added as nullable columns; existing companies simply have `parentId: null`.
- **Gap 7 (Duplicates)** should be tackled *before* Gap 1 & 4 so that hierarchy/junction records are not created against duplicate company/contact clusters.

### 6.5 Existing Primitives That Help

- `pg_trgm` extension is already enabled in Prisma (`extensions = [pgcrypto, pg_trgm, citext]`). This can power fuzzy duplicate detection (Gap 7) immediately.
- `OpportunityContact` is a proven pattern that can be cloned for `ContactCompany` (Gap 5).
- The `CompanyEnrichment` table already caches external provider metadata; social enrichment (Gap 6) can extend `providerMetadata` JSON or add typed columns.

---

## 7. Summary Score vs Salesforce

| Category | Salesforce | BidStack | Gap |
|----------|-----------|----------|-----|
| Parent-Child Account Hierarchy | ✅ Full tree + rollup | ❌ Flat table | **Critical** |
| Global Ultimate Parent | ✅ D-U-N-S driven | ❌ Absent | High |
| Contact Reporting Structure | ✅ `ReportsToId` + org chart | ❌ Flat | High |
| Multi-Account Contacts | ✅ `AccountContactRelation` | ❌ Single `companyId` | High |
| Account-Level Contact Roles | ✅ `AccountContactRole` | ❌ Only opp-level roles | Medium-High |
| Opportunity-Level Contact Roles | ✅ `OpportunityContactRole` | ✅ `OpportunityContact` | **Parity** |
| Social Enrichment | ✅ LinkedIn, Twitter | ❌ None | Medium |
| Duplicate Management | ✅ Rules + Merge wizard | ❌ Basic lookup only | Medium |
| Relationship Maps | ✅ Visual org chart | ❌ None | Medium |

**Verdict:** BidStack has **1 of 9** capabilities at parity with Salesforce in this domain. The single win is opportunity-level contact roles. The foundational gaps (flat companies, single-homed contacts) are blockers for any enterprise CRM positioning and should be treated as P0.
