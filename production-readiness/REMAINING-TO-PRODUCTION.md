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

### B1 · PII-at-rest backfill on the live DB  — OPS
The encryption code, hash columns, middleware, and tests are committed and green. Production env **forces
`PII_FIELD_ENCRYPTION=true`**, so existing rows MUST be backfilled before the flag is live or find-by-email
silently misses pre-existing Contact/Lead/KamConsultant rows.
- [ ] Provision `PII_ENCRYPTION_MASTER_KEY` (64-char hex) in the release secret store.
- [ ] With the flag **still false**: `tsx scripts/encrypt-existing-pii.ts --dry-run` → review counts.
- [ ] `tsx scripts/encrypt-existing-pii.ts --apply` → capture before/after row stats.
- [ ] Flip `PII_FIELD_ENCRYPTION=true`.
- [ ] `pnpm deploy:evidence:pii` → commit `deploy-evidence/pii-ciphertext-latest.json`.
- **Acceptance:** raw-DB ciphertext-count artifact from the release DB (not `--selftest`); a find-by-email
  smoke returns the backfilled row.

### B2 · Production backup proven (offsite / encrypted / immutable + PITR)  — CLOUD
Only a local `pg_dump→pg_restore` drill exists. `BACKUP_S3_BUCKET` / `BACKUP_ENCRYPT_KEY` are dead config;
the Azure bicep is a never-run draft.
- [ ] Enable managed-Postgres automated backups + PITR (retention ≥ 35d, geo-redundant, immutable).
- [ ] Record retention / region / encryption-at-rest evidence in `BACKUP_RESTORE_REPORT.md`.
- **Acceptance:** a real backup exists, is offsite + encrypted + immutable, and its existence is evidenced.

---

## 🟠 HIGH — required for a real customer launch (a closed pilot can defer)

### H1 · Webhook signing-secret backfill (only if legacy `whsec_` rows exist)  — OPS
- [ ] `pnpm webhooks:encrypt-secrets` (dry-run) → `tsx scripts/encrypt-webhook-secrets.ts --apply`.
- [ ] `pnpm deploy:evidence:webhooks` → commit the artifact.
- **Acceptance:** zero plaintext/unreadable `WebhookSubscription.secret` rows in the release DB.

### H2 · Live infra / IAM / network / TLS review (Gate 6)  — CLOUD
- [ ] IAM least-privilege, no long-lived broad keys, service-account separation, access review.
- [ ] No public DB/admin; security groups/firewall; private subnets; restricted SSH/RDP.
- [ ] DNS/TLS: cert validity + renewal, HTTPS+HSTS enforced live, secure redirects.
- [ ] Object storage (RFP/proposal docs): block public access; versioning + object-lock + SSE + replication.
- [ ] Confirm Postgres storage-level (TDE/volume) encryption + encrypted backups (covers names, KamSession
      transcripts, SMS bodies — fields outside field-level encryption).

### H3 · Backup RESTORE drill + RTO/RPO  — OPS (staging)
- [ ] Restore the B2 backup into staging → boot the app → smoke the core flows.
- [ ] Measure RTO/RPO; ratify against the customer SLA; update `DISASTER_RECOVERY_PLAN.md` (drop the
      "UNVERIFIED" markers).
- **Acceptance:** a dated restore-drill record with measured numbers.

### H4 · Load / stress / soak run (Gate 10)  — OPS (staging)
- [ ] Set SLOs (p95 latency, error rate, throughput) — needs a target from the business.
- [ ] `pnpm load-test:certify` against staging at expected traffic; archive the k6 artifact.
- **Acceptance:** a load run at expected concurrency meeting the SLOs.

### H5 · Live API / MCP connectivity evidence (Gate 4)  — OPS
- [ ] `pnpm deploy:evidence:api` against the deployed API URL (+ key/bearer).
- [ ] `pnpm deploy:evidence:mcp` against the deployed MCP URL (+ `mcp`-scope bearer).
- **Acceptance:** live `/livez`, `/readyz`, `/health`, `/api/me/capabilities`, and MCP `initialize` +
      `tools/list` artifacts.

