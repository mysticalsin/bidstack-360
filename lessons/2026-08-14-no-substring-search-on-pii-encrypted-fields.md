---
title: Never substring-search a PII-encrypted column — it 500s via the encryption middleware
date: 2026-08-14
project: BidStack 360° (D:\BIDCRM)
tags: [lessons, security, search, prisma, pii]
---

## Lesson — `contains` on an encrypted field is a guaranteed 500, not a slow query

**Rule (NEVER):** Never put an encrypted-at-rest column (`Contact.email`,
`Lead.email`, `KamConsultant.email`, and their `phone`) inside a Prisma
`{ contains }` / substring filter. The `pii-encryption` middleware
(`packages/db/src/middleware/pii-encryption.ts`) rewrites email/phone lookups to
the `emailHash` index and **throws** on any operator except equality/`in`:
`[pii-encryption] Unsupported lead.email encrypted lookup operator(s): contains`.
An unhandled throw in a route handler is a 500. Search plaintext columns
(name, company, role) instead; the encrypted value can still be shown/ranked on
the returned rows.

**What happened:** The global search page (`/search`) and the header search box
returned "Search failed / Something went wrong" for every query. `GET
/api/v1/search` 500'd because `apps/api/src/routes/search.ts` built
`email: { contains }` clauses for the lead and contact sub-queries. The same bug
class also lived in the `/contacts` (`contacts.ts:59`) and `/leads`
(`leads.read.routes.ts:37`) list-search boxes — they would 500 the instant a
user typed. The Ctrl+K command palette was unaffected (it merges other result
sources and degraded past the failing one).

**Root cause:** email/phone are encrypted at rest with an `emailHash` equality
index; substring search over ciphertext is impossible by design, and the
middleware fails closed rather than silently returning nothing.

**How to apply:**
1. Grep before shipping any search/filter: `(email|phone)\s*:\s*\{\s*contains`
   over `apps/api/src` must return nothing. Dynamic builders (e.g.
   `tokenAndClauses(tokens, [...fields])`) must not include email/phone in their
   field list.
2. To match an encrypted field, use equality on the full value (the middleware
   routes it through `emailHash`) — never a substring.
3. Route handlers that call Prisma with user-controlled filters must not let a
   middleware throw escape as a 500 — validate the filter shape or catch.
