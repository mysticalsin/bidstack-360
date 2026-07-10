# BidStack 360° — Rollback Runbook

**Scope:** how to safely revert a bad release of BidStack 360° — app code AND
database — across the two real deploy paths in this repo.
**Audience:** on-call engineer / release operator with cloud + repo access.
**Status legend:**
`✅ GROUNDED` = matches a file in this repo, copy/paste-able ·
`⚠️ INFRA-DEPENDENT` = correct in shape but needs live cloud access + your
resource names/credentials to run ·
`🚧 NOT YET EXECUTED` = procedure written but never actually run (drill required
before you trust it).

> **Honesty banner.** No production/staging rollback or restore has been executed
> from this repo. The DB-restore and staging-drill sections are **🚧 NOT YET
> EXECUTED**. The Azure pipeline that automates app rollback
> (`infra/azure/deploy.workflow.yml.draft`) is an **⚠️ UNVALIDATED DRAFT** — it
> is intentionally named `*.draft` and is NOT an active workflow. Per
> `production-readiness/PRODUCTION_READINESS_REPORT.md`, "No tested
> backups / restore" is the current #1 CRITICAL release blocker (Gate 12). This
> runbook is the _plan to close that gap_, not evidence that it is closed.

---

## 0. The two deploy paths (know which one you are rolling back)

| Path                    | Frontend                                                           | Backend / DB                                                                  | Image / artifact                            | IaC                                             |
| ----------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- |
| **Production (target)** | `web` container (nginx) behind Azure Front Door                    | `api` / `worker` / `mcp` Container Apps + Postgres Flexible Server 16 + Redis | OCI images `bidstack-<svc>:<gitSha>` in ACR | `infra/azure/main.bicep` (⚠️ unvalidated draft) |
| **Demo**                | Vercel static SPA (`vercel.json` → `build:demo` → `apps/web/dist`) | Railway-hosted API + Postgres                                                 | Vercel deployment + Railway deployment      | `vercel.json`                                   |
| **Self-host / parity**  | `web` service                                                      | `api`/`worker`/`mcp` + `postgres`/`redis` services                            | `docker-compose.prod.yml` targets           | `docker-compose.prod.yml`                       |

All three share the same migrate contract: a **one-shot migrate step runs to
completion BEFORE any app boots on the new schema** (compose
`depends_on: migrate: condition: service_completed_successfully`; Azure runs the
`…-migrate` Container Apps Job to `Succeeded` before rolling app revisions). That
ordering is why an **app rollback alone is usually safe** — see §3.

---

## 1. First 5 minutes — triage before you touch anything

1. **Declare the incident** and capture the current state. Do NOT immediately
   redeploy; record what is broken (error rate, failing endpoint, Sentry issue,
   bad migration).
2. **Identify the bad release SHA and the last-good SHA** (§2). You cannot roll
   back to "the previous one" without knowing what it was.
3. **Answer the one decision that changes everything:** _did this release run a
   database migration?_ (§3 decision tree). If yes, app-only rollback may be
   insufficient or unsafe.
4. **Freeze the pipeline.** The Azure draft uses
   `concurrency: { group: azure-deploy, cancel-in-progress: false }` — never let
   a second deploy interleave with a rollback. For demo, pause auto-deploys.

---

## 2. Identify the last-good build (deploy-evidence bundle)

A "build" in this repo is identified by **git commit SHA** — the Azure pipeline
sets `IMAGE_TAG: ${{ github.sha }}` and tags every image `bidstack-<svc>:<sha>`.

### 2a. From the deploy-evidence bundle ✅ GROUNDED

The release gate writes machine-readable evidence to `deploy-evidence/`:

- `deploy-evidence/source-control-latest.json` — contains `commit` (the SHA) and
  `branch`. Produced by `pnpm deploy:evidence:source`.
- `deploy-evidence/release-evidence-bundle-latest.json` — contains `deployEnv`,
  `generatedAt`, and **`passed`** (overall gate verdict). Produced by
  `pnpm deploy:evidence:bundle:production`.

The **last-good build** = the SHA from the most recent bundle whose
`passed === true` for the target `deployEnv`.

