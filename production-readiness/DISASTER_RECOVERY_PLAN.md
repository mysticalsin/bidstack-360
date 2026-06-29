# BidStack 360° — Disaster Recovery Plan

**Status:** DRAFT — operationally UNVERIFIED. No restore, rollback, or failover
drill has ever been run against this system (see Release Gate 12 = **FAIL** in
`production-readiness/RELEASE_GATE_MATRIX.md`). Every procedure below is written
from the repo's real topology but **must be rehearsed in staging before it is
trusted**. Lines marked **[UNVERIFIED — REQUIRES INFRA ACCESS]** depend on cloud
credentials/console access this document's author did not have.

**Last grounded:** 2026-06-28, branch `feat/prod-hardening-mantu`.
**Owner:** Tony (Platform). **Sign-off required before first prod deploy.**

---

## 0. Read this first — which substrate are you on?

BidStack has **three** deployment substrates in the repo. The DR procedure
differs by substrate, so identify yours before acting:

| Substrate                 | Defined by                                            | DB / Redis                                                                                                    | Status                                                                                       |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Docker Compose (prod)** | `docker-compose.prod.yml`                             | `pgvector/pgvector:pg16` + `redis:7-alpine`, both as containers; Postgres on the `postgres_data` named volume | Validated, works-today (per `infra/azure/README.md`)                                         |
| **Azure Container Apps**  | `infra/azure/main.bicep` + `docs/AZURE_FOUNDATION.md` | Azure Database for PostgreSQL Flexible Server 16 + Azure Cache for Redis Premium                              | **UNVALIDATED DRAFT** — never run through `az bicep build` / `what-if` / a real subscription |
| **Railway (demo)**        | `apps/api/Dockerfile`                                 | Railway-managed Postgres; migrate-on-boot (`CMD … migrate:deploy && node dist/main.js`)                       | Demo only, not the DR target                                                                 |

The **intended production target is Azure** (`docs/AZURE_FOUNDATION.md`), but its
IaC is an unvalidated draft. Until the Azure bicep is validated, the **only
substrate with a credible recovery story is Docker Compose** plus whatever
managed Postgres/Redis/object-store you actually point it at.

---

## 1. Data stores to recover

There are **four** stateful surfaces. Code/app artifacts are stateless and
rebuilt from the git SHA via `Dockerfile` (targets `api | web | worker |
mcp-server | migrate`) → ACR/registry; they are **not** part of DR beyond
"redeploy the last-good image tag."

### 1.1 PostgreSQL 16 — system of record (CRITICAL, RPO-driving)

- **What:** all tenant data. Multi-tenant, every row `orgId`-scoped (manual
  per-query — no RLS backstop). Money in micros. 81 Prisma migrations
  (`packages/db/prisma/migrations/`).
- **Extensions required before migrations apply:** `vector` (pgvector — RFP
  embeddings `vector(1024)` + HNSW indexes), `pgcrypto`, `pg_trgm`, `citext`
  (schema `datasource.extensions` + `azure.extensions` allow-list). **A stock
  `postgres:16` image will fail `migrate deploy`** — you must restore onto
  pgvector / an extension-allow-listed Flexible Server.
- **Substrate specifics:**
  - Compose: data lives in the `postgres_data` Docker volume. Back up with
    `pg_dump`; the volume itself is **not** automatically snapshotted.
  - Azure (draft): Flexible Server with `backup: { backupRetentionDays: 35,
geoRedundantBackup: 'Enabled' }`, HA `ZoneRedundant`, `publicNetworkAccess:
Disabled`, built-in PgBouncer on `:6432`. **PITR ≤ 35 days + geo-restore to
    the paired region** are the primary recovery levers. **[UNVERIFIED — REQUIRES
    INFRA ACCESS]**
- **Connection nuance that matters for recovery:** app services connect through
  **PgBouncer (`:6432`, transaction pooling)**; the **migrate job uses a direct
  non-pooled `:5432` connection** (`databaseUrlDirect` in the bicep) because
  Prisma DDL cannot run over transaction pooling. Any emergency `migrate
deploy` / `migrate resolve` / manual DDL **must use the direct `:5432` URL.**

