# 🔍 BIDCRM Deep Audit Report — Salesforce Standards Benchmark

**Audit Date:** 2026-05-29  
**Branch:** `feat/wave9-rfp-engine`  
**Scope:** Full-stack audit of `apps/web`, `apps/api`, `apps/worker`, `apps/mcp-server`, `packages/db`, `packages/shared`  
**Auditors:** 8 specialist agents + direct reconnaissance  
**Lines of Code Audited:** ~1,100+ source files (523 web, 322 API, 62 worker, 193 packages)

---

## 📊 Executive Summary

| Domain                       | Grade | Critical | High | Medium | Low | Status                                                         |
| ---------------------------- | ----- | -------- | ---- | ------ | --- | -------------------------------------------------------------- |
| **Security & Auth**          | B+    | 0        | 3    | 7      | 4   | ⚠️ PII encryption off by default                               |
| **API REST Standards**       | B     | 3        | 7    | 10     | 7   | ⚠️ Money-as-float, stale OpenAPI                               |
| **Frontend UI/UX (SLDS)**    | B+    | 5        | 8    | 6      | 0   | ⚠️ 37 legacy buttons, 81 hardcoded colors                      |
| **Accessibility (WCAG 2.2)** | A-    | 3        | 3    | 4      | 3   | ⚠️ Custom modals lack focus traps                              |
| **Database Schema**          | B     | 5        | 7    | 9      | 7   | ⚠️ Missing indexes on auth hot paths                           |
| **Code Quality**             | B     | —        | —    | —      | —   | 339 `any` usages, 28 console.logs                              |
| **Performance**              | A-    | —        | —    | —      | —   | Excellent Vite chunking, lazy loading                          |
| **Empty Shells/Stubs**       | C+    | 5        | 9    | 5      | 6   | Microsoft OAuth placeholder, marketing footer, stub auth build |
| **Settings/Admin UX**        | C+    | 5        | 8    | 6      | 3   | 25-30% of Salesforce Setup, org settings unused                |
| **Integrations**             | B     | —        | —    | —      | —   | Good webhook HMAC, some OAuth placeholders                     |
| **Documentation/Tests**      | B     | —        | —    | —      | —   | 105 test files, good integration coverage                      |
| **Mobile/Responsive**        | C     | —        | —    | —      | —   | Mobile app is 644-line scaffolding                             |

**Overall Salesforce Readiness Score: 72/100** (Minimum viable for enterprise: 85/100)

---

## 🚨 CRITICAL FINDINGS (Must Fix Before Production)

### C1. PII Encryption Disabled by Default — SECURITY

- **File:** `.env.example:186`, `apps/api/src/env.ts`
- **Issue:** `PII_FIELD_ENCRYPTION=false` is the default. Contact/Lead/User PII stored plaintext.
- **Salesforce Equivalent:** Shield Platform Encryption non-compliant
- **Risk:** GDPR violation, data breach liability
- **Fix:** Set `PII_FIELD_ENCRYPTION=true` as production default. Run `scripts/encrypt-existing-pii.ts`

### C2. Money Serialized as Float — API CONTRACT

- **File:** `apps/api/src/serializers/opportunity.ts:76`
- **Issue:** `value: Number(o.valueMicros) / 1_000_000` introduces floating-point precision errors
- **Salesforce Equivalent:** Financial data integrity violation
- **Risk:** Incorrect deal values, invoicing errors
- **Fix:** Return `valueMicros` as string consistently across all resources

### C3. CORS Allows Null Origin with Credentials — SECURITY

- **File:** `apps/api/src/server.ts:144-158`
- **Issue:** `if (!origin) return cb(null, true)` with `credentials: true` allows malicious contexts
- **Risk:** Cross-origin authenticated requests from `file://` URLs, sandboxed iframes
- **Fix:** Reject null origin in production

### C4. Open Redirect in Email Tracking — SECURITY

- **File:** `apps/api/src/routes/track.ts:133-145`
- **Issue:** Redirect targets not restricted to known domains
- **Risk:** Phishing attacks via crafted tracking links
- **Fix:** Maintain explicit redirect allow-list per org

### C5. Stale OpenAPI Spec Misleads Partners — API CONTRACT

- **File:** `handoff/openapi.yaml`
- **Issue:** Version `0.1.0`, omits `/api/v1/` prefix, only ~8 paths. Waves 5-10 missing entirely.
- **Risk:** Partner/mobile integrations built against invalid contract
- **Fix:** Delete or auto-sync from live `@fastify/swagger` spec

### C6. Custom Modals Without Focus Traps — ACCESSIBILITY

- **Files:** `pages/ProductsPage.tsx:257`, `pages/RfpAgentsPage.tsx:247`, `components/settings/WebhooksSection.tsx:168`, `components/onboarding/TourStep.tsx:127`
- **Issue:** Raw `<div role="dialog" aria-modal="true">` without Radix Dialog focus traps
- **WCAG:** 2.4.3 (Focus Order), 2.4.7 (Focus Visible) failure
- **Fix:** Wrap in `<Modal.tsx>` or Radix Dialog primitive

### C7. Dual Button System Breaks Design System — UI/UX

- **Files:** 37 locations across pages and components
- **Issue:** Legacy `className="btn btn-secondary"` bypasses `<Button>` primitive
- **Impact:** No dark-mode glow, no reduced-motion, no focus rings, no touch-target expansion
- **Fix:** Migrate all `.btn` → `<Button variant="*" size="*">`