```bash
# Last-good candidate SHA + its gate verdict:
node -e "const s=require('./deploy-evidence/source-control-latest.json'); \
  const b=require('./deploy-evidence/release-evidence-bundle-latest.json'); \
  console.log('commit ', s.commit); \
  console.log('branch ', s.branch); \
  console.log('env    ', b.deployEnv); \
  console.log('passed ', b.passed, '(must be true to be a roll-forward target)'); \
  console.log('genAt  ', b.generatedAt);"
```

> ⚠️ **Reality check (2026-06-28):** the bundle currently committed shows
> `deployEnv: production`, **`passed: false`**. There is **no certified-green
> production bundle yet**. Until one exists, "last-good" must be established from
> the platform's own deployment history (§2b/§2c), not from this file.

### 2b. Azure — last-good revision/image ⚠️ INFRA-DEPENDENT

Container Apps keep revision history. List them, newest first:

```bash
RG=<resource-group>; PREFIX=<name-prefix>   # e.g. bidstack-prod
for svc in api worker mcp web; do
  echo "== $PREFIX-$svc =="
  az containerapp revision list -g "$RG" -n "$PREFIX-$svc" \
    --query "reverse(sort_by([].{rev:name,active:properties.active,created:properties.createdTime,image:properties.template.containers[0].image,healthy:properties.healthState}, &created))" \
    -o table
done
```

The last-good build is the most recent revision that was `Healthy` and serving
before the bad deploy — note its `image` tag (the SHA) for §3.

### 2c. Demo (Railway/Vercel) — last-good deployment ⚠️ INFRA-DEPENDENT

- **Vercel:** `vercel ls bidstack-demo` (or the dashboard → Deployments) — each
  deployment is immutable and pinned to a git SHA.
- **Railway:** dashboard → service → Deployments — each has a SHA + status.

---

## 3. Decision tree — app-only rollback vs DB restore

```
Did the bad release apply a DB migration?
│   (check: new folder in packages/db/prisma/migrations/ between last-good SHA
│    and bad SHA?  AND  did the migrate step run? — Azure: `…-migrate` job
│    execution Succeeded for this deploy / compose: migrate service exited 0)
│
├─ NO migration in this release
│     → APP-ONLY ROLLBACK (§4). Safe. Schema unchanged; old image runs fine.
│
└─ YES, a migration ran
      │
      ├─ Migration was ADDITIVE / backward-compatible
      │   (added nullable column, new table, new index, new enum value —
      │    the "expand" half of expand/contract; old code ignores it)
      │     → APP-ONLY ROLLBACK (§4). Leave the schema forward.
      │       Old image keeps working against the newer-but-compatible schema.
      │       This is the designed-for case (see §5 "expand/contract").
      │
      ├─ Migration was DESTRUCTIVE / breaking
      │   (dropped/renamed column or table, narrowed a type, NOT-NULL backfill,
      │    enum value removed) — old code will throw against the new schema
      │     → DB RESTORE REQUIRED (§6). App rollback alone will NOT work because
      │       the previous image expects the old shape. Restore DB to a point
      │       just before the migration, THEN roll the app back.
      │
      └─ Migration FAILED mid-apply (deploy aborted at the migrate step)
            → No app ever served the new schema (the gate stopped the deploy).
              Resolve the failed migration record (§7), then either
              roll-forward a fix or restore (§6) depending on partial damage.
```

**Rule of thumb baked into this codebase:** because the pipeline gates apps
behind a _successful_ migrate, and because the migration discipline is
**forward-only + incremental** (`MIGRATION_HYGIENE.md`), the _intended_ rollback
for the common case is **app-only, schema-forward**. DB restore is the
break-glass path for destructive migrations and corruption.

---

## 4. APP rollback — redeploy the previous image/revision

### 4a. Azure Container Apps — `Single` revision mode ⚠️ INFRA-DEPENDENT

`infra/azure/main.bicep` sets `activeRevisionsMode: 'Single'` on api/worker/mcp/
web. In Single mode, updating the image creates a new revision and **shifts 100%
of traffic to it automatically** — so rollback = point the app back at the
previous image (or re-activate the previous revision).

**Option A — re-point to the last-good image tag (matches the pipeline's own
rollback job):**

```bash
RG=<rg>; PREFIX=<name-prefix>; ACR=<acr>.azurecr.io; GOOD_SHA=<last-good-sha>
for pair in "api:api" "worker:worker" "mcp:mcp-server" "web:web"; do
  app="${pair%%:*}"; img="${pair##*:}"
  az containerapp update -g "$RG" -n "$PREFIX-$app" \
    --image "$ACR/bidstack-$img:$GOOD_SHA"
done
```

