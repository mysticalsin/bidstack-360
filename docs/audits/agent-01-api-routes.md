# API Routes Domain Audit — `apps/api/src/routes/**/*.ts`

**Auditor:** agent-01  
**Date:** 2026-05-23  
**Scope:** 81 route files (`.ts`, excluding tests) + 21 CRM/integration sub-route files  
**Files sampled:** 18 route files across opportunities, companies, contacts, leads, tasks, accounts, invoices, sales-orders, notes, files, activities, search, webhooks, dust-integration, slack, roles, users, health, crm/dashboard, opportunity-timeline

---

## 1. Score

**72 / 100**

_Breakdown:_

- **RESTful design:** 18/25 — Endpoints are mostly resource-oriented, but path conventions vary (`/api/v1/accounts` vs `/crm/companies`), and some mutations use POST where PATCH would be more idiomatic.
- **Schema validation (Zod / OpenAPI):** 16/25 — Fastify-type-provider-zod is used on ~75 % of routes, but `openapi.yaml` is severely stale and several integration routes drop back to untyped `FastifyPluginAsync`.
- **AuthZ:** 12/25 — Global auth (Clerk → `req.auth`) is solid, but **permission/role guards are applied inconsistently**; many write endpoints are wide open to any authenticated org member while sibling routes are locked behind `requireRole('admin')`.
- **Error handling & serialization:** 14/25 — Two incompatible error patterns coexist (`throw server.httpErrors.*` vs `reply.notFound()`). Response shapes are generally correct but serialization strategy is split between dedicated serializer modules and inline ad-hoc mapping.
- **Organization & cohesion:** 12/25 — Several route files exceed 500 lines (invoices: 933, opportunities: 748, dust-integration: 743). Some files mix domain logic that should live in services.

---

## 2. Strengths

1. **Strong multi-tenancy scoping.** Every Prisma query includes `orgId: req.auth.orgId` and `deletedAt: null`. Two-step find-then-update is used correctly where Prisma lacks composite unique keys.
   - _Evidence:_ `tasks.ts:209-213`, `contacts.ts:155-159`, `notes.ts:255-259`

2. **Audit logging on nearly every mutation.** Create / update / delete / state-change operations consistently write an `auditLog` row inside a `$transaction`.
   - _Evidence:_ `opportunities.ts:207-224` (create), `invoices.ts:329-344` (create), `sales-orders.ts:233-243` (create)

3. **Rate limiting on high-value or dangerous routes.** Configured via `config: { rateLimit: { max, timeWindow } }` on imports, exports, Dust pushes, and state transitions.
   - _Evidence:_ `opportunities.ts:124` (30/min), `invoices.ts:276` (finance role gate), `dust-integration.ts:470` (20/min push-deal)

4. **Webhook security is production-grade.** `/webhooks/dust` implements HMAC verification (`verifyDustSignature`), replay-window enforcement (`MAX_TIMESTAMP_SKEW_MS = 5 min`), Redis-backed deduplication with in-process fallback, and org-resolution via subscription secret rather than client-supplied headers.
   - _Evidence:_ `webhooks.ts:72-99` (dedup), `webhooks.ts:153-159` (replay window), `webhooks.ts:187-198` (org resolution)

5. **Soft-delete discipline.** No hard-deletes observed in sampled files; all removals set `deletedAt: new Date()`.
   - _Evidence:_ `companies.ts:304-307`, `opportunities.ts:464` (tombstone + soft-delete in tx)

---

## 3. P0 Gaps (Critical)

### P0.1 — `openapi.yaml` is severely outdated and misaligned with code

The handoff OpenAPI spec defines ~10 paths; the API exposes 80+ route files with hundreds of endpoints. Worse, the spec’s `stage` enum for opportunities (`discovery`, `qualified`, `proposal`, `negotiation`, `closed_won`, `closed_lost`) does **not** match the code enum (`s1_lead`, `s1_ongoing`, `s2_sent`, `s3_technical_iteration`, `s4_negotiation`, `closed_won`, `closed_lost`).

- _Evidence:_ `handoff/openapi.yaml:98` vs `apps/api/src/routes/opportunities.ts:481-490`
- _Impact:_ Client code generation from the spec will produce wrong types and broken validators.

### P0.2 — AuthZ inconsistency: many write routes lack permission/role guards

While global authentication is enforced, **authorization is opt-in and patchy**. The following critical write routes have **zero** `preHandler` checks and are therefore accessible to any authenticated org member (including read-only users if the org has them):