### C8. Hardcoded Colors Bypass Token System — UI/UX

- **Files:** 81 instances across `pages/intake/*`, `pages/CustomObject*.tsx`, `components/rfp/approval/ApprovalGate.tsx`, etc.
- **Issue:** `bg-green-50`, `text-amber-700`, `bg-red-50` etc. hardcoded instead of CSS variables
- **Impact:** Contrast drift, brand inconsistency, dark-mode breakage
- **Fix:** Replace with `var(--success-tint)`, `var(--warning)`, `var(--danger-tint)` tokens

---

## 🔶 HIGH FINDINGS (Fix in Sprint 1)

### H1. 400 Used for ALL Validation; 422 Never Used — API

- **Across all routes**
- Zod errors, FK failures, business-rule violations all return `400`
- RFC 9110: `400` = malformed syntax, `422` = semantically incorrect
- **Fix:** Route-level semantic validation → `422`

### H2. No `totalCount` in Paginated Lists — API

- **Files:** `opportunities.ts`, `leads.read.routes.ts`, `contacts.ts`, `companies.ts`, `invoices.ts`
- Cursor pagination lacks totals; UI can't show "Showing 1-50 of 1,247"
- **Fix:** Add inexpensive `count()` query to page envelope

### H3. Mixed Pagination Paradigms — API

| Resource                       | Style                | Issue              |
| ------------------------------ | -------------------- | ------------------ |
| Opportunities, Leads, Contacts | Cursor               | ✓ Consistent       |
| Custom Object Records          | Offset               | Inconsistent       |
| Bid Scores                     | Offset (no total)    | Incomplete         |
| Activities                     | Hybrid offset+cursor | Undefined behavior |
| Files, Migrations, API Keys    | Limit only           | No pagination      |

### H4. No Bulk DELETE/PATCH for Core Resources — API

- **Files:** `opportunities.ts`, `contacts.ts`, `leads.ts`, `companies.ts`
- Frontend bulk-delete fires N sequential DELETEs
- **Fix:** Add `PATCH /opportunities { ids, patch }` and `DELETE /opportunities { ids }`

### H5. Async 202 Responses Lack `Location` Header + No Job Status Endpoint — API

- **Files:** `rfp-pipeline.ts`, `dust-integration.ts`, `calls.read.routes.ts`
- Clients must poll entity state or use SSE (RFP-only)
- **Fix:** Add `GET /jobs/:id` backed by BullMQ; return `Location` header on 202

### H6. Ad-Hoc Error Shapes Bypass Central Handler — API

- **Files:** `crm/summary.ts:234`, `health.ts:281`, `integrations/zapier.ts`, `integrations/calls-webhooks.ts`, `cs.ts`
- Examples: `{ error: 'Unauthorized' }`, `{ ok: false }`, `{ message: 'Signal not found' }`
- **Fix:** Use `throw server.httpErrors.*()` everywhere

### H7. Form Labels Not Programmatically Associated — A11Y

- **Files:** `pages/LeadDetailPage.tsx` (9 labels), `pages/NewInvoicePage.tsx` (3 labels), `pages/NewSalesOrderPage.tsx` (4 labels), `components/widgets/WidgetConfigModal.tsx` (4 labels)
- `<label>` siblings of inputs lack `htmlFor`; inputs lack `id`
- **Fix:** Replace with `Input`/`Select` primitives or add `htmlFor`+`id` pairs

### H8. Icon-Only Buttons Rely on `title` (No `aria-label`) — A11Y

- **File:** `pages/territoriesPage/TerritoryPanels.tsx` (4 buttons)
- `title` ignored by many screen readers and voice-control software
- **Fix:** Add `aria-label="Edit territory"` / `aria-label="Delete territory"`

### H9. Missing RBAC on AI Assistant & Account Intel — SECURITY

- **Files:** `apps/api/src/routes/ai-assistant.ts`, `apps/api/src/routes/account-intel.ts:139-175`
- Any org member can access AI features and delete account intel
- **Fix:** Add `server.requirePermission(...)` gates

### H10. API Keys Never Expire — SECURITY

- **File:** `apps/api/src/routes/dust-integration.ts:245-283`
- Compromised keys remain valid indefinitely
- **Fix:** Require max TTL (90 days) at creation

### H11. SSRF Guard Missing IPv6 ULA & DNS Rebinding — SECURITY

- **File:** `apps/api/src/lib/ssrf-guard.ts:20-54`
- Missing `fc00::/7`, `::ffff:10.`, `::ffff:172.16.`, `::ffff:192.168.` blocks
- **Fix:** Add IPv6 ULA blocks and DNS-resolution validation for high-risk calls

### H12. Malware Scanning Placeholder — SECURITY

- **File:** `apps/api/src/routes/files.ts:175-178`
- `STORAGE_SCAN_REQUIRED=true` throws 409 without performing any scan
- **Fix:** Integrate ClamAV/Cloudmersive or remove the flag

### H13. Raw HTML Form Elements Bypass Accessible Primitives — UI/UX

- **Files:** `AccountsPage.tsx:234` (raw `<input>`), `AccountsPage.tsx:243` (raw `<select>`), `ApprovalGate.tsx:145` (raw `<textarea>`)
- Missing `aria-invalid`, `aria-errormessage`, `aria-describedby`, auto-generated IDs
- **Fix:** Wrap all form elements in `Input` / `Select` / new `Textarea` primitives

