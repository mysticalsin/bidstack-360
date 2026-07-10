# BidStack 360° — Decisions Only Tony (+ Security) Can Make

**Created:** 2026-07-02 · **Branch:** feat/prod-hardening-mantu

Six decisions block a real customer launch (see `REMAINING-TO-PRODUCTION.md`, D1–D6). None of them
are code defects — the code already supports the safe default in every case. Each one below states
the question, what's shipped today, the options, and a recommendation. Approve or override each;
nothing here ships or changes until you say so.

---

## D1 — Is `User.email` at rest acceptable as storage-encryption-only, or does it need field-level encryption?

**Current state:** `Contact.email`, `Lead.email`, and `KamConsultant.email` are already
field-encrypted with a companion `emailHash` column for equality lookups (AES-256-GCM, deterministic
hash for search). `User.email` is deliberately **excluded** from that map — it's the login/assignment
identity field, and encrypting it means every auth lookup, owner-assignment dropdown, and audit-log
actor reference becomes hash-aware, which is a bigger blast radius than the CRM data fields.

**Options:**
1. **Storage-encryption-only** (the release gate's current default) — rely on the database's
   encryption-at-rest (TDE/volume encryption, confirmed live in H2) and accept `User.email` as
   plaintext inside the trust boundary of the running database. This is what most SaaS CRMs do for
   their own user table.
2. **Field-level encryption** — add `User.emailHash`, migrate every `where: { email }` auth/lookup
   call site to hash-aware queries, backfill existing rows. Meaningfully more work and a wider
   regression surface (auth is the one place you cannot afford a subtle bug) for a field that's
   already covered by storage-level encryption.

**Recommendation:** Option 1 (storage-encryption-only), *provided* H2's Postgres storage-encryption
confirmation actually lands. This matches the existing `BIDSTACK_USER_EMAIL_AT_REST_DECISION` gate
in `deploy:evidence:pii`, which already accepts this value — no code change needed either way, this
decision only sets which evidence value ships in production config.

**Unblocks:** the `BIDSTACK_USER_EMAIL_AT_REST_DECISION` value in the B1 release-evidence gate.

---

## D2 — Long-term tenant isolation: Postgres RLS, or keep the ORM-level guard?

**Current state:** `tenant-scope-guard` (Prisma middleware) is live with a two-tier model —
`findMany`/`count`/`aggregate`/`groupBy`/`updateMany`/`deleteMany` throw in `enforce` mode if a query
isn't `orgId`-scoped; `findUnique`/`update`/`delete`/`upsert` can't be enforced the same way (their
`where` is a unique key, not a filter) so they emit a `TenantScopeGuardReport` warning instead. This
is a real backstop, but it's app-layer — a raw SQL query or a future ORM bypass isn't covered.

**Options:**
1. **Postgres Row-Level Security** — the database itself refuses to return rows outside the session's
   org context. Strongest guarantee (survives ORM bugs, raw SQL, admin tooling mistakes), but needs
   session-context wiring for every connection path: API requests, BullMQ workers, webhooks, and
   maintenance/migration scripts each need to set the RLS session variable correctly, which is real
   design work (connection pooling via pgbouncer in production makes this harder, not easier).
2. **Keep the ORM-level guard as the permanent backstop** — cheaper to maintain, already shipped and
   tested, but a determined bypass (raw SQL, a new service that skips the middleware) isn't caught.

**Recommendation:** Run `BIDSTACK_TENANT_SCOPE_GUARD=warn` in staging for 1–2 weeks first (zero risk —
it only logs) and use the accumulated `TenantScopeGuardReport` data to answer the real question: how
many of the report-only-tier call sites are genuinely reachable with attacker-controlled input? If the
answer is "none, they're all internal fetch-then-mutate patterns," the ORM guard is probably sufficient
for launch with RLS as a post-launch hardening item. If the report surfaces a real reachable gap, that's
the concrete case for prioritizing RLS before launch instead of after.

**Unblocks:** whether H2's infra review needs to include RLS session-context design, and the roadmap
priority of the eventual migration.

---

## D3 — Sign off on the remaining plaintext-PII fields (or schedule their encryption)

**Current state:** 6 fields are still plaintext by design, not oversight: `SmsMessage` body/numbers,
`SmsConsent.phoneNumber`, `ActivityAttendee.email`, `CalendarEvent.attendees`, and
`KamSession.transcriptText`/`attendees`. The release-evidence gate (`deploy:evidence:pii`) already
fails closed unless `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION` names a real owner, reference, and exact
field scope — it will not accept a placeholder.

**Why these are plaintext today:** SMS bodies and KAM session transcripts are free-text content fed
to/from the AI layer (KAM transcript is literally the AI's input) — encrypting them means decrypting on
every AI call, which is a meaningfully different architecture (the field-encryption pattern here is
built for exact-match lookup, not for content the LLM needs to read). `ActivityAttendee.email` and
`CalendarEvent.attendees` are denormalized copies of data already encrypted at its source (Contact/Lead).

**Options:**
1. **Accept as storage-encryption-only** (same reasoning as D1) — these fields never need to be
   *searched* by value, only displayed/processed, so the case for field-level encryption is weaker
   than it was for Contact/Lead email.
2. **Encrypt anyway** — for `SmsMessage`/`SmsConsent`, this is plausible (they're structured, narrower
   blast radius than free text). For `KamSession.transcriptText`, encrypting means either decrypting on
   every AI call (defeats the purpose of at-rest encryption during active use) or accepting the AI
   pipeline only ever sees ciphertext (breaks the feature).

**Recommendation:** Accept storage-encryption-only for all 6, with the exception of `SmsConsent.phoneNumber`
— that one specifically is a compliance record (proof of opt-in/out), long-lived, rarely read, and
structurally identical to the Contact/Lead phone field pattern already built. If security wants one
concrete field hardened beyond storage-encryption, that's the cheapest, highest-value one to pick.

**Unblocks:** the `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION` value in the B1 release-evidence gate.

---

## D4 — SLO / RTO / RPO / retention targets

**Current state:** no numeric targets exist anywhere in the repo — H3 (backup restore drill) and H4
(load test) are both blocked on this because "pass" is undefined without a target.

**This one is genuinely a business call** (expected customer count, contractual SLAs if any, budget for
redundancy) that I have no basis to recommend from the repo. As a starting point to react to rather than
decide from scratch:

| Metric | Suggested starting target | Basis |
|---|---|---|
| API p95 latency | < 500ms | Standard SaaS CRM read-path expectation |
| API error rate | < 0.1% (5xx) | Standard availability bar |
| RTO (restore time) | < 4 hours | Reasonable for a single-region Postgres + Railway/Vercel stack |
| RPO (data loss window) | < 15 minutes | Matches typical managed-Postgres PITR granularity |
| Backup retention | 35 days | Matches the B2 checklist's stated retention floor |

**Action needed:** confirm or override each row, and add anything contractual (specific customer SLAs,
compliance-driven retention minimums) that isn't in this table.

**Unblocks:** H3's acceptance criteria and H4's load-test pass/fail thresholds.

---

## D5 — Should non-admin users be able to run/cancel/retry AI crews?

**Current state:** all three crew-mutation routes (`crews.ts:544,600,647`) are gated behind
`agents:write`, which only admin roles hold today. This is the secure default, not a gap — nothing is
broken by leaving it as-is.

**Options:**
1. **Keep admin-only** — simplest, no RBAC surface to maintain, matches "AI agent execution is a
   privileged action" as a starting posture.
2. **Add a dedicated `crews:write` permission** — lets specific non-admin roles (e.g., a KAM or bid
   lead) trigger crews without needing full admin rights. Requires: permission-catalog entry, RBAC
   matrix update, seed data, a `RolesPage` toggle, and a migration.

**Recommendation:** Keep admin-only until there's a concrete user story for who needs it and why (e.g.,
"KAM leads should be able to re-run the enrichment crew on their own accounts without opening an admin
ticket"). Adding a permission speculatively, before a real workflow needs it, is exactly the kind of
premature RBAC surface that's harder to remove than to add later.

**Unblocks:** nothing is blocked — this is "confirm the current secure default is intentional," not a
gate.

---

## D6 — Legal / compliance attestation

**Current state:** the evidence package (`production-readiness/EVIDENCE_INDEX.md` +
`deploy-evidence/*`) is assembled and the release gates that produce it are wired and tested. This
decision is not technical — it's whoever holds legal/compliance sign-off authority reviewing the
assembled evidence and attesting the platform meets your contractual/regulatory obligations (GDPR,
customer DPAs, etc.).

**Recommendation:** none to offer — this is the one item on this list that is purely a legal call, not
an engineering tradeoff. The only actionable thing from this session: the evidence package the
attestation would be based on is real and current as of this branch (verified via this session's full
gate run — see `PRODUCTION_READINESS_REPORT.md`).

---

## Summary — what I need back from you

- **D1, D3:** confirm the storage-encryption-only defaults (recommended above), or tell me which
  fields you want field-encrypted instead — I'll scope the migration.
- **D2:** approve running `BIDSTACK_TENANT_SCOPE_GUARD=warn` in staging for 1–2 weeks before deciding
  RLS vs. ORM-guard-permanent.
- **D4:** confirm/override the suggested SLO/RTO/RPO table, add anything contractual.
- **D5:** confirm admin-only crew access is intentional (no action needed unless you disagree).
- **D6:** hand to whoever owns legal/compliance sign-off — nothing blocking on the engineering side.
