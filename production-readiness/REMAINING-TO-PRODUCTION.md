# BidStack 360° — Remaining Work to Production-Ready

**Created:** 2026-06-29 · **Branch:** feat/prod-hardening-mantu
**Status:** code-complete + committed & green (typecheck/lint/build + DB-free unit suites). The items below
are everything left between here and a real customer launch. They are **NOT code defects** — they need DB,
cloud, or human decisions that cannot be done from a repo session.

Companion analysis: `GAP_AUDIT_2026-06-28.md` (the verified gap-of-record). This file is the **execution
checklist** — work it top to bottom.

Owner legend: **OPS** = run a script against staging/prod · **CLOUD** = cloud console / IaC apply ·
**DECISION** = a human call (Tony + security) · **ENG** = in-repo code (small remainders).

---

## 🔴 BLOCKERS — must close before ANY production launch

### B1 · PII-at-rest backfill on the live DB — OPS

The encryption code, hash columns, middleware, and tests are committed and green. Production env **forces
`PII_FIELD_ENCRYPTION=true`**, so existing rows MUST be backfilled before the flag is live or find-by-email
silently misses pre-existing Contact/Lead/KamConsultant rows.

- [ ] Provision `PII_ENCRYPTION_MASTER_KEY` (64-char hex) in the release secret store.
- [ ] With the flag **still false**: `tsx scripts/encrypt-existing-pii.ts --dry-run` → review counts.
- [ ] `tsx scripts/encrypt-existing-pii.ts --apply` → capture before/after row stats.
- [ ] Flip `PII_FIELD_ENCRYPTION=true`.
- [ ] Provide `BIDSTACK_STORAGE_ENCRYPTION_AT_REST=true`, storage evidence/provider refs, `BIDSTACK_USER_EMAIL_AT_REST_DECISION=storage-encryption-only` with owner/reference, and `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION=storage-encryption-only` with owner/reference plus exact accepted-field scope.
- [ ] `pnpm deploy:evidence:pii` → preserve `deploy-evidence/pii-ciphertext-latest.json`.
- **Acceptance:** raw-DB ciphertext-count artifact from the release DB (not `--selftest`); a find-by-email
  smoke returns the backfilled row.

### B2 · Production backup proven (offsite / encrypted / immutable + PITR) — CLOUD

Only a local `pg_dump→pg_restore` drill exists. `BACKUP_S3_BUCKET` / `BACKUP_ENCRYPT_KEY` are dead config;
the Azure bicep is a never-run draft.

- [ ] Enable managed-Postgres automated backups + PITR (retention ≥ 35d, geo-redundant, immutable).
- [ ] Record retention / region / encryption-at-rest evidence in `BACKUP_RESTORE_REPORT.md`.
- **Acceptance:** a real backup exists, is offsite + encrypted + immutable, and its existence is evidenced.

---

## 🟠 HIGH — required for a real customer launch (a closed pilot can defer)

### H1 · Webhook signing-secret backfill (only if legacy `whsec_` rows exist) — OPS

- [ ] `pnpm webhooks:encrypt-secrets` (dry-run) → `tsx scripts/encrypt-webhook-secrets.ts --apply`.
- [ ] `pnpm deploy:evidence:webhooks` → commit the artifact.
- **Acceptance:** zero plaintext/unreadable `WebhookSubscription.secret` rows in the release DB.

### H2 · Live infra / IAM / network / TLS review (Gate 6) — CLOUD

- [ ] IAM least-privilege, no long-lived broad keys, service-account separation, access review.
- [ ] No public DB/admin; security groups/firewall; private subnets; restricted SSH/RDP.
- [ ] DNS/TLS: cert validity + renewal, HTTPS+HSTS enforced live, secure redirects.
- [ ] Object storage (RFP/proposal docs): block public access; versioning + object-lock + SSE + replication.
- [ ] Confirm Postgres storage-level (TDE/volume) encryption + encrypted backups (covers names, KamSession
      transcripts, SMS bodies — fields outside field-level encryption).

### H3 · Backup RESTORE drill + RTO/RPO — OPS (staging)

- [ ] Restore the B2 backup into staging → boot the app → smoke the core flows.
- [ ] Measure RTO/RPO; ratify against the customer SLA; update `DISASTER_RECOVERY_PLAN.md` (drop the
      "UNVERIFIED" markers).
- **Acceptance:** a dated restore-drill record with measured numbers.