### H6 · Gated CD + built-image OS-CVE scan + SBOM  — OPS / ENG
- [ ] Promote `deploy.workflow.yml.draft` to an active gated `environment: production` CD with required
      reviewers; fix the latent gate-name bug + the vacuous CI-green guard first.
- [ ] Wire `pnpm deploy:evidence:container` (trivy on the built image) into the CD path.
- [ ] Emit a CycloneDX SBOM per immutable image.
- **Acceptance:** no deploy to prod without a green gate + an image scan + an SBOM artifact.

### H7 · Runtime observability validation (Gate 11)  — OPS
- [ ] Trigger a test Sentry error + a test alert; confirm it pages.
- [ ] Add app-level alerts (5xx rate, p95 latency, availability, queue depth) — IaC currently only alerts on
      `pgStorage` / `redisMem`.
- [ ] Confirm log redaction live (no PII in shipped logs).

### H8 · CI 10×-green on isolated infra (Gate 9)  — OPS
- [ ] Now that CI runs on `demo` + pgvector, prove the full suite green 10× consecutively on CI Postgres.

---

## 🟡 ENGINEER remainders (in-repo, small/medium — safe to pick up)

> A second actor is concurrently building the **tenant-scope-guard** ORM backstop
> (`BIDSTACK_TENANT_SCOPE_GUARD=warn|enforce`). Coordinate before touching `packages/db/src/index.ts`,
> `.env.example`, or the tenant middleware.

- [ ] **E1 · Extend PII_MAP to the 4 remaining plaintext-PII models** (`SmsMessage` body/numbers,
      `SmsConsent.phoneNumber`, `ActivityAttendee.email`, `CalendarEvent.attendees`). Each needs a schema
      decision (encrypt + hash column, or formally accept as plaintext + storage-encryption-only). **DECISION
      first, then ENG + migration.**
- [ ] **E2 · KamSession.transcriptText / attendees** — free-text PII, intentionally plaintext (it's the AI
      input). Needs an explicit privacy sign-off, not code. **DECISION.**
- [ ] **E3 · CSP de-duplication** — `server.ts` helmet CSP vs `security-headers.ts` onSend CSP diverge; the
      helmet one is effectively dead. Collapse to one source of truth. **ENG (server.ts).**
- [ ] **E4 · `.env.example` completeness** — document `OPENAPI_DOCS_ENABLED`, `RATE_LIMIT_REDIS_REQUIRED`,
      `QUERY_GUARD_REJECT`, `BIDSTACK_TENANT_SCOPE_GUARD`, `BACKUP_S3_BUCKET`, `BACKUP_ENCRYPT_KEY`.
      (Coordinate — `.env.example` is being edited concurrently.) **ENG.**
- [ ] **E5 · `merge:rollback`** package.json script points to a non-existent file — fix or remove. **ENG.**
- [ ] **E6 · Provider-call timeouts** — add `AbortController`/timeouts to inline Gmail/Graph/Twilio/Slack/OAuth
      fetches (bounded only by undici's 300s today). **ENG.**
- [ ] **E7 · Email/SMS volume + cost caps** on `/email/send` + `/sms/send`. **ENG.**
- [ ] **E8 · Twilio inbound webhook** uses `create` not `upsert` → a retry storms 500s. Make idempotent. **ENG.**
- [ ] **E9 · OAuth refresh lock** — concurrent refreshes race; add a per-connection lock. **ENG.**
- [ ] **E10 · Live-DB ciphertext integration test** — assert via `$queryRaw` that a disabled PII middleware
      fails CI (so encryption can't silently regress). **ENG (runs in CI with DB).**

---

## ⚖️ DECISIONS only Tony (+ security) can make

- [ ] **D1 · `User.email` at rest** — accept storage-level-only (document it) **OR** add a `User.emailHash`
      migration + make every auth/assignment lookup hash-aware. Until decided, `User.email` is plaintext at
      the field level.
- [ ] **D2 · Tenant-isolation backstop ADR** — session-var Postgres RLS vs a Prisma `$extends` context guard.
      (The `tenant-scope-guard` warn/enforce middleware is an interim ORM-level catch, not RLS.)
- [ ] **D3 · Plaintext-at-rest sign-off** — formally accept (or schedule encryption for) the E1/E2 set.
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