### 1.2 Redis 7 — queues, rate-limit store, cache (mostly reconstructible)

- **What:** BullMQ queues (email/calendar sync, calls, 9-stage RFP pipeline,
  webhook-delivery, tenant-export, predictive-retrain, workflow-dispatch,
  enrichment), `@fastify/rate-limit` store, idempotency TTL store, app cache.
- **Recoverability:** cache + rate-limit + idempotency state are
  **reconstructible** — losing them costs a cold cache and a brief window where
  idempotency keys reset. **In-flight and queued BullMQ jobs are the only real
  loss.** Most producers are re-drivable (e.g. re-trigger a sync, re-upload an
  RFP), but treat "lost queued jobs" as an explicit, accepted RPO line item.
- **Substrate specifics:**
  - Compose: `redis:7-alpine`, password-required, **no persistence configured**
    → a container loss empties Redis.
  - Azure (draft): Redis **Premium**, `maxmemory-policy=noeviction`, **AOF
    persistence** (`aof-backup-enabled`), zone-redundant, private endpoint. AOF
    is what gives queued jobs a chance of surviving a node loss.
    **[UNVERIFIED — REQUIRES INFRA ACCESS; AOF needs a backing storage account
    per the bicep `// VALIDATE` note]**

### 1.3 Object storage — uploaded documents (CRITICAL, not provisioned by IaC)

