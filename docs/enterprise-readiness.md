# Polo enterprise readiness (real accounts, revenue, signed MSAs)

**Baseline:** `main` @ `8143d882` (green required CI: unit, integration, Chromium smoke, gitleaks).
**Audience:** Mantu / Amaris group sales — a small colleague team, not a public SaaS.
**Default branch stays demo.** Real-data mode is opt-in (`POLO_DATA_MODE=real`).

This document is the gap list against loading **real** accounts, **real** revenue, and **real** signed MSAs/contracts. Priorities:

- **P0** — must be closed (in code or by an owner decision) before real data is loaded
- **P1** — should be closed soon; acceptable only with an explicit owner exception
- **P2** — hardening, evidence, or product polish

---

## What was already strong on `8143d882`

Polo is not a greenfield CRM. A lot of the enterprise bar already exists:

- Clerk JWT + JIT users, SSO domain allowlist, demo-mode boot guards, stub locked to loopback
- Org-scoped RBAC (`Role` / `Permission` / `UserRole`) with `msa:*`, `accounts:*`, `settings:*`, `audit-log:read`
- Company access scope on MSA library routes (out-of-scope → 404)
- `AuditLog` + mutation safety net + Settings → Audit log UI + export
- MSA library/intake: 25 MB, PDF/DOCX, magic-byte check, local extract, worker index **without** LLM
- `MSA_LLM_EXTRACT_ENABLED=false` by default; intake does not send contract text to a third party
- Fixture seed refused in `NODE_ENV=production`; `pnpm db:seed:prod` is seed-free
- `pnpm db:purge:demo` for seed/demo orgs
- CSV import wizard (upload → map → import) for companies/contacts/leads/opportunities
- Helmet + CSP plugin, rate limits, Pino redaction, Sentry `sendDefaultPii: false`
- `/livez` `/readyz` `/health`, gitleaks, dependency-review on HIGH/CRITICAL

The remaining P0 is **identity on the Access-gated preview** plus **operator-owned backups / real-tenant bootstrap**.

---

## Gap list

### (a) Authentication and identity

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| A1 | **P0** | **Fixed** | Preview visitors all share stub admin Jane Smith (`jane@mantu.com` UI / `jane.smith@mantu.com` DB). Cloudflare Access only gates the Worker. |
| A2 | **P0** | **Fixed** | Access JWT/email was stripped before the box API. Polo now maps `Cf-Access-Authenticated-User-Email` (loopback, Worker-verified) or a re-verified Access JWT to a per-user Polo user + system role. |
| A3 | **P0** | **Fixed** | No application allowlist. `POLO_ALLOWED_USERS=email:Role,…` is required when `CF_ACCESS_AUTH=true`. Unlisted emails get 403. |
| A4 | **P0** | **Fixed** | `POLO_DATA_MODE=real` refuses stub and demo. Default remains `demo`. |
| A5 | P1 | Open | SPA stub persona email (`jane@mantu.com`) still differs from the seed user in demo/stub. Harmless in demo; do not use stub for real data. |
| A6 | P2 | Open | No direct Entra OIDC adapter (Clerk remains the corporate IdP path if Access is not used). |

### (b) Per-role RBAC (accounts, MSAs, financials, settings)

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| B1 | — | Already shipped | Matrix + route `config.permission` + MSA company scope + financials track toggle (Admin/AE). |
| B2 | P1 | **Fixed** | New API keys default-deny company/MSA resources and are read-only. Creator must set org-wide or an explicit company/MSA allowlist. Existing keys were backfilled unrestricted + writable. |
| B3 | P1 | Open | Audit UI is gated by `settings:write`; Sales Manager has `audit-log:read` on the API but cannot open the Settings tab. |
| B4 | P2 | Open | Admin role is a single full-tenant key. Split “user admin” vs “billing admin” if the team grows. |

### (c) Audit log

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| C1 | — | Already shipped | MSA create/update/archive/download, intake confirm/reject, financials track toggle, role changes, import start/undo. |
| C2 | **P1** | **Fixed** | Generic file downloads now write `file.download`. |
| C3 | P1 | Open | Search/list diffs can include query prefixes; export returns actor emails to `audit-log:read` holders. |
| C4 | P2 | Open | Viewing filed financials is not audited (mutations are). |

### (d) Uploaded contract files

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| D1 | — | Already shipped | MSA: 25 MB, PDF/DOCX, magic bytes, org-prefixed keys, short-lived download tokens. Account files: 50 MB allow-list. |
| D2 | **P0** | **Fixed** | Account-file auto-extract (LLM/Dust) is **blocked in real mode** unless `DOCUMENT_LLM_EXTRACT_ENABLED=true`. MSA library extract stays local. |
| D3 | P1 | Open | `STORAGE_SCAN_REQUIRED` still defaults false. Turn on before treating uploads as malware-safe. |
| D4 | P1 | Owner | Encryption at rest: application does not envelope-encrypt blobs. Use S3/R2 SSE (or disk encryption) plus `INTEGRATION_TOKEN_KEY` / `PII_ENCRYPTION_MASTER_KEY` for secrets/PII fields. Local disk is ephemeral. |
| D5 | P2 | Open | `text/html` remains allowed on account files; local download forces attachment + nosniff + sandbox CSP. |