| Route file                | Unguarded writes                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `opportunities.ts`        | POST `/opportunities`, PATCH `/opportunities/:id`, DELETE `/opportunities/:id`, POST `/opportunities/:id/stage` |
| `contacts.ts`             | POST `/contacts`, PATCH `/contacts/:id`, DELETE `/contacts/:id`                                                 |
| `leads.ts`                | POST `/leads`, PATCH `/leads/:id`, DELETE `/leads/:id`, POST `/leads/:id/convert`                               |
| `tasks.ts`                | POST `/tasks`, DELETE `/tasks/:id` (PATCH has inline admin/assignee check)                                      |
| `notes.ts`                | POST `/notes`, PATCH `/notes/:id`, DELETE `/notes/:id`                                                          |
| `activities.ts`           | POST `/activities`, PATCH `/activities/:id`, DELETE `/activities/:id`                                           |
| `files.ts`                | POST `/files/upload-url`, PUT `/files/local-upload`, POST `/files/finalize`, DELETE `/files/:id`                |
| `opportunity-timeline.ts` | (read-only, lower risk)                                                                                         |

By contrast, `companies.ts` guards write routes with both `requirePermission('companies:write')` **and** `requireRole('admin')`, and `invoices.ts` requires `requireRole('admin', 'finance')`.

- _Evidence:_ `companies.ts:107`, `invoices.ts:276` vs `opportunities.ts:121` (no preHandler), `contacts.ts:98` (no preHandler)
- _Impact:_ Principle of least privilege is violated; any compromised user token can mutate core CRM data.

### P0.3 — Dual error-handling patterns create inconsistency and test friction

Roughly half the codebase throws `server.httpErrors.*` (the Fastify standard) while the other half calls `reply.notFound()`, `reply.badRequest()`, etc. This makes it hard to write uniform error-handling tests and middleware.

- _Evidence:_
  - `throw` pattern: `opportunities.ts:276`, `contacts.ts:88`, `tasks.ts:124`
  - `reply` pattern: `activities.ts:98`, `activities.ts:171`, `bid-scores.ts:147`, `bid-workspace.ts:275`
- _Impact:_ Inconsistent response envelopes; some errors may bypass global error serializers.

### P0.4 — Several route modules drop compile-time schema validation

Routes that import `FastifyPluginAsync` (plain Fastify) instead of `FastifyPluginAsyncZod` lose Zod type-provider integration. They then rely on `server.withTypeProvider<ZodTypeProvider>()` at runtime, which is error-prone if a developer forgets to call it.

- _Affected files:_ `accounts.ts`, `calls.ts`, `integrations/slack.ts`, `integrations/email.ts`, `integrations/gmail.ts`, `integrations/microsoft-mail.ts`, `integrations/twilio.ts`, `integrations/zapier.ts`, `integrations/calls-webhooks.ts`, `realtime.ts`, `references.ts`, `track.ts`, `public-nps.ts`
- _Evidence:_ `accounts.ts:5-6`, `calls.ts:18`, `integrations/slack.ts:30-31`

---

## 4. P1 Gaps (Performance / Maintainability)

### P1.1 — Response serialization is inconsistent

Some domains use dedicated serializers (`serializeOpportunity`, `serializeCompany`) while others inline massive mapping objects. The inline approach is duplicated across GET / POST / PATCH handlers in the same file, creating drift risk.

- _Evidence:_ `leads.ts:64-81` (GET list), `leads.ts:191-213` (POST response) — same shape copy-pasted; `opportunities.ts:81-87` (serializer) vs `opportunities.ts:557-560` (inline object for stage endpoint)

### P1.2 — Route files are too large

Five files exceed 500 lines, mixing route wiring, business logic, helper functions, and Zod schema definitions. This hurts testability and code-review velocity.

- _File sizes (lines):_
  - `invoices.ts` — 933
  - `opportunities.ts` — 748
  - `dust-integration.ts` — 743
  - `territories.ts` — 806
  - `migrations.ts` — 698
  - `sales-orders.ts` — 448

### P1.3 — Missing error-response schemas in Fastify route definitions

Almost no route declares `4xx` or `5xx` response schemas. Fastify therefore cannot validate or serialize error payloads consistently.

- _Evidence:_ Search for `response: { 200:` across route files shows 20+ occurrences; `response: { 404:` or `response: { 409:` appears **zero** times in the sampled files.

### P1.4 — Query parameter coercion is inconsistent

Some list routes use `z.coerce.number()` for `limit` (e.g., `companies.ts:16`), while others rely on the shared schema (`OpportunityFilter`, `LeadFilter`) which may or may not coerce. This can lead to runtime string/number mismatches when query params are parsed.

- _Evidence:_ `companies.ts:16` uses `z.coerce.number().int().min(1).max(200).default(50)`; `opportunities.ts:36` destructures `limit` from `req.query` without local coercion, relying on `OpportunityFilter`.

---

## 5. P2 Gaps (Nice-to-have)

### P2.1 — `public-nps.ts` and `crm/summary.ts` have no schema at all