(Note the `mcp` app runs the `mcp-server` image — same name mapping the draft
pipeline uses.)

**Option B — reactivate a known-good revision (no image rebuild, fastest):**

```bash
az containerapp revision activate   -g "$RG" -n "$PREFIX-api" --revision <good-rev>
az containerapp ingress traffic set -g "$RG" -n "$PREFIX-api" --revision-weight <good-rev>=100
# repeat per service; deactivate the bad revision afterwards:
az containerapp revision deactivate -g "$RG" -n "$PREFIX-api" --revision <bad-rev>
```

**Automated path (the draft pipeline already does this).** ⚠️ UNVALIDATED DRAFT —
`infra/azure/deploy.workflow.yml.draft`:

- The `roll-apps` job records the **current image to `prev-<svc>.txt`** as a
  build artifact _before_ updating each service.
- A `rollback` job (`if: failure()`) runs after `roll-apps`/`health-gate`,
  downloads `prev-<svc>.txt`, and does
  `az containerapp update … --image "$PREV"` per service.
- This only protects deploys that go through that pipeline AFTER a maintainer
  promotes it to `.github/workflows/deploy.yml`. Until then, use Option A/B by
  hand.

### 4b. Demo — Vercel + Railway ⚠️ INFRA-DEPENDENT

- **Vercel (frontend):** promote the previous immutable deployment —
  `vercel rollback <previous-deployment-url>` (or dashboard → previous
  deployment → "Promote to Production"). The SPA is static
  (`vercel.json` → `outputDirectory: apps/web/dist`), so this is instant and
  carries no DB risk.
- **Railway (backend):** dashboard → service → Deployments → the last-good
  deployment → **Redeploy** (or `railway redeploy` with the service selected).
  Railway redeploys the previous build image. If that release also migrated the
  Railway Postgres destructively, treat it as §3 "destructive" and restore the
  Railway DB first.

### 4c. Self-host / compose parity ✅ GROUNDED

```bash
# Pin to the last-good tag and recreate app services only (NOT postgres/redis):
export BIDSTACK_IMAGE_TAG=<last-good-sha>
docker compose -f docker-compose.prod.yml up -d --no-deps api web worker mcp-server
```

Do **not** `down -v` — the `postgres_data` named volume holds the database;
removing it destroys data.

### 4d. Verify, then close

Run §8 verification. Deactivate/clean up the bad revision once green.

---

## 5. DATABASE rollback — why "just undo the migration" does not exist here

### 5a. Prisma is forward-only ✅ GROUNDED

Production migrations apply via **`prisma migrate deploy`**:

- `pnpm db:migrate:deploy` → `packages/db` `migrate:deploy` → `prisma migrate deploy`.
- The Dockerfile **`migrate`** target's CMD is
  `prisma migrate deploy --schema packages/db/prisma/schema.prisma`.

`prisma migrate deploy` **only rolls forward.** It applies pending migrations in
`packages/db/prisma/migrations/` in lexical order and records them in the
`_prisma_migrations` table. **There is no `migrate deploy --down`, no automatic
down-migration, and no generated rollback SQL.** Prisma's `migrate dev`
(local-only) can reset, but `migrate reset` is **destructive (drops the DB)** and
must never be run against a shared/prod database.

**Implication:** the database cannot be "un-migrated" by Prisma. The real DB
rollback mechanisms are (in order of preference):

1. **Don't need one** — keep migrations additive (expand/contract), roll the app
   back, leave schema forward (§3 common case).
2. **Restore from backup** — the genuine rollback for a destructive migration
   (§6).
3. **A new forward "contract/repair" migration** — write a _new_ migration that
   reverses the unwanted change (never edit the applied one — see
   `MIGRATION_HYGIENE.md` rule 2).

### 5b. The safe pattern: expand / contract ✅ GROUNDED (discipline) / recommended

To make releases rollback-safe _without_ DB restore, split a breaking schema
change across releases:

1. **Expand** (release N): add the new column/table _additively_, nullable, with
   defaults; backfill in a separate data migration (`MIGRATION_HYGIENE.md`
   rule 6). Old code ignores it. ← rolling the app back here is safe.