### H4 · Load / stress / soak run (Gate 10) — OPS (staging)

- [ ] Set SLOs (p95 latency, error rate, throughput) — needs a target from the business.
- [ ] `pnpm load-test:certify` against staging at expected traffic; archive the k6 artifact.
- **Acceptance:** a load run at expected concurrency meeting the SLOs.

### H5 · Live API / MCP connectivity evidence (Gate 4) — OPS

- [ ] `pnpm deploy:evidence:api` against the deployed API URL (+ key/bearer).
- [ ] `pnpm deploy:evidence:mcp` against the deployed MCP URL (+ `mcp`-scope bearer).
- **Acceptance:** live `/livez`, `/readyz`, `/health`, `/api/me/capabilities`, no-match `GET /api/companies`
  domain read, and MCP `initialize` + `tools/list` + read-only `tools/call` artifacts.

### H6 · Gated CD + built-image OS-CVE scan + SBOM — OPS / ENG

- [ ] Promote `deploy.workflow.yml.draft` to an active gated `environment: production` CD with required
      reviewers; fix the latent gate-name bug + the vacuous CI-green guard first.
- [ ] Wire `pnpm deploy:evidence:container` (trivy on the built image) into the CD path.
- [ ] Emit a CycloneDX SBOM per immutable image.
- **Acceptance:** no deploy to prod without a green gate + an image scan + an SBOM artifact.

### H7 · Runtime observability validation (Gate 11) — OPS

- [ ] Trigger a test Sentry API + worker error with `pnpm deploy:evidence:sentry:trigger`; preserve the
      strict artifact proving release/environment/project-scoped issue queries and confirm the alert pages.
- [ ] Add app-level alerts (5xx rate, p95 latency, availability, queue depth) — IaC currently only alerts on
      `pgStorage` / `redisMem`.
- [ ] Confirm Redis is live, monitored, non-loopback, and shared across API replicas/workers for rate limits,
      queues, outbound caps, OAuth locks, and cache invalidation.
- [ ] Confirm log redaction live (no PII in shipped logs).

### H8 · CI 10×-green on isolated infra (Gate 9) — OPS

- [ ] Now that CI runs on `demo` + pgvector, prove the full suite green 10× consecutively on CI Postgres.

---

## 🟡 ENGINEER remainders (in-repo, small/medium — safe to pick up)

> A second actor is concurrently building the **tenant-scope-guard** ORM backstop
> (`BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce`). Coordinate before touching `packages/db/src/index.ts`,
> `.env.example`, or the tenant middleware.

- [ ] **E1 · Extend PII_MAP to the 4 remaining plaintext-PII models** (`SmsMessage` body/numbers,
      `SmsConsent.phoneNumber`, `ActivityAttendee.email`, `CalendarEvent.attendees`). Each needs a schema
      decision (encrypt + hash column, or formally accept as plaintext + storage-encryption-only). **DECISION
      first, then ENG + migration.** 2026-06-29 update: strict `deploy:evidence:pii` now fails closed unless
      `BIDSTACK_PLAINTEXT_PII_AT_REST_*` carries a reviewable storage-only owner/reference and exact field
      scope covering these fields.
- [ ] **E2 · KamSession.transcriptText / attendees** — free-text PII, intentionally plaintext (it's the AI
      input). Needs an explicit privacy sign-off, not code. **DECISION.** 2026-06-29 update: the same strict
      plaintext-PII evidence scope now covers `KamSession.transcriptText` and `KamSession.attendees`.
- [x] **E3 · CSP de-duplication** fixed 2026-06-29: Helmet CSP is disabled in `server.ts`,
      `securityHeadersPlugin` owns `buildContentSecurityPolicy`, the provider `connect-src` allowlist lives
      in that builder, and the duplicate server-level `Permissions-Policy` hook was removed. Focused
      Fastify test proves the effective response header equals the shared builder. Live deployed header
      smoke evidence still belongs in the infra release gate.
- [x] **E4 · `.env.example` completeness** fixed 2026-06-29: `.env.example`
      now documents `OPENAPI_DOCS_ENABLED`, `RATE_LIMIT_REDIS_REQUIRED`, `QUERY_GUARD_REJECT`,
      `BIDSTACK_TENANT_SCOPE_GUARD`, `BACKUP_S3_BUCKET`, and `BACKUP_ENCRYPT_KEY` with
      production-facing operator guidance. This closes the env-contract documentation gap; live
      backup/restore and deployed config evidence remain in B2/H3/H5/H7.