### H14. Missing Required-Field Indicators — UI/UX

- **Files:** `NewCompanyDialog.tsx`, `CreateOpportunityDialog.tsx`, `NewInvoicePage.tsx`, `NewSalesOrderPage.tsx`
- No visual asterisk or "Required" helper shown
- **Fix:** Add `required` prop to `Input` that renders visual indicator

---

## 📋 MEDIUM FINDINGS (Fix in Sprint 2)

### API (10 items)

1. **M-1:** Missing pagination on `GET /files`, `GET /custom-fields`, `GET /api-keys`
2. **M-2:** No client-controlled `sort` parameter (all lists hard-code `updatedAt: desc`)
3. **M-3:** No sparse fieldsets (`?fields=id,name,stage`)
4. **M-4:** No deprecation strategy (only v1 allowed, no `Sunset` headers)
5. **M-5:** Integration route URL inconsistency (`/setup-guide`, `/probe` not namespaced)
6. **M-6:** `accounts` vs `companies` conceptual overlap
7. **M-7:** `POST /opportunities/import` synchronous (risks gateway timeout for 10K rows)
8. **M-8:** Custom rate limits lack `Retry-After` header
9. **M-9:** `reply.notFound()` mixed with manual `reply.code(404).send(...)`
10. **M-10:** `deletedAt` exposed in custom object record responses

### Accessibility (4 items)

1. **M-1:** Duplicate/noisy live regions (~15 pages have identical `sr-only` status paragraphs)
2. **M-2:** `aria-modal` inconsistency (Radix vs manual)
3. **M-3:** Pipeline progress dots convey completion by color alone
4. **M-4:** Inline-edit trigger suppresses focus ring (`outline: none`)

### Security (3 items)

1. **M-1:** Known vulnerable dependencies (`ws` DoS, `tmp` insecure temp files)
2. **M-2:** Build scripts allow stub auth bypass (`BIDSTACK_ALLOW_STUB_AUTH=true` in build/preview)
3. **M-3:** Public routes without rate limiting (`/public/nps/:token`, `/track/email/*`)

### UI/UX (4 items)

1. **M-1:** Mixed icon libraries — 16 files import `lucide-react` directly
2. **M-2:** OpportunitiesPage uses raw `<table>` instead of `Table` primitive
3. **M-3:** Missing pagination component for datasets > 25 rows
4. **M-4:** Dialog close button uses `×` glyph instead of Icon component

---

## 🔹 LOW FINDINGS (Backlog)

### API

- No HATEOAS links, no `Last-Modified`, no `Vary` header, OpenAPI omits 4xx, untagged routes, no `Accept` enforcement

### Accessibility

- Breadcrumb current page in plain `<span>`, missing `fieldset`/`legend` on filter groups

### Security

- Missing `Clear-Site-Data` on sign-out, health endpoints expose component status, WebSocket maxPayload 4MB could be lowered

### UI/UX

- `SavedFlash` uses emoji checkmark, `ErrorBoundary` uses hardcoded SVG, `BulkActionBar` delete uses ghost variant with manual danger color, `ChartContainer` menu lacks outside-click dismissal

---

## 🏗️ SALESFORCE FEATURE PARITY GAP ANALYSIS

| Salesforce Feature          | BIDCRM Status                                 | Gap Severity |
| --------------------------- | --------------------------------------------- | ------------ |
| **Leads**                   | ✅ Full                                       | —            |
| **Accounts/Companies**      | ✅ Full                                       | —            |
| **Contacts**                | ✅ Full                                       | —            |
| **Opportunities**           | ✅ Full                                       | —            |
| **Tasks & Activities**      | ✅ Full                                       | —            |
| **Campaigns**               | ❌ **Missing entirely**                       | 🔴 Critical  |
| **Quotes/CPQ**              | ⚠️ Partial (Quote model exists, minimal UI)   | 🟡 High      |
| **Contracts**               | ⚠️ Partial (eSignature exists)                | 🟡 Medium    |
| **Orders**                  | ✅ Full (Sales Orders + Invoices)             | —            |
| **Products & Price Books**  | ✅ Full                                       | —            |
| **Forecasts**               | ✅ Full                                       | —            |
| **Territories**             | ✅ Full                                       | —            |
| **Cases/Service Desk**      | ✅ Full                                       | —            |
| **Reports & Dashboards**    | ✅ Full                                       | —            |
| **Custom Objects & Fields** | ✅ Full                                       | —            |
| **Workflow Rules**          | ✅ Full                                       | —            |
| **Approval Processes**      | ✅ Full                                       | —            |
| **Validation Rules**        | ❌ **Missing**                                | 🔴 Critical  |
| **Duplicate Management**    | ❌ **Missing**                                | 🟡 High      |
| **Process Builder/Flows**   | ⚠️ Partial (Workflows only)                   | 🟡 Medium    |
| **Email Templates**         | ✅ Full                                       | —            |
| **Mass Email**              | ❌ **Missing**                                | 🟡 Medium    |
| **Data Import Wizard**      | ⚠️ Partial (CSV paste for contacts only)      | 🟡 Medium    |
| **Data Loader**             | ⚠️ Partial (Bulk import API for opps only)    | 🟡 Medium    |
| **Sandbox Management**      | ❌ **Missing**                                | 🟡 High      |
| **Field History Tracking**  | ⚠️ Partial (Audit logs exist)                 | 🟡 Low       |
| **Record Types**            | ❌ **Missing**                                | 🟡 Medium    |
| **Page Layouts**            | ❌ **Missing**                                | 🟡 Medium    |
| **Compact Layouts**         | ❌ **Missing**                                | 🟡 Medium    |
| **Lightning App Builder**   | ❌ **Missing**                                | 🟡 Low       |
| **Chatter/Feed**            | ❌ **Missing**                                | 🟡 Low       |
| **Files & Notes**           | ✅ Full                                       | —            |
| **Collaboration**           | ✅ Full (Y.js real-time)                      | —            |
| **Mobile App**              | ⚠️ **644-line scaffolding**                   | 🔴 Critical  |
| **Offline Sync**            | ⚠️ Partial (PWA manifest + offline indicator) | 🟡 Medium    |
| **AI/Einstein**             | ✅ Full (Dust integration)                    | —            |