2. **Dual-write/dual-read** (release N): new code writes both old and new shapes.
3. **Contract** (release N+1, only after N is proven stable): drop the old
   column. Now the previous-but-one image is the only thing that breaks, and you
   are far past the rollback window.

This is the project's intended way to keep app-only rollback (§4) viable. Avoid
shipping a destructive migration in the same release as the feature that needs
it.

### 5c. Backup-before-migrate (do this every production migration) 🚧 NOT YET EXECUTED

The migrate step now has a **built-in proof gate**: staging/production migrations
refuse to run until `BIDSTACK_MIGRATE_BACKUP_PROOF` points at a fresh JSON proof
for an encrypted backup tied to the exact `DATABASE_URL` fingerprint. Take a
snapshot _immediately before_ running migrations so §6 has a clean restore point:

- **Azure Postgres Flexible Server** has automated backups configured in
  `main.bicep`: `backup: { backupRetentionDays: 35, geoRedundantBackup: 'Enabled' }`
  plus `highAvailability: { mode: 'ZoneRedundant' }`. That gives **point-in-time
  restore (PITR) within 35 days** and geo-restore — this is the primary restore
  source (§6). For an _explicit_ pre-migration marker, note the exact UTC
  timestamp before starting the `…-migrate` job, and optionally take a logical
  dump as a belt-and-braces copy:
  ```bash
  # ⚠️ run from a host with network + Entra/password access to the DIRECT (:5432) endpoint
  pg_dump "$DATABASE_URL_DIRECT" -Fc -f "pre-migrate-$(date -u +%Y%m%dT%H%M%SZ).dump"
  ```
  (Use the `database-url-direct` connection — :5432, non-pooled — the same one
  the migrate job uses; PgBouncer :6432 is wrong for admin/dump work.)
- **Railway / compose:** `pg_dump -Fc` to a durable location before migrating.

After the dump/snapshot, write the proof artifact described in
`production-readiness/DEPLOYMENT_RUNBOOK.md` §4 and pass it to the migrate job.

> 🚧 The proof gate is wired into the deploy pipeline, but **a real staging/prod
> proof artifact has not been produced and restore has not been drilled**.
> Closing Gate 12 requires both (a) confirming automated backups exist in the
> live env and (b) executing a restore (§9).

---

## 6. DATABASE restore — the real DB rollback (break-glass)

Use when §3 says "destructive migration" or on data corruption.

### 6a. Azure Postgres Flexible Server — point-in-time restore ⚠️ INFRA-DEPENDENT · 🚧 NOT YET EXECUTED

PITR creates a **new server** restored to a chosen timestamp; you then repoint
the apps' `DATABASE_URL` secrets at it. It does not mutate the live server in
place (safer — keeps the corrupted server for forensics).

```bash
RG=<rg>; SRC=<name-prefix>-pg; NEW=<name-prefix>-pg-restore-$(date -u +%Y%m%d%H%M)
RESTORE_TS="<UTC timestamp captured pre-migrate, e.g. 2026-06-28T09:14:00Z>"
az postgres flexible-server restore -g "$RG" \
  --name "$NEW" --source-server "$SRC" --restore-time "$RESTORE_TS"
```

Then:

1. Re-create the `azure.extensions` allow-list + PgBouncer config on the new
   server if not inherited (`VECTOR,PGCRYPTO,PG_TRGM,CITEXT` — the migrations
   `CREATE EXTENSION` these; `pgbouncer.enabled=true`). See `main.bicep`.
2. Update the Key Vault secrets `database-url-api` / `database-url-worker` /
   `database-url-mcp` / `database-url-direct` to the new host, then restart the
   apps (Container Apps re-pull KV secrets on revision restart).
3. Roll the app back to the matching pre-migration image (§4) so code and schema
   agree.
4. Verify (§8). Decommission the corrupted server only after sign-off.

### 6b. Railway / compose — restore from dump ⚠️ INFRA-DEPENDENT · 🚧 NOT YET EXECUTED

```bash
# Restore into a clean database, then repoint the app:
pg_restore --clean --if-exists -d "$DATABASE_URL_DIRECT" pre-migrate-<ts>.dump
```

For compose, restore into the `postgres` service's volume-backed DB; never
`docker compose down -v` (that deletes `postgres_data`).