These routes are completely untyped at the Fastify boundary.

- _Evidence:_ `public-nps.ts` has no `schema:` key; `crm/summary.ts` has no `schema:` key.

### P2.2 — Inline Zod schemas could be hoisted to `@bidstack/shared`

Many route files redefine local Zod objects (e.g., `InvoiceUpdate` in `invoices.ts:165-176`, `ArAgingQuery` in `invoices.ts:35`, `CompanySearchQuery` in `crm/companies.ts:20-24`). Centralizing them would keep route files smaller and ensure frontend/backend parity.

### P2.3 — Date formatting is inconsistent

Some endpoints return `YYYY-MM-DD` (e.g., `tasks.ts:89` `toISOString().slice(0, 10)`), others return full ISO-8601 (`toISOString()`). The API contract should pick one convention per field type.

---

## 6. Evidence (Code Snippets)

### E1 — openapi.yaml vs code stage enum mismatch

```yaml
# handoff/openapi.yaml:98
stage:
  type: string
  enum: [discovery, qualified, proposal, negotiation, closed_won, closed_lost]
```

```ts
// apps/api/src/routes/opportunities.ts:481-490
stage: z.enum([
  's1_lead',
  's1_ongoing',
  's2_sent',
  's3_technical_iteration',
  's4_negotiation',
  'closed_won',
  'closed_lost',
]);
```

### E2 — Missing authZ on opportunity writes

```ts
// apps/api/src/routes/opportunities.ts:121-129
server.post(
  '/opportunities',
  {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      body: OpportunityCreate,
      response: { 201: Opportunity },
    },
  },
  async (req, reply) => {
    /* no preHandler */
  },
);
```

Contrast with:

```ts
// apps/api/src/routes/companies.ts:104-112
server.post(
  '/companies',
  {
    preHandler: [server.requirePermission('companies:write'), server.requireRole('admin')],
    schema: { body: CompanyCreate, response: { 201: Company } },
  },
  async (req, reply) => {
    /* … */
  },
);
```

### E3 — Mixed error patterns

```ts
// throw pattern (opportunities.ts:276)
if (!opp) throw server.httpErrors.notFound('Opportunity not found');

// reply pattern (activities.ts:98)
if (!entityBelongs) return reply.notFound('Entity not found');
```

### E4 — Untyped plugin registration

```ts
// apps/api/src/routes/accounts.ts:5-6
import type { FastifyPluginAsync } from 'fastify';
export const accountsRoutes: FastifyPluginAsync = async (server) => {
  const app = server.withTypeProvider<ZodTypeProvider>();
  // …
};
```

### E5 — Inline serialization duplication

```ts
// apps/api/src/routes/leads.ts:64-81 (GET list)
return {
  items: page.map((l) => ({
    id: l.id,
    firstName: l.firstName,
    // … 17 fields …
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  })),
  nextCursor: …
};

// apps/api/src/routes/leads.ts:191-213 (POST response)
return reply.code(201).send({
  id: created.id,
  firstName: created.firstName,
  // … same 17 fields copy-pasted …
  createdAt: created.createdAt.toISOString(),
  updatedAt: created.updatedAt.toISOString(),
});
```

### E6 — Missing error-response schema

```ts
// apps/api/src/routes/opportunities.ts:256-262
server.get(
  '/opportunities/:id',
  {
    schema: {
      params: z.object({ id: z.string().uuid() }),
      response: { 200: OpportunityFull },
      // 404, 403, 500 absent
    },
  },
  // …
);
```

---

## 7. Recommendations (Ranked)

1. **Synchronize `openapi.yaml`** with the actual codebase or generate it from the Zod schemas (e.g., via `fastify-zod-openapi` or a custom extractor). The current file is a liability.
2. **Standardize AuthZ:** Apply `requirePermission` guards to all write routes. If the product intent is "any authenticated user can edit opportunities/leads/etc.", document that explicitly in AGENTS.md; otherwise add the missing preHandlers.
3. **Pick one error pattern** — preferably `throw server.httpErrors.*` — and migrate `reply.notFound()` / `reply.badRequest()` calls. A one-time codemod is feasible (~29 occurrences).
4. **Migrate remaining `FastifyPluginAsync` routes** to `FastifyPluginAsyncZod` so schemas are validated at compile time.
5. **Extract serializers** for leads, invoices, and sales-orders to match the `opportunities.ts` / `companies.ts` pattern, eliminating copy-pasted inline mapping.
6. **Add 4xx response schemas** to high-traffic routes (opportunities, contacts, tasks, leads) so Fastify serializes errors consistently.
7. **Split oversized route files** by moving helper functions (minting, CSV export, detail loaders) into `apps/api/src/services/` or `apps/api/src/lib/`.

---

_End of audit._