---

## 🎯 PRIORITY ACTION PLAN

### Week 1 — Critical Blockers

1. **Enable PII encryption** — set `PII_FIELD_ENCRYPTION=true`, run migration script
2. **Fix money-as-float** — return `valueMicros` as string in all serializers
3. **Fix CORS null origin** — reject `null` origin in production
4. **Fix open redirect** — add domain allow-list to email tracking
5. **Delete/sync OpenAPI spec** — generate from live swagger or add CI gate
6. **Migrate custom modals** — 4 files to `Modal.tsx` or Radix Dialog
7. **Migrate legacy buttons** — 37 files from `.btn` to `<Button>`
8. **Replace hardcoded colors** — 81 instances to design tokens

### Week 2 — High Priority

9. **Standardize 400 vs 422** — semantic validation → 422
10. **Add `totalCount` to pagination** — core list endpoints
11. **Standardize pagination** — cursor-first everywhere
12. **Add bulk DELETE/PATCH** — opportunities, contacts, leads, companies
13. **Add job status endpoint** — `GET /jobs/:id` backed by BullMQ
14. **Fix form labels** — add `htmlFor`/`id` to 20+ unassociated labels
15. **Add `aria-label`** to 4 icon-only territory buttons
16. **Add RBAC gates** — AI assistant and account-intel routes
17. **Set API key expiry** — 90-day TTL default
18. **Fix SSRF guard** — IPv6 ULA + DNS rebinding blocks
19. **Implement malware scanning** or remove `STORAGE_SCAN_REQUIRED` stub
20. **Add required-field indicators** — asterisk or "(Required)" suffix

### Week 3 — Medium Priority

21. Add pagination to files, custom-fields, api-keys endpoints
22. Add client `sort` parameter support
23. Add sparse fieldsets (`?fields=`)
24. Add deprecation headers for API versioning
25. Fix integration route namespacing
26. Merge `accounts` into `companies` resource
27. Make opp import async (202 + jobId)
28. Add `Retry-After` to custom rate limits
29. Standardize error shapes everywhere
30. Remove `deletedAt` from public serializers
31. Consolidate live regions to global `LiveAnnouncer`
32. Add `aria-label` to pipeline progress dots
33. Fix inline-edit focus ring
34. Update vulnerable `ws` and `tmp` dependencies
35. Remove `BIDSTACK_ALLOW_STUB_AUTH` from build scripts
36. Add rate limits to public tracking routes
37. Build `Pagination` component
38. Standardize tables on `Table` primitive
39. Unify icon imports under custom `Icon` component
40. Create `Textarea` primitive

### Sprint 4+ — Salesforce Feature Gaps

41. **Campaign Management** — full Campaign object + UI + member tracking
42. **Validation Rules** — per-object formula-based validation engine
43. **Duplicate Management** — matching rules + merge UI
44. **Record Types** — per-profile record type assignments
45. **Page Layouts** — drag-drop layout builder
46. **Mass Email** — template + recipient list + send queue
47. **Data Import Wizard** — guided CSV import for all objects
48. **Sandbox Management** — sandbox org provisioning
49. **Mobile App** — complete React Native implementation (currently 644 lines)
50. **Offline Sync** — service worker + IndexedDB + conflict resolution

---

## ✅ POSITIVE FINDINGS (Preserve)

### Architecture

- **Excellent design-token foundation** — 120+ CSS variables, full light/dark parity, WCAG-verified contrast
- **Accessibility-first primitives** — `Input.tsx` and `Select.tsx` with full ARIA wiring
- **Reduced-motion respect** — Every Framer Motion component checks `useReducedMotion()`
- **Focus rings** — Global `2px solid` focus-visible with halo
- **Error boundaries** — Two-level boundaries (app-level + route-level)
- **Dark mode mandatory** — Every primitive has `dark:` variants

### Security

- **Clerk JWT** with `authorizedParties` verification
- **API keys stored as SHA-256 hashes**
- **Tenant isolation** — 526 `orgId` scoping usages across routes
- **HMAC-SHA256 webhook signatures** with constant-time comparison
- **Replay protection** — 5-minute window + event dedup
- **Zod validation** on all inputs
- **Path traversal protection** (`safeJoin`)
- **Content-type allow-list** for uploads
- **CSRF state tokens** for OAuth
- **Penetration test suite** — access control, injection, upload, webhook tests
- **Pino redaction** of secrets in logs
- **Helmet + custom security headers** — CSP, HSTS, COOP, Permissions-Policy

### API