### 6c. RTO / RPO — UNKNOWN ⚠️

- **RPO** (data-loss window): Azure PITR ≈ minutes (transaction-log based) but
  the _actual_ number is **unmeasured for this app**.
- **RTO** (time to restore): **unmeasured** — PITR provisions a new server, which
  can take many minutes to tens of minutes. Must be measured in the §9 drill.

---

## 7. Handling a FAILED migration (`prisma migrate resolve`)

If `migrate deploy` aborts mid-way, the migration is recorded as **failed** in
`_prisma_migrations`, and **every subsequent `migrate deploy` refuses to run**
(Prisma error **P3009**) until you resolve it. ⚠️ INFRA-DEPENDENT (needs DB
access).

Inspect first:

```bash
pnpm --filter @bidstack/db exec prisma migrate status --schema prisma/schema.prisma
```

**Case A — the failed migration's changes were NOT applied** (DB is unchanged):
mark it rolled-back so it re-runs on the next deploy:

```bash
prisma migrate resolve --rolled-back <failed_migration_name> --schema packages/db/prisma/schema.prisma
```

**Case B — the migration partially applied** (some DDL committed): do NOT just
mark it applied. Restore the DB to the pre-migrate point (§6), then re-run the
fixed migration. Marking a partial migration `--applied` leaves the schema in a
lie and corrupts future deploys.

**Never** hand-edit an already-attempted migration's `migration.sql`
(`MIGRATION_HYGIENE.md` rule 2). Fix forward with a _new_ migration. Baseline is
`20260525010000_sync_drift` — do not reach behind it.

---

## 8. Verification after rollback (smoke / health)

The app exposes three probes (`apps/api/src/routes/health.ts`):

- **`/livez`** — liveness (process up).
- **`/readyz`** — readiness: **200 only when DB + Redis + storage are ready**.
- **`/health`** — DB + Redis ping, returns **200 / 503**.

Container HEALTHCHECKs (Dockerfile): api → `/readyz` :4000 · worker → `/health`
:4002 · mcp → `/health` :4003 · web → `/health` :8080. Front Door probes
`/livez` (api origin) and `/` (web origin) per `main.bicep`.

```bash
# Through the public edge (Front Door host) — matches the pipeline health-gate:
BASE="https://<front-door-host>"
curl -fsS -o /dev/null -w "readyz=%{http_code}\n" "$BASE/readyz"   # expect 200
curl -fsS -o /dev/null -w "web=%{http_code}\n"    "$BASE/"         # expect 200
```

Checklist:

- [ ] `/readyz` = 200 on api (DB+Redis+storage all healthy).
- [ ] `/` = 200 on web; SPA loads, no console errors.
- [ ] Worker `/health` = 200; BullMQ queue depth draining (no stuck jobs).
- [ ] `prisma migrate status` = "Database schema is up to date" (no failed/
      pending mismatch vs the running image).
- [ ] Sentry error rate back to baseline; the triggering error is gone.
- [ ] A real user journey (login → list a tenant resource → write) succeeds.
- [ ] Multi-tenancy spot check: data is org-scoped (no cross-tenant leak) — this
      is a non-negotiable in this codebase.

If `/readyz` stays 503 after an app rollback, suspect a **schema/code mismatch**
(§3 destructive case) → escalate to DB restore (§6).

---

## 9. Staging rollback DRILL — 🚧 NOT YET EXECUTED (requires staging)

> This drill is **written but never run.** It is the procedure to _prove_ the
> rollback paths above and to close Gate 12 (tested backup/restore) from
> `PRODUCTION_READINESS_REPORT.md`. It must be executed against a **staging**
> environment with throwaway data — never production — and the results
> (RTO/RPO, screenshots, command transcripts) filed under
> `deploy-evidence/` + `production-readiness/evidence/`.

**Pre-reqs:** a staging Container Apps env (or compose stack) seeded with
non-PII demo data (`pnpm db:seed:demo`); cloud access; the last-good and a
deliberately-bad image tag.

**Drill A — app-only rollback (additive migration):**

1. Deploy last-good (`SHA_A`). Record `/readyz`=200, capture baseline.
2. Ship `SHA_B` containing an **additive** migration (new nullable column) + a
   deliberate app bug (e.g. a 500 on one route).