- [x] **E5 · dead `merge:*` scripts** removed (`scripts/merge/` no longer exists) — ✅ done `3a79c751`.
- [x] **E6 · Provider-call timeouts** fixed 2026-06-29: Gmail/Google, Microsoft Graph,
      Slack, Twilio, and OAuth token/profile fetches now use shared `fetchWithTimeout` bounds with
      provider-specific env knobs and typed `ProviderTimeoutError` serialization as HTTP 504.
      Focused unit tests prove pass-through, timeout abort, fallback parsing, and timeout detection.
      Staging still needs a provider-timeout drill or chaos proxy proof before release evidence is closed.
- [x] **E7 · Email/SMS volume + cost caps** fixed 2026-06-29: `/email/send` and `/sms/send`
      now reserve Redis-backed daily UTC user/org volume before provider egress; email counts total
      recipients, SMS counts messages plus estimated segment cost, Redis is fail-closed in production,
      and reservations roll back only if the provider did not accept the send. Staging still needs cap-limit
      proof with configured values and shared Redis across API replicas.
- [x] **E8 · Twilio inbound webhook idempotency** fixed 2026-06-29: inbound messages now use `MessageSid`
      as the retry key, duplicate `P2002` writes return cleanly without duplicate CRM activity, STOP remains
      `upsert`, the Twilio token FK is selected by the inbound `To` number, and webhook signature validation
      can use the concrete Twilio number instead of the first active token. Focused API service tests prove
      first delivery / duplicate retry / STOP / explicit-number signature behavior. Staging Twilio replay proof
      is still an ops evidence item, not an open code defect.
- [x] **E9 · OAuth refresh lock** fixed 2026-06-29: Gmail and Microsoft Graph access-token
      refreshes now run through a Redis-backed per-token single-flight lock, waiters poll for the
      freshly persisted token, owner-checked Lua release prevents deleting a newer lock, and production
      fails closed if Redis locking is required but unavailable. Staging still needs multi-replica
      concurrency proof with one provider refresh call and waiters reusing the saved token.
- [x] **E10 · Live-DB ciphertext integration test** fixed 2026-06-29: `packages/db`
      now loads the same root env convention as API tests, and
      `pii-field-encryption.integration.test.ts` imports the real `@bidstack/db`
      singleton with `PII_FIELD_ENCRYPTION=true`, writes a Contact, verifies raw
      `contacts.email`/`phone` ciphertext plus `email_hash` via `$queryRaw`, and
      proves normal Prisma reads decrypt back to plaintext. This closes the code
      regression gap; B1 release-DB backfill + live ciphertext artifact remain ops gates.

---

## ⚖️ DECISIONS only Tony (+ security) can make

- [ ] **D1 · `User.email` at rest** — current release gate accepts only documented
      `storage-encryption-only` with owner/reference evidence. If Tony/security chooses field encryption
      instead, add a `User.emailHash` migration + make every auth/assignment lookup hash-aware before release.
- [ ] **D2 · Tenant-isolation backstop ADR** — session-var Postgres RLS vs a Prisma `$extends` context guard.
      (The `tenant-scope-guard` warn/enforce middleware is an interim ORM-level catch, not RLS.)
- [ ] **D3 · Plaintext-at-rest sign-off** — formally accept (or schedule encryption for) the E1/E2 set.
      Strict release evidence now rejects missing, placeholder, incomplete, or unsupported plaintext-PII
      decision scope; operator/security still must supply the real approval values.
- [ ] **D4 · Targets** — SLOs (for H4), RTO/RPO (for H3), retention/compliance targets, expected launch load.
- [ ] **D5 · Non-admin crew runs** — crew run/cancel/retry are now gated to `agents:write` (admin-only). If
      non-admin members should run crews, add a dedicated `crews:write` permission (catalog + RBAC matrix +
      seed + RolesPage + migration). Default kept secure.
- [ ] **D6 · Legal/compliance sign-off** (Gate 13) — the evidence package is assembled; the attestation is a
      legal call.

---

## Definition of "production-ready"

Closed pilot: **B1 + B2** done. · Real customer launch: **B1, B2, H1–H8** + decisions **D1–D4**.
Everything in the ENGINEER-remainders + remaining DECISIONS hardens further but does not block a pilot.