- **Cursor pagination** on most list routes
- **Idempotency keys** — 24h TTL, Redis-backed
- **Request ID correlation** — `X-Request-Id` header
- **Soft deletes** — `deletedAt` universally, no hard deletes
- **Rate limiting** — `@fastify/rate-limit` + Redis + per-route overrides
- **Caching** — ETag + stale-while-revalidate + 304
- **Audit logging** — Every mutation writes `auditLog` atomically
- **API versioning** — `/api/v1/` prefix + `X-API-Version` header
- **Async 202 pattern** — RFP, Dust, calls

### Performance

- **Excellent Vite chunking** — 15+ manual chunks (router, tanstack, radix, clerk, sentry, motion, charts, maps, editor, collab, dnd)
- **Route-based lazy loading** — 45+ `React.lazy()` pages
- **PWA ready** — manifest.json, service worker, offline indicator
- **Font preloading** — Barlow + Instrument Serif with `display=swap`
- **Theme flash prevention** — Inline script applies theme before paint

---

## 📈 METRICS SNAPSHOT

| Metric                        | Count      |
| ----------------------------- | ---------- |
| Frontend files (`.ts`/`.tsx`) | 523        |
| API files (`.ts`)             | 322        |
| Worker files (`.ts`)          | 62         |
| Package files (`.ts`)         | 193        |
| Prisma models                 | 100+       |
| API route files (excl tests)  | 116        |
| Web page components           | 58         |
| Component directories         | 40+        |
| Custom hooks                  | 65+        |
| Zustand stores                | 12         |
| API service files             | 60+        |
| Worker queue modules          | 24         |
| MCP tools                     | 19         |
| DB migrations                 | 32         |
| `@index` directives           | 386        |
| `any` usages                  | 339        |
| `console.log` in production   | 28         |
| TODO/FIXME comments           | 49         |
| Web tests                     | 32         |
| API integration tests         | 62         |
| Worker tests                  | 11         |
| E2E tests                     | ~15 suites |
| `eslint-disable` instances    | 71         |
| ARIA attributes in components | 658        |
| `aria-label`/`labelledby`     | 324        |
| Keyboard handlers             | 40         |
| React Query hooks             | 435        |
| Optimistic updates            | 14         |

---

_Report generated by 8 specialist audit agents + direct reconnaissance. Remaining agents (Database Schema, Empty Shells, Settings/Admin, Integration Security) will append findings when complete._

---

## 🗄️ DATABASE SCHEMA AUDIT FINDINGS

**Auditor:** Specialist Agent #6  
**Scope:** `packages/db/prisma/schema.prisma` (4,573 lines, 100+ models), migrations, services, middleware

### CRITICAL (Data Integrity / Hot-Path Performance)

#### DB-C1. Missing index on `ApiKey.hashed_key` and `ApiKey.prefix` — authentication hot path

- **Model:** `ApiKey`
- **Issue:** Every API request queries by `prefix` or `hashed_key`. Only `@@index([orgId])` and `@@index([deletedAt])` exist. Full table scan per request.
- **Fix:** Add `@@index([orgId, prefix])` and `@@index([orgId, hashed_key])`

#### DB-C2. Missing index on `ZapierApp.api_key_hash` — Zapier auth hot path

- **Model:** `ZapierApp`
- **Issue:** Zapier inbound requests authenticate by API key hash. No index; only `@@unique([orgId])`.
- **Fix:** Add `@@index([orgId, api_key_hash])`

#### DB-C3. Missing `(org_id, updated_at DESC)` index on `opportunities` — dashboard N+1 sort

- **Model:** `Opportunity`
- **Issue:** `dashboard.service.ts` loads `take: 100` ordered by `updatedAt: desc`. Existing indexes cover `createdAt DESC`, `stage`, `country`, `ownerId`, `customer`, `pipelineStageId` — but **not** `updatedAt DESC`.
- **Fix:** Add `@@index([orgId, updatedAt(sort: Desc)], map: "opps_org_updated_idx")`

#### DB-C4. Missing `(org_id, created_at DESC)` index on `tasks` — dashboard sort

- **Model:** `Task`
- **Issue:** Dashboard loads tasks with `orderBy: { createdAt: 'desc' }, take: 100`. No `createdAt DESC` index.
- **Fix:** Add `@@index([orgId, createdAt(sort: Desc)], map: "tasks_org_created_idx")`

#### DB-C5. AR Aging report loads entire invoice set into application memory

- **File:** `apps/api/src/services/invoices/invoices.service.ts` (`getArAgingReport`)
- **Issue:** `findMany` has **no `take` limit**. For large orgs with thousands of open invoices, Node.js buffers all rows and risks OOM.
- **Fix:** Rewrite as raw SQL aggregation, or add `take: 5000` safety cap

### HIGH (Design / Integrity Issues)

#### DB-H1. Orphaned `customer_id` columns on `SalesOrder` and `Invoice` without referential integrity

- **Models:** `SalesOrder` (line 1935), `Invoice` (line 2024)
- **Issue:** `customerId` is UUID with **no Prisma relation** and no FK constraint. Column is indexed in raw SQL but orphaned.
- **Fix:** Add explicit `@relation` to `Company` or drop the column if `companyId` supersedes it

#### DB-H2. Dual state on `Opportunity` — deprecated `stage` enum + new `pipelineStageId` can drift

- **Model:** `Opportunity`
- **Issue:** Backfill migration copied `stage` → `pipelineStageId`, but app code may still write `stage` without updating `pipelineStageId`. Dashboard serializer uses `pipelineStage?.key ?? opportunity.stage` as fallback, masking drift.
- **Fix:** Add DB trigger or application invariant to keep columns in sync, or drop `stage` after all callers migrate