3. Confirm the migrate job/step reached `Succeeded` and apps rolled.
4. Execute §4 app rollback to `SHA_A` (leave schema forward).
5. **Pass criteria:** `/readyz`=200, the bad route is gone, no data loss, and
   the additive column still present (schema-forward proven safe). Record
   wall-clock rollback time.

**Drill B — DB restore (destructive migration):**

1. From `SHA_A`, capture the pre-migrate UTC timestamp + `pg_dump` (§5c).
2. Ship `SHA_C` with a **destructive** migration (drop a column the old code
   reads).
3. Roll the app back to `SHA_A` and observe `/readyz` go **503** (proves
   app-only is insufficient for destructive changes — this is the teaching
   moment).
4. Execute §6 restore (PITR to the pre-migrate timestamp / `pg_restore`),
   repoint `DATABASE_URL`, restart apps on `SHA_A`.
5. **Pass criteria:** `/readyz`=200, dropped column back, data intact to the
   restore point. **Record measured RTO and RPO** → fill §6c.

**Drill C — failed-migration recovery:**

1. Ship `SHA_D` with a migration that fails mid-apply (e.g. a constraint that
   violates existing data).
2. Confirm the deploy **stops at the migrate step** and no app served the new
   schema (proves the gate).
3. Run §7 Case A (`migrate resolve --rolled-back`), fix the migration forward,
   redeploy.
4. **Pass criteria:** next `migrate deploy` succeeds; `migrate status` clean.

**Exit:** all three drills green → update
`production-readiness/RELEASE_GATE_MATRIX.md` Gate 12 from FAIL/UNKNOWN to PASS
with the evidence links, and flip the §6c RTO/RPO from UNKNOWN to measured.

---

## 10. Known gaps & honest caveats

- **`pnpm merge:rollback` is NOT a deployment rollback.** `package.json` maps it
  to `bash scripts/merge/rollback.sh`, but **that file does not exist in the
  repo** (stale reference; only `scripts/decrypt-pii-rollback.ts` is present).
  Even if restored, the `merge:*` scripts are the _merge-train_ tooling
  (git branch integration), unrelated to reverting a deployed release. Do not
  reach for it during an incident.
- **The Azure rollback automation is an UNVALIDATED DRAFT.**
  `infra/azure/deploy.workflow.yml.draft` + `infra/azure/main.bicep` have not
  been run through `az bicep build` / `what-if` / a real subscription (see
  `infra/azure/README.md`). Every `az` command here is shape-correct but must be
  validated against your live resources before you trust it in an incident.
- **No certified-green production evidence bundle exists yet**
  (`release-evidence-bundle-latest.json` → `passed: false`), so §2a cannot yet
  name a "last-good" SHA from evidence alone — use platform history (§2b/§2c).
- **RTO/RPO are unmeasured** until Drill B runs (§6c).
- **Backups are configured in IaC but unverified live**, and **restore has never
  been executed** — this remains the #1 CRITICAL blocker per the readiness
  report. This runbook does not change that; it is the plan to close it.

---

### Source map (what each claim is grounded in)

- App targets, health probes, migrate CMD → `Dockerfile`
  (`migrate`/`api`/`worker`/`mcp-server`/`web` targets).
- Migrate-before-boot ordering, services, `postgres_data` volume →
  `docker-compose.prod.yml`.
- Forward-only deploy, baseline, no-hand-edit rule →
  `packages/db/prisma/migrations/MIGRATION_HYGIENE.md`,
  `packages/db/package.json` (`migrate:deploy`), root `package.json`
  (`db:migrate:deploy`).
- Single-revision mode, migrate Job, Postgres backup/HA, Front Door probes →
  `infra/azure/main.bicep`.
- Pipeline record-previous-image + auto-rollback, `IMAGE_TAG=github.sha`,
  health-gate → `infra/azure/deploy.workflow.yml.draft` (DRAFT).
- Build identity / gate verdict → `deploy-evidence/source-control-latest.json`,
  `deploy-evidence/release-evidence-bundle-latest.json`.
- Demo path → `vercel.json`, `.vercelignore`; Railway backend (project deploy
  notes).
- Health endpoint semantics → `apps/api/src/routes/health.ts`.
- Gate 12 status → `production-readiness/PRODUCTION_READINESS_REPORT.md`.