### (e) Data integrity

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| E1 | **P0** | **Fixed** | Fixture seed now also refuses `POLO_DATA_MODE=real`. Real tenant = `pnpm db:migrate:deploy` + `pnpm db:seed:prod -- --clerk-org <id> --name "…"`. |
| E2 | — | Already shipped | `pnpm db:purge:demo` removes seed/demo/test orgs. |
| E3 | **P1** | **Fixed** | Import now has server-side preview (money / currency / ISO dates / required fields), XLSX parse, and a **financials** entity writing `AccountFinancialPeriod` (`source=manual_import`). Confirm still required before write. |
| E4 | P1 | Open | Opportunity money on the API wire still uses JS `Number` units (precision risk above ~$9M). Storage remains micros. |
| E5 | P2 | Open | No per-row “this is demo” marker inside a mixed org. Do not mix. |

### (f) Backups and restore

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| F1 | **P0** | **Fixed (scripted)** | `pnpm db:backup` → `pg_dump -Fc` with retention. `pnpm db:restore` requires an explicit `POLO_RESTORE_DATABASE_URL`. `pnpm db:backup:selftest` dumps/restores a synthetic DB and checks row counts. |
| F2 | **P0** | **Owner** | Choose the backup destination (`POLO_BACKUP_DIR` or a managed snapshot) and a restore drill on the **real** volume. Repo scripts do not ship offsite storage. |
| F3 | P1 | Open | PITR / WAL, backup-failure alerting, object-storage recovery. |

### (g) Secrets

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| G1 | — | Already shipped | Server secrets via env; Vite only inlines `VITE_*` publishable values. gitleaks in CI. |
| G2 | — | Already shipped | MSA LLM off by default; intake does not egress contract text. |
| G3 | P0 | Owner | Generate and store `INTEGRATION_TOKEN_KEY`, `PII_ENCRYPTION_MASTER_KEY`, `BIDSTACK_JOB_SIGNING_SECRET` **before** real data. Rotating them orphans ciphertext. |
| G4 | P1 | Open | `pnpm audit --audit-level high` is non-blocking in unit CI. |

### (h) Errors, rate limits, CSP, vulns

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| H1 | — | Already shipped | Central error handler (5xx generic), Helmet + CSP plugin, Front Door guard, dependency-review. |
| H2 | **P1** | **Fixed** | Rate limiter **fail-closed** when `POLO_DATA_MODE=real` (`skipOnError: false`). Demo still fail-open. |
| H3 | P2 | Open | Supply-chain / Trivy / Checkov remain advisory. |

### (i) Observability

| ID | Pri | Status | Gap |
|----|-----|--------|-----|
| I1 | — | Already shipped | `/livez` `/readyz` `/health`, Pino redaction, Sentry scrubbers, optional OTEL. |
| I2 | P1 | Open | Alert on `/readyz`, not `/health` (health stays 200 when deps fail, by design). |
| I3 | P2 | Open | Web Sentry replay is a legal/privacy decision (`VITE_SENTRY_REPLAY`). |

---

## What this change set implements

1. **Cloudflare Access → Polo user.** Allowlisted email JIT-provisions a user and system role. Shared Jane Smith is impossible in real mode.
2. **Settings → Identity & roles.** Shows the signed-in email/role, the env allowlist, and the existing team/RBAC manager.
3. **Demo banner** on every chrome page while `POLO_DATA_MODE=demo`.
4. **Import preview + XLSX + financials.**
5. **File download audit** and real-mode LLM extract gate.
6. **Scripted pg_dump / restore / selftest.**
7. Worker still forwards only the **verified email**, not the Access JWT (JWT stays off the box).

v24 cockpit, MARS sync, and MSA intake (HEMA leverage flags) are unchanged.

---

## Owner decisions before loading real data

1. **Allowed users and roles** — set `POLO_ALLOWED_USERS` (and keep Cloudflare Access `ALLOWED_EMAILS` in sync). Example: `tony@mantu.com:Admin,colleague@amaris.com:Account Executive`.
2. **Auth path** — Cloudflare Access (`CF_ACCESS_AUTH=true`, `VITE_AUTH_MODE=cf-access`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`) **or** Clerk. Not both. Not stub.
3. **Empty real org id** — `POLO_REAL_ORG_CLERK` (default `org_polo_real`) and `pnpm db:seed:prod -- --clerk-org … --name "Mantu Sales"`.
4. **Backup destination** — `POLO_BACKUP_DIR` or a managed Postgres snapshot. Run `pnpm db:backup:selftest` once, then a real restore drill.
5. **Encryption keys** — 64-hex `INTEGRATION_TOKEN_KEY` and `PII_ENCRYPTION_MASTER_KEY`; `PII_FIELD_ENCRYPTION=true`; S3/R2 SSE for contract blobs (`STORAGE_DRIVER=s3`).
6. **LLM** — leave `MSA_LLM_EXTRACT_ENABLED=false` and `DOCUMENT_LLM_EXTRACT_ENABLED=false` unless legal has approved sending MSA/account-file text to a third party.
7. **Redeploy the preview Worker** so it injects `Cf-Access-Authenticated-User-Email`. This repo does not deploy to Cloudflare.

Do **not** run `pnpm db:seed`, `pnpm db:reset`, or `prisma migrate dev` against the real database.