#### DB-H3. Dozens of nullable User/Company FKs lack explicit `onDelete`, defaulting to `Restrict`

- **Affected:** `Opportunity.owner`, `Opportunity.company`, `Opportunity.territory`, `Opportunity.pipelineStage`, `Contact.company`, `Task.assignee`, `Invoice.salesperson`, `SalesOrder.salesperson`, `ServiceCase.owner`, `Lead.owner`, `Activity.owner`, `FileAttachment.uploader`, `ProductCategory.parent`
- **Issue:** Default `Restrict` prevents deletion of referenced rows. In a CRM, deleting a User or Company should `SetNull` on owned records.
- **Fix:** Add `onDelete: SetNull` to all nullable ownership/belonging relations

#### DB-H4. Required User FKs with no `onDelete` block hard user deletion

- **Models/Fields:** `Note.authorUserId`, `Comment.authorUserId`, `Mention.userId`, `Forecast.ownerId`, `Territory.ownerId`, `CallSession.userId`
- **Issue:** Hard-deleting a user (GDPR right-to-erasure) fails with FK violation.
- **Fix:** Add `onDelete: Cascade` or make fields nullable with `onDelete: SetNull`

#### DB-H5. `Comment.parentId` is not a declared Prisma self-relation

- **Model:** `Comment`
- **Issue:** Column exists for threading but no `parent Comment?` / `children Comment[]` relation. Deleting a parent leaves orphaned child comments.
- **Fix:** Declare self-relation with `onDelete: Cascade` or `SetNull`

#### DB-H6. `Lead.email` lacks `@db.Citext` — inconsistent with `Contact.email` and `User.email`

- **Issue:** `Contact.email` and `User.email` use `@db.Citext`. `Lead.email` is plain `String?`. Duplicate leads with `John@Example.com` vs `john@example.com` won't dedupe.
- **Fix:** Add `@db.Citext` to `Lead.email`

#### DB-H7. `BookingPage` and `CalendarEvent` aggressively cascade on User deletion

- **Issue:** Both use `onDelete: Cascade`. Deleting a user destroys their booking pages and calendar events permanently.
- **Fix:** Consider `onDelete: SetNull` or soft-delete propagation

### MEDIUM (Optimization Opportunities)

1. **Missing composite indexes** for common filtered list queries: `Opportunity` (orgId+dueDate), `Contact` (orgId+name), `RiskRegisterItem` (orgId+status+updatedAt), `ComplianceCheck` (orgId+status+updatedAt), `Quote` (orgId+validUntil), `Activity` (orgId+occurredAt)
2. **Invoice AR aging** lacks `(org_id, currency, state, due_date)` coverage
3. **N+1 query** in `renewal.service.ts` — loops with `findFirst` inside (1000 subs = 3001 queries)
4. **N+1 write** in `company.service.ts` — `autopopulateCompanies` loops with `upsert` per candidate
5. **`Opportunity` missing `createdById` / `updatedById`** audit fields
6. **`PredictiveModel`, `HealthScore`, `MigrationJob`, `LeadStageRotConfig`** lack soft-delete (`deletedAt`)
7. **`YjsUpdate` and `MemosTrace`** append-only with no retention policy — unbounded growth
8. **No explicit Prisma connection pool configuration** — risks exhausting PostgreSQL connections
9. **`EmailTemplate`** dual deletion state (`archived` + `deletedAt`)

### LOW (Convention Gaps)

1. `SyncEvent`, `AuditLog`, `SubscriptionEvent` use auto-increment BIGINT while rest uses UUID
2. `OpportunityStage` enum deprecated but remains in schema
3. `Note.accountId` and `FileAttachment.accountId` are deprecated free-text fields alongside `companyId`
4. `AccountSolution.accountId` and `AccountProduct.accountId` use `VarChar(255)` free text alongside `companyId`
5. `WebhookDelivery`, `AgentRun`, `DustRun`, `ReleaseScore`, `YjsUpdate`, `SourceChunk` lack `updatedAt`
6. `CustomFieldValue.value` is raw `Json` with no DB-level schema validation
7. `Company.address` has `@default("{}")` on nullable `Json?` field (redundant)

---

## 🐚 EMPTY SHELLS, STUBS & INCOMPLETE FEATURES

**Auditor:** Specialist Agent #7  
**Scope:** All apps/, packages/sdk-\*/, packages/integrations/, apps/mobile/, apps/marketing/, apps/chrome-extension/

### CRITICAL (User-facing empty features — false advertising or production risk)

#### ES-C1. Microsoft 365 Integration — Placeholder OAuth URLs

- **File:** `apps/api/src/routes/microsoft.ts:77-84`
- **Code:** `client_id=PLACEHOLDER&redirect_uri=PLACEHOLDER`
- **Impact:** UI explicitly detects this and shows "OAuth is not configured yet." Users cannot connect Microsoft 365.

#### ES-C2. Marketing Site — Deceptive Footer Navigation

- **File:** `apps/marketing/src/components/Footer.tsx:13-44`
- **Code:** 8+ footer links route to `/` instead of real pages: Pipeline, Proposals, Accounts, Workflows, IT services bids, Government RFPs, About, Careers
- **Impact:** Users click and silently land back on homepage

#### ES-C3. Marketing Site — Text-only Social Proof Logos