- **What:** RFP source documents, file attachments, proposal source files —
  anything written through the S3 storage driver (`STORAGE_DRIVER=s3`,
  `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`,
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`).
- **CRITICAL GAP:** the Azure bicep **does not provision object storage** — it
  only accepts the S3 credentials as parameters and stores them in Key Vault
  (`s3-access-key-id`, etc.). The bucket is an **external S3-compatible
  service**. Therefore its versioning, cross-region replication, retention,
  immutability/object-lock, and encryption are **entirely outside this repo and
  UNVERIFIED.** `docs/AZURE_FOUNDATION.md` flags that no native Azure Blob
  adapter exists yet.
- **Consequence:** DB rows reference object keys. If the bucket is lost but the
  DB survives, documents 404 even though metadata is intact (and vice-versa).
  **DB and object-store backups must be kept time-consistent** (see §3.1).

### 1.4 Secrets, KMS, and app-level crypto keys (loss = permanent data loss)

- **Vault:** Azure Key Vault — purge protection, soft-delete, RBAC,
  `publicNetworkAccess: Disabled`, private endpoint. Holds `DATABASE_URL`(s),
  `database-url-direct`, `REDIS_URL`, `INTEGRATION_TOKEN_KEY`,
  `CLERK_SECRET_KEY`, `clerk-publishable-key`, `s3-access-key-id`/secret,
  `BIDSTACK_JOB_SIGNING_SECRET`, `SENTRY_DSN`. **[UNVERIFIED — REQUIRES INFRA
  ACCESS]**
- **App-level crypto keys that gate data, not just access:**
  - **`INTEGRATION_TOKEN_KEY`** (64-char hex, AES-256-GCM) encrypts every stored
    OAuth access/refresh token in `integration_tokens`
    (`packages/shared/src/crypto/token-cipher.ts`). **Lose this key and every
    stored OAuth grant is unrecoverable** — recovery = every user re-authorises
    every integration. There is no escrow.
  - **`PII_ENCRYPTION_MASTER_KEY`** (optional; `PII_FIELD_ENCRYPTION`, default
    OFF). If PII-at-rest is enabled in prod, losing this key bricks
    Contact/Lead/User/KamConsultant email+phone columns.
  - **`JWT_SIGNING_*`, `VAPID_*`, `STRIPE_WEBHOOK_SECRET`** — rotatable; loss
    forces re-issue / re-subscribe, not data loss. See
    `scripts/ops/rotate-secrets.sh`.
- **DR implication:** these keys must be backed up **independently of the
  database** (a DB restore is worthless if the key that decrypts its OAuth
  tokens is gone). Key Vault purge-protection + soft-delete is the first line;
  an offline, access-controlled copy of `INTEGRATION_TOKEN_KEY` /
  `PII_ENCRYPTION_MASTER_KEY` is the break-glass line. **[REQUIRES A HUMAN
  DECISION on escrow location.]**

---

## 2. RTO / RPO targets

> **TO-BE-SET BY TONY.** The values below are **recommended starting targets**
> with rationale, not commitments. They cannot be ratified until a real restore
> drill measures actual timings (§7). Set the customer-facing SLA _after_ the
> first measured drill, never before.

| Store                             | Recommended **RPO** (max data loss)                 | Recommended **RTO** (time to restore)                             | WHY this starting point                                                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL**                    | **≤ 5 min**                                         | **≤ 1 h** (in-region PITR) · **≤ 4 h** (geo-restore, region loss) | Flexible Server PITR is continuous (WAL), so near-zero loss is achievable in-region for free. Geo-restore provisions a brand-new server from geo-redundant backup — inherently slow (hours), so it dominates the region-loss RTO. |
| **Object storage**                | **≤ 24 h** (until versioning/replication is proven) | **≤ 4 h**                                                         | No backup posture is verified (§1.3). Until the external bucket's versioning + cross-region replication are confirmed, you cannot honestly promise better than "yesterday's documents." Tighten once verified.                    |
| **Redis**                         | **Best-effort / accept in-flight job loss**         | **≤ 30 min**                                                      | Cache/rate-limit/idempotency are reconstructible; only queued jobs are at risk, and most are re-drivable. A fresh Redis + worker redeploy is fast.                                                                                |
| **Secrets / keys**                | **0** (no acceptable loss)                          | **≤ 15 min** (Key Vault soft-delete recovery)                     | Losing `INTEGRATION_TOKEN_KEY` is permanent (§1.4). Treat key RPO as zero and rely on purge-protection + offline escrow.                                                                                                          |
| **App tier (api/web/worker/mcp)** | N/A (stateless)                                     | **≤ 15 min**                                                      | Just redeploy the last-good image tag from the registry.                                                                                                                                                                          |

**Whole-system region-loss RTO starting target: 4 hours**, gated by Postgres
geo-restore. **Whole-system RPO starting target: ≤ 5 min for DB, ≤ 24 h for
documents** — and the document number is the honest ceiling until storage
backups are verified.

---

## 3. Cross-cutting recovery principles

### 3.1 Keep DB and object storage time-consistent

DB rows hold object keys. Restore both to the **same point in time** (±a few
minutes). If you PITR the DB to `T` but the bucket only has objects up to `T-1d`,
documents created in that window will 404. Record the restore timestamp and
reconcile (a sweep for DB-referenced keys missing in the bucket is a useful
post-restore check). **[No such reconciliation script exists yet — gap.]**

### 3.2 Migrations are forward-only

Prisma generates **no down migrations**. A "DB rollback" is always a
**compensating forward migration** (`docs/RUNBOOK.md` §Rollback), never an
automatic revert. Do not hand-edit `prisma/migrations/` (CLAUDE.md constraint).

### 3.3 Stop writers before restoring

Any restore-in-place must first scale the API + worker to **zero** so nothing
writes mid-restore (`docs/RUNBOOK.md` already does this for the pg_restore path).

### 3.4 Migration history integrity is a known liability

`docs/PRODUCTION-MIGRATION-RUNBOOK.md` documents real history hazards (duplicate
`20260530000000` prefix, a deleted `add_tenant_export` migration, an enum/type
mismatch). A fresh-environment rebuild (§4.3) can hit these. Read that runbook
before any clean `migrate deploy` from zero.

---

## 4. Recovery procedures by scenario

Each scenario lists detection, the decision, and **real commands**. Substitute
the direct (`:5432`) `DATABASE_URL` for any `migrate`/DDL step on Azure.

### 4.1 Accidental data deletion (single org / table / "oops DELETE")

**Detect:** support report, audit-log anomaly, row-count drop.
**RPO target:** ≤ 5 min. **RTO target:** ≤ 1 h.

1. **Do not** restore the whole prod DB in place for a single-org mistake.
2. Provision a **side-restore** to a point just before the deletion:
   - Azure: PITR to a _new_ server name. `[UNVERIFIED — REQUIRES INFRA ACCESS]`
     ```bash
     az postgres flexible-server restore \
       --resource-group <rg> --name <prefix>-pg-recovery \
       --source-server <prefix>-pg --restore-time "2026-06-28T13:55:00Z"
     ```
   - Compose / pg_dump world: restore the latest dump into a scratch DB:
     ```bash
     createdb bidstack_recovery
     pg_restore -Fc -d "postgresql://…/bidstack_recovery?sslmode=require" ./latest.dump
     ```
3. Extract only the affected `orgId`'s rows from the side copy and re-insert into
   prod (org-scoped — never cross-tenant). Verify counts before/after.
4. Log the action in the audit trail and notify the affected org (§6).

### 4.2 Bad deploy (app regression, no schema damage)

**Detect:** `/readyz` failing, error-rate/Sentry spike, smoke test red.
**RTO target:** ≤ 15 min.

- **Compose:** redeploy the previous image tag.
  ```bash
  pnpm deploy:evidence:compose:policy        # env/ingress sanity
  docker compose -f docker-compose.prod.yml config --quiet
  # point image tags back to the last-good $GIT_SHA, then:
  docker compose -f docker-compose.prod.yml up -d
  ```
- **Azure (draft):** the migrate Job already gates roll-forward; revert by
  shifting traffic to the previous revision and roll back the image tag. The
  draft `infra/azure/deploy.workflow.yml.draft` claims a post-deploy health gate
  - auto-rollback — **UNVERIFIED, never executed.**
- **K8s reference (docs/RUNBOOK.md):** `kubectl rollout undo deployment/bidstack-api`.
- **Key rule:** keep the previous revision/tag live until smoke + canary pass
  (`docs/AZURE_FOUNDATION.md` deploy flow step 7).

### 4.3 Corrupt / failed / partially-applied migration

**Detect:** migrate Job exits non-zero; apps refuse to roll (`depends_on:
service_completed_successfully`); `_prisma_migrations` shows a `failed` row.
**This is the highest-risk scenario** — see §3.4 and
`docs/PRODUCTION-MIGRATION-RUNBOOK.md`.

1. **App tier stays on the old revision** — the gate already prevents apps from
   booting against a half-migrated schema. Do not force them up.
2. Capture applied state (use the **direct `:5432`** URL):
   ```sql
   SELECT migration_name, started_at, finished_at, applied_steps_count, logs
   FROM _prisma_migrations ORDER BY started_at;
   ```
3. **If a migration is logged as started but not finished** (e.g. a
   `ALTER TYPE … ADD VALUE` that cannot run in a transaction — see the RFP enum
   note in `PRODUCTION-MIGRATION-RUNBOOK.md`):
   - Determine whether the DDL actually landed (inspect the object).
   - Mark it resolved appropriately, then re-run deploy (idempotent migrations
     use `IF NOT EXISTS`, so re-runs are safe):
     ```bash
     # it DID apply on the DB but the row is stuck:
     pnpm --filter @bidstack/db exec prisma migrate resolve --applied <migration_name> \
       --schema packages/db/prisma/schema.prisma
     # it did NOT apply and must be retried from clean:
     pnpm --filter @bidstack/db exec prisma migrate resolve --rolled-back <migration_name> \
       --schema packages/db/prisma/schema.prisma
     pnpm db:migrate:deploy
     ```
4. **If the migration corrupted data** (not just history): restore via PITR to
   immediately before the migration window (§4.1 / §4.5), then apply the _fixed_
   migration set.
5. Re-run the one-shot migrate container to confirm convergence, then roll apps:
   - Compose: `docker compose -f docker-compose.prod.yml up migrate` (must exit 0).
   - Azure: re-run the `<prefix>-migrate` Container Apps Job; poll to
     `Succeeded` before rolling revisions. `[UNVERIFIED — REQUIRES INFRA ACCESS]`
6. Reconcile `MIGRATION_HYGIENE.md` with `_prisma_migrations` afterward.

### 4.4 Single-store loss

- **Redis lost:** stand up a fresh Redis (Compose: `docker compose … up -d
redis`; Azure: replace the cache), confirm `REDIS_URL` + password, restart
  api/worker/mcp. Accept loss of in-flight queued jobs; re-drive producers
  (re-run syncs, re-upload pending RFPs). Monitor depth:
  `redis-cli -a "$REDIS_PASSWORD" LLEN bull:notifications:wait`.
- **Object storage lost (bucket survives at provider but objects gone):**
  recovery depends entirely on the external provider's versioning/replication
  (§1.3). **[UNVERIFIED — REQUIRES INFRA ACCESS.]** After restore, run the
  DB↔bucket key reconciliation (§3.1) to find dangling references.

### 4.5 Region outage (full region loss)

**RTO target:** ≤ 4 h (geo-restore dominated). **[ALL STEPS UNVERIFIED — REQUIRES
INFRA ACCESS]**

1. Declare DR; designate the paired region as the recovery target.
2. **Postgres:** geo-restore the Flexible Server into the paired region
   (`geoRedundantBackup: 'Enabled'` makes this possible).
   ```bash
   az postgres flexible-server geo-restore \
     --resource-group <rg-dr> --name <prefix>-pg-dr \
     --source-server <prefix>-pg --location <paired-region>
   ```
3. **Object storage:** fail over to the bucket's replica region (provider-
   specific; only works if cross-region replication was enabled — unverified).
4. **Redis:** provision a fresh Premium cache in the paired region (queues
   rebuild; accept in-flight loss).
5. **Key Vault:** ensure the vault (or a replicated vault) is reachable from the
   paired region; recover `INTEGRATION_TOKEN_KEY` etc. (§4.7).
6. **App tier:** redeploy api/web/worker/mcp images from ACR to Container Apps
   in the paired region; run the **migrate Job to `Succeeded`** before rolling.
7. Repoint Front Door / DNS to the recovery origin; verify `/readyz`, worker
   `/health` (`:4002`), MCP `/health` (`:4003`), browser smoke.
8. **Rebuild from-zero fallback** (if no managed backup is usable): restore the
   latest `pg_dump`, write the required `BIDSTACK_MIGRATE_BACKUP_PROOF` artifact,
   then `pnpm db:migrate:deploy` for any migrations post-dating the dump
   (`docs/RUNBOOK.md` §Restore) — first read §3.4.

### 4.6 Ransomware / destructive compromise of running infra

**Detect:** mass encryption/deletion, unexpected admin actions, integrity
alerts.

1. **Isolate:** revoke the compromised managed identity / credentials; cut
   ingress (Front Door rule / scale apps to zero). Preserve evidence — do not
   wipe.
2. **Assume online backups may also be tampered.** Recover from the **oldest
   known-clean** restore point within retention, not the latest. This is why
   immutable/object-locked, geo-separated backups matter — **verify whether the
   external bucket and Postgres backups are immutable. [UNVERIFIED — likely a
   GAP; object-lock is not configured anywhere in this repo.]**
3. Rebuild app tier from a **known-clean image SHA** (rebuild from source via
   `Dockerfile` rather than trusting registry images if the registry may be
   compromised).
4. Rotate **all** secrets after recovery (§4.7) — assume everything in the
   blast radius leaked.
5. Treat as a security incident → §6 + `docs/security/`.

### 4.7 Credential / key compromise

**Detect:** secret-scan hit, anomalous API/DB access, leaked key.

1. **Identify scope** (which secret, which substrate).
2. **Rotate** using the runbooks — these are real and tested at the unit level:
   - General: `bash scripts/ops/rotate-secrets.sh` (INTEGRATION_TOKEN_KEY, VAPID,
     Stripe webhook, JWT with 1 h overlap).
   - `INTEGRATION_TOKEN_KEY` is **fail-closed**: rotation is blocked unless the
     re-encryption tool `scripts/rotate-integration-tokens.ts` exists
     (`scripts/verify-secret-rotation-policy.mjs` enforces this). Full flow in
     `docs/RUNBOOK.md` §Rotate INTEGRATION_TOKEN_KEY:
     ```bash
     pnpm deploy:evidence:secret-rotation:policy
     pnpm deploy:evidence:secret-rotation:tool:selftest
     OLD_INTEGRATION_TOKEN_KEY=<old> NEW_INTEGRATION_TOKEN_KEY=<new> \
       pnpm exec tsx scripts/rotate-integration-tokens.ts --dry-run   # then --apply
     ```
     Re-encryption is **resumable** (already-rotated rows skipped); keep
     `INTEGRATION_TOKEN_KEY_PREV` until re-encryption + smoke tests pass.
3. **In Key Vault**, update the secret; Container Apps pick it up on restart (a
   secret flip is a restart, not an image rebuild).
4. **If `INTEGRATION_TOKEN_KEY` was lost (not just leaked)** and no escrow copy
   exists: stored OAuth tokens are **unrecoverable** — force re-authorisation of
   every integration. There is no other path.
5. If a Clerk key leaked, rotate in the Clerk dashboard and update
   `CLERK_SECRET_KEY` / publishable key.

### 4.8 Failed third-party dependency

The app degrades rather than hard-fails for most providers (env-gated,
fail-soft). DR action is mostly **wait + monitor + comms**, not restore.

- **Clerk (auth) down:** logins fail; existing sessions ride until expiry. No
  data action. Status comms (§6). Dev-stub auth is loopback-only and **not** a
  prod fallback.
- **Dust / OmniParse / OCR / NVIDIA NIM down:** RFP pipeline stages stall in the
  queue; jobs resume when the provider returns (BullMQ retains/retries). No data
  loss.
- **Object-store provider down:** uploads fail; `/readyz` should reflect storage
  health (`docs/AZURE_FOUNDATION.md` requires readiness to check durable
  storage). Pause RFP intake; resume on recovery.
- **Microsoft Graph / Google / Slack / Twilio etc. down:** integration syncs
  pause; the worker auto-renews Graph subscriptions on recovery
  (`docs/RUNBOOK.md` §Troubleshoot integrations).

### 4.9 Data breach (confidentiality, not availability)

This is an availability-DR doc; a breach is primarily a **security + legal +
comms** event. Minimum DR-adjacent actions:

1. Contain (§4.6 step 1) and preserve forensic evidence.
2. Rotate all potentially-exposed secrets (§4.7).
3. Assess exposure scope per `orgId` (multi-tenant isolation means breaches are
   often org-bounded — confirm, don't assume).
4. Hand off to the incident + comms process (§6) and `docs/security/`.

---

## 5. Break-glass access

> **[ALL UNVERIFIED — REQUIRES INFRA ACCESS to confirm against the live tenant.]**
> The repo encodes the _intended_ posture (`infra/azure/main.bicep`,
> `infra/azure/README.md`); none of it has been validated in a subscription.

- **Normal path is passwordless-ish:** Container Apps use a **user-assigned
  managed identity** with `AcrPull` + `Key Vault Secrets User`; the app MI is
  also set as the Postgres **Entra admin**. App secrets are pulled from Key Vault
  by that identity, not stored in env.
- **DB break-glass:** full Entra passwordless for Postgres is **not yet wired in
  app code** (the bicep notes the app still connects via `pgAdminLogin:password`
  in `DATABASE_URL`). That **`pgAdminLogin` / `pgAdminPassword` pair is the
  documented break-glass DB credential** — retained deliberately as the
  emergency path. For DDL/restore, use the **direct `:5432`** URL
  (`database-url-direct` secret), not the PgBouncer `:6432` URL.
- **Key Vault break-glass:** purge protection + soft-delete are enabled, so a
  deleted secret/vault is recoverable for the retention window
  (`az keyvault secret recover` / `az keyvault recover`). An **offline,
  access-controlled escrow copy of `INTEGRATION_TOKEN_KEY` (and
  `PII_ENCRYPTION_MASTER_KEY` if PII-at-rest is on)** is the last-resort line —
  **whether such an escrow exists is a HUMAN DECISION / GAP.**
- **Network reachability:** Postgres, Redis, and Key Vault are all
  `publicNetworkAccess: Disabled` / private-endpoint in the draft. Break-glass
  therefore requires being **inside the VNet** (jump host / bastion / authorised
  Container Apps exec) — confirm a documented bastion path exists before you need
  it. **[GAP if none.]**
- **Access control:** who may invoke break-glass, dual-control requirement, and
  where the escrow keys live are **TO-BE-SET BY TONY** and must be written down
  before the first prod deploy.

---

## 6. Customer communications

DR execution and customer comms run in parallel. This plan does **not** define
the comms content — use the dedicated playbooks:

- **`mantu-client-incident-comms`** — client-facing incident messaging.
- **`mantu-crisis-comms-playbook`** — escalation + crisis comms.
- **`mantu-data-incident-response`** / **`mantu-ai-incident-response`** — for
  §4.9 breach / AI-output incidents (regulatory + notification timelines).
- Security incidents also reference `docs/security/`.

**GAP / TO-BE-SET:** no status page, no customer-notification distribution list,
and no breach-notification SLA are defined in the repo. Tony must designate the
incident commander, the comms channel/status page, and the legal/DPO notify path
before go-live (breach notification is time-bound under GDPR — see the
mantu data-incident skill).

---

## 7. Validation — what must be drilled before this plan is trusted

**Nothing below has been executed.** Release Gate 12 (Backup/DR) is **FAIL** and
this is an automatic launch blocker per the project's own rules
(`production-readiness/RELEASE_GATE_MATRIX.md`).

- [ ] **[REQUIRES INFRA ACCESS]** Prove a backup exists and is current for
      Postgres, object storage, Redis (AOF), and Key Vault.
- [ ] **[REQUIRES INFRA ACCESS]** Run a **full Postgres restore drill** in
      staging (PITR + geo-restore); measure actual RTO/RPO; replace the §2
      targets with measured numbers; produce a `BACKUP_RESTORE_REPORT`.
- [ ] **[REQUIRES INFRA ACCESS]** Confirm object-store versioning + cross-region
      replication + immutability/object-lock; tighten the §2 document RPO.
- [ ] **[REQUIRES INFRA ACCESS]** Verify Postgres backups are immutable enough to
      survive ransomware (§4.6).
- [ ] **[STAGING]** Run a **corrupt-migration drill** end-to-end (§4.3) including
      `prisma migrate resolve`, after clearing the `PRODUCTION-MIGRATION-RUNBOOK`
      blockers.
- [ ] **[STAGING]** Run a **deploy + DB-migration rollback drill** (§4.2/§4.3).
- [ ] **[STAGING]** Run the **`INTEGRATION_TOKEN_KEY` re-encryption** end-to-end
      against seeded `integration_tokens` rows (§4.7).
- [ ] **[REQUIRES INFRA ACCESS]** Validate the Azure bicep
      (`az bicep build` + `what-if`) — it is currently an UNVALIDATED DRAFT;
      until then the Azure procedures here are aspirational.
- [ ] **[HUMAN]** Ratify RTO/RPO, escrow location, incident commander, break-
      glass authorisation, and the customer-comms channel.
- [ ] Write a key-escrow + DB↔object-store reconciliation script (both are gaps).

---

## 8. Quick reference (real commands)

```bash
# Validate prod compose wiring before any compose recovery
pnpm deploy:evidence:compose:policy
docker compose -f docker-compose.prod.yml config --quiet

# Apply pending migrations (idempotent, forward-only) — use DIRECT :5432 URL
pnpm db:migrate:deploy
# Compose one-shot migrate job (Dockerfile `migrate` target → migrate deploy):
docker compose -f docker-compose.prod.yml up migrate     # must exit 0

# Fix a stuck migration row (DIRECT :5432 URL)
prisma migrate resolve --applied   <name> --schema packages/db/prisma/schema.prisma
prisma migrate resolve --rolled-back <name> --schema packages/db/prisma/schema.prisma

# pg restore from dump (stop writers first)
pg_restore -Fc -d "$DATABASE_URL_DIRECT" ./latest.dump

# Secret rotation (fail-closed for the token key)
bash scripts/ops/rotate-secrets.sh

# Health checks after recovery
curl -fsS https://<api-host>/readyz     # DB + Redis + storage
curl -fsS https://<worker-host>:4002/health
curl -fsS https://<mcp-host>:4003/health
```

**Source of truth:** `docs/RUNBOOK.md`, `docs/PRODUCTION-MIGRATION-RUNBOOK.md`,
`docs/AZURE_FOUNDATION.md`, `infra/azure/README.md`, `docker-compose.prod.yml`,
`Dockerfile` (`migrate` target), `production-readiness/RELEASE_GATE_MATRIX.md`.