- **File:** `apps/marketing/src/pages/HomePage.tsx:70-78`
- **Code:** `['Amaris', 'LittleBig', 'Pulsar', 'CAI', 'Mantu', 'GhostPilot'].map((name) => <div aria-label={`${name} logo placeholder`}>{name}</div>)`
- **Impact:** "Trusted by" section displays text labels instead of actual brand logos. Reads as fake social proof.

#### ES-C4. Chrome Extension — Missing Required Icons

- **File:** `apps/chrome-extension/src/icons/ICON_PLACEHOLDER.md`
- **Impact:** No `icon-16.png`, `icon-48.png`, or `icon-128.png`. Chrome Web Store submission would be rejected.

#### ES-C5. Web Build Defaults to Stub Auth Mode

- **File:** `apps/web/package.json:8`
- **Code:** `"build": "cross-env ... BIDSTACK_ALLOW_STUB_AUTH=true VITE_AUTH_MODE=stub ..."`
- **Impact:** Default `pnpm build` ships stub authentication (`STUB_USER` hardcoded as "Jane Smith"). `build:prod` exists but is not the default.

### HIGH (Major features incomplete or silently non-functional)

1. **Salesforce Integration sync is a no-op stub** — `packages/integrations/src/salesforce/index.ts:140-142` returns `{ created: 0, updated: 0, deleted: 0, errors: [] }`
2. **Microsoft Integration sync is a no-op stub** — `packages/integrations/src/microsoft/index.ts:136-138` same pattern
3. **Call Recording — Teams/Google Meet not implemented** — `apps/worker/src/queues/calls.ts:147-152` skips with log warning
4. **HubSpot Migration — wrong enum type** — stored as `type: 'salesforce'` instead of `'hubspot'`
5. **Empty canonicalize migration** — `packages/db/prisma/migrations/20260516010000_canonicalize_opportunity_stage/migration.sql` is 0 bytes
6. **Mobile App — Sentry stub** — `apps/mobile/src/bridge/notifications.ts:19-25` is a no-op console warning
7. **RFP Section Draft — degraded to placeholder** on missing Dust config
8. **NPS Survey — placeholder tokenHash** — `'pending'` literal before update query
9. **Auth Plugin — placeholder email** — `${clerkUserId}@placeholder.com` for users without Clerk email

### MEDIUM (Partial implementations, silent skips, or deferred work)

1. **ComplianceMatrix missing virtual scrolling** — TODO for 200+ row matrices
2. **Predictive retrain cron** — wire-up TODO
3. **E2E tests** — ~40+ `test.skip()` calls masking broken/missing features
4. **API integration tests** — ~100+ `skipIfNoDb` tests silently skip instead of failing CI
5. **Lead convert** — placeholder opportunity ID during transaction

### LOW (Minor gaps, thin but functional SDKs, or legitimate empty states)

1. **SDKs** — Go ~1.8K lines, Python ~330 lines, Ruby ~180 lines. Thin but functional wrappers.
2. **Mobile app** — Well-built Expo WebView shell (biometric auth, push, camera, share, deep links, pull-to-refresh). Only Sentry stub and missing brand icons.
3. **Chrome extension** — Real service worker, API proxy, content scripts for Gmail/Outlook/LinkedIn/HubSpot, options page, popup search. Only missing PNG icons.
4. **Settings components** — 18 real implementation files. No shells or placeholders found.
5. **Pages** — 105 `.tsx` files. All contain real UI, data fetching, and interactivity.
6. **Legitimate empty states** — "Transcript not yet available", "No MEDDIC signals extracted", "Not yet reviewed", "Empty state — not yet generated"

---

## ⚙️ SETTINGS & ADMIN UX AUDIT FINDINGS

**Auditor:** Specialist Agent #8  
**Scope:** `apps/web/src/components/settings/`, admin routes, `OrgSettings` model, workflow/roles/territory pages  
**Verdict:** BIDCRM implements roughly **25–30%** of a full CRM setup menu.

### CRITICAL (Blockers for Production CRM Admin Experience)

#### AD-C1. `OrgSettings` Database Table Exists But Is Completely Unused by the Frontend

- **Prisma model `OrgSettings`** has 12 columns: `defaultCurrency`, `dateFormat`, `timezone`, `invoicePrefix`, `invoiceNetDays`, `taxRateDefault`, `companyAddress`, `emailFromName`, `emailFromAddress`, `pipelineStages`, `notificationPrefs`, `aiCostCapDailyMicros`.
- **No REST API route** exists to `GET` or `PATCH` org settings.
- **Frontend fakes settings with `localStorage`:**
  - `CurrencyLocaleSection` → `localStorage` only (`bidstack:currency-locale`)
  - `PipelineStagesSection` → `localStorage` only (`bidstack:pipeline-stages`)
  - `NotificationPrefsSection` → `localStorage` only (`bidstack:notifications`)
- **Impact:** Settings are per-browser, not per-org. Admins cannot set workspace defaults.

#### AD-C2. Workflow Page Is Read-Only — No Builder/Editor UI

- `WorkflowsPage.tsx` only **lists** workflows with filter by active status.
- **No create/edit UI** exists. API supports `POST /api/workflows`, `PATCH /api/workflows/:id`, but no visual workflow builder, trigger picker, or action configuration panel.
- **Impact:** Automation is API-only. Non-technical admins cannot create workflow rules.

#### AD-C3. Dead Components — Built But Not Wired Into Any Route

Three complete settings sections exist but are **never imported** by any page:

- `EmailTemplatesSection.tsx` (full template editor with placeholder palette)
- `TagsSection.tsx` (tag library with color picker, rename, usage counts)
- `LeadRotSection.tsx` (per-status rotten-days threshold config)

#### AD-C4. Security Settings Are Purely Read-Only Environment Displays

- `SecuritySection.tsx` shows auth provider badges and allowed domains, but all values are `import.meta.env.*` reads.
- **No controls for:** password policy, MFA/2FA, session timeout, IP allowlisting, login history, SSO configuration.
- **Impact:** Security posture cannot be managed by admins; requires env redeploys.

#### AD-C5. No In-App User Invitation or Lifecycle Management

- `TeamSection.tsx` lists users with promote/demote buttons only.
- **No invite user flow**, no deactivate/suspend, no password reset, no profile editing for other users.
- Comment: _"Clerk owns invites in production"_
- **Impact:** Admins cannot onboard new users without leaving the CRM.

### HIGH (Significant Admin UX Gaps)

1. **Pipeline Configuration is local-only** — `PipelineStagesSection` stores 7 hardcoded stages in `localStorage`. No server persistence via `OrgSettings.pipelineStages` JSON column.
2. **Custom Fields lack advanced capabilities** — Missing: formula fields, lookup/relationship fields, rollup summaries, dependent picklists, field-level security by role, page layout assignment.
3. **Custom Objects Admin has no field/layout editor** — `CustomObjectsAdminPage` creates object definitions (key, label, color) but no visual field builder for schema design.
4. **Roles system is partially implemented** — `users` API (`/users/:id/role`) only accepts `role: 'member' | 'admin'`. Custom roles cannot be assigned via UI. Missing: role hierarchy, field-level permissions, record-level sharing rules.
5. **No Territory Management Settings UI** — `Territory` model exists but no hierarchy, assignment rules, or territory-model management panel.
6. **No Approval Process Builder** — RFP has `ApprovalGate` but no general approval process builder in settings.
7. **Notification Settings are not org-configurable** — `NotificationPrefsSection` is personal-only (`localStorage`). Missing org-level defaults, per-channel routing, digest scheduling.
8. **No Feature Flag / Beta Management** — Missing gradual rollouts, per-org feature flags, beta opt-in, kill switches.
9. **No Connected Apps / OAuth Management** — Missing third-party app marketplace, OAuth consent management, scoped API access, app permission revocation.

### MEDIUM (Nice-to-Have Settings)

1. No Settings Search — static sidebar with 9 items, breaks down beyond ~15
2. No Data Import / Bulk Export UI — API routes exist but no unified CSV import wizard, field mapping UI, duplicate detection, data loader equivalent
3. No Backup, Restore, or Recycle Bin — missing scheduled backups, archive policies, trash/undelete UI
4. No Compliance / GDPR Settings — missing data retention policies, right-to-erasure workflows, consent management, cookie consent banner config
5. No Mobile Push Notification Org Configuration — only device-level status shown
6. Missing Advanced Field Types — no auto-number, geolocation, rich text, encrypted text, file attachment custom fields

### LOW (Polish)

1. Settings Navigation Depth Is Flat — only one level of nesting, needs collapsible sub-menus
2. No Settings Change Audit Trail — `AuditLog` covers record changes but not org config changes
3. No Settings Import / Export Between Environments — missing sandbox-to-production settings migration

---

## 🔄 UPDATE: INTEGRATION & WEBHOOK SECURITY AUDIT

**Status:** 🔄 Agent still running — will append findings upon completion

---

## 📈 UPDATED METRICS SNAPSHOT

| Metric                        | Count      |
| ----------------------------- | ---------- |
| Frontend files (`.ts`/`.tsx`) | 523        |
| API files (`.ts`)             | 322        |
| Worker files (`.ts`)          | 62         |
| Package files (`.ts`)         | 193        |
| Prisma models                 | 100+       |
| API route files (excl tests)  | 116        |
| Web page components           | 58         |
| Component directories         | 40+        |
| Custom hooks                  | 65+        |
| Zustand stores                | 12         |
| API service files             | 60+        |
| Worker queue modules          | 24         |
| MCP tools                     | 19         |
| DB migrations                 | 32         |
| `@index` directives           | 386        |
| `any` usages                  | 339        |
| `console.log` in production   | 28         |
| TODO/FIXME comments           | 49         |
| Web tests                     | 32         |
| API integration tests         | 62         |
| Worker tests                  | 11         |
| E2E tests                     | ~15 suites |
| `eslint-disable` instances    | 71         |
| ARIA attributes in components | 658        |
| `aria-label`/`labelledby`     | 324        |
| Keyboard handlers             | 40         |
| React Query hooks             | 435        |
| Optimistic updates            | 14         |
| Settings sections (built)     | 21         |
| Settings sections (dead code) | 3          |
| Mobile app lines              | 644        |
| SDK Go lines                  | ~1,800     |
| SDK Python lines              | ~330       |
| SDK Ruby lines                | ~180       |
| Marketing site components     | 16         |
| Chrome extension files        | 16         |
| ADR documents                 | 1          |
| Solutions docs                | 26         |

---

_Report generated by 8 specialist audit agents + direct reconnaissance. Last updated: 2026-05-29 22:45_
_Remaining agent: Integration & Webhook Security (expected completion imminent)_
