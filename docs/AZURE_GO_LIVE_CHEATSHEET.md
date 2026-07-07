# Polo PreSales — Azure Go-Live Cheat Sheet

Everything you need to add, set, and run to host Polo PreSales on Azure. Read top to
bottom the first time; use it as a checklist for every release after.

Companion docs: `docs/AZURE_FOUNDATION.md` (architecture rationale), `infra/azure/main.bicep`
(the infrastructure-as-code), `infra/azure/README.md`.

---

## 0. Status at a glance

| Area | State | Action |
| --- | --- | --- |
| Monorepo build (`pnpm -r build`) | ✅ Passes clean (api, web, worker, mcp-server, packages) | none |
| Container images (`api`, `worker`, `mcp-server`, `web`, `migrate`) | ✅ Dockerfiles exist | build + push to ACR per release |
| Azure IaC (`infra/azure/main.bicep`) | ✅ Full stack: VNet, Postgres Flexible, Redis, Key Vault, Container Apps, Front Door + WAF, migrate Job | `az bicep build` + `what-if`, then deploy |
| Health probes | ✅ `/livez`, `/readyz` (api), `/health` (worker, mcp) | wire to Container App probes |
| DB migrations | ✅ Run as a Container Apps Job before revisions roll | run + gate each release |
| **Durable storage on Azure** | ⚠️ **GAP — code only supports `local` and `s3`, no native Azure Blob** | see §1 — pick S3-compatible layer *or* add a Blob adapter |
| PII + integration encryption | ✅ Enforced in prod (fails boot if keys missing) | generate + store the two 64-hex keys (§4) |
| Sillage intent connector | ✅ Wired, env-activated (see §7) | set `SILLAGE_*` env to turn on |

**Bottom line:** the app builds and the Azure IaC is complete. The one code change
required before a *pure-Azure* production deploy is durable storage (§1). Everything
else is provisioning + secrets + config.

---

## 1. The one code gap: durable storage

`STORAGE_DRIVER` accepts only `local` (dev/demo) and `s3` today
(`apps/api/src/env.ts`), and production boot **fails** unless `STORAGE_DRIVER=s3`
with an `S3_BUCKET`. Azure Blob is not wired. Choose one:

- **Fast path (recommended for first go-live):** put an **S3-compatible object
  layer** in front of Azure (or use any S3-compatible store on private networking)
  and set `STORAGE_DRIVER=s3` + the `S3_*` vars. No code change; ships today.
- **Native path (do this soon after):** add an `azure-blob` driver.
  1. `STORAGE_DRIVER` enum → add `'azure-blob'` in `apps/api/src/env.ts`.
  2. New adapter in `apps/api/src/storage/` implementing the same put/get/sign
     interface as the S3 driver, using `@azure/storage-blob` + the Container App's
     managed identity (no account keys).
  3. Matching reader in the worker (`apps/worker/src/…`) for RFP/OCR parse.
  4. Update the prod guard in `env.ts` (~line 348) to accept `azure-blob`.
  5. Verify the full **RFP upload → storage → worker parse** path (foundation
     checklist item).

---

## 2. Azure resources to create (all in `main.bicep`)

Provisioned by the Bicep — you supply parameters, `az` creates them:

- **Networking:** VNet + subnets (Container Apps infra, private-endpoints, Postgres
  delegated), private DNS zones + links for Postgres/Redis/Key Vault.
- **Data:** Azure Database for **PostgreSQL Flexible Server** (with `VECTOR,
  PGCRYPTO, PG_TRGM, CITEXT` allow-listed, PgBouncer, Entra admin), **Azure Cache
  for Redis** (TLS, private endpoint).
- **Secrets:** **Key Vault** (private endpoint) + a user-assigned **managed
  identity** the Container Apps use to read secrets.
- **Compute:** Container Apps **managed environment** + four apps (`api`, `worker`,
  `mcp`, `web`) + a **migrate Job**.
- **Edge:** **Front Door** + **WAF** policy routing to api and web origins.
- **Observability:** Log Analytics workspace + Application Insights.

Validate before creating (from `AZURE_FOUNDATION.md`):
```bash
az bicep build -f infra/azure/main.bicep
az deployment group what-if -g <rg> -f infra/azure/main.bicep -p @params.json
node scripts/verify-azure-infra-policy.mjs   # repo policy check
```
Enable **Postgres HA + backup retention** and confirm **Redis requires TLS** before
production.

---

## 3. Secrets to put in Key Vault

Store as Key Vault secrets; reference them from the Container Apps via the
user-assigned managed identity (never inline in the app spec):

| Secret | How to generate / source |
| --- | --- |
| `DATABASE_URL` | Postgres Flexible Server conn string (private FQDN, `sslmode=require`) |
| `REDIS_URL` | `rediss://` (TLS) private endpoint URL |
| `INTEGRATION_TOKEN_KEY` | `openssl rand -hex 32` (64 hex chars — encrypts per-org integration creds) |
| `PII_ENCRYPTION_MASTER_KEY` | `openssl rand -hex 32` (64 hex chars — field-level PII encryption) |
| `BIDSTACK_JOB_SIGNING_SECRET` | `openssl rand -hex 32` (signs queue jobs; api + worker refuse prod boot without it) |
| `CLERK_SECRET_KEY` + `VITE_CLERK_PUBLISHABLE_KEY` | Clerk production instance (auth) |
| `S3_*` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | object-storage credentials (until azure-blob lands) |
| Optional connectors | `SILLAGE_*` (§7), `ERP_MCP_URL`, `LMS_360L_*`, Dust, Apollo, Seamless, etc. |

Rotate the three `*_KEY`/`*_SECRET` values on a schedule; store rotation dates.

---

## 4. Production env contract (what `env.ts` enforces at boot)

The API **refuses to start** in production unless all of these hold — treat it as the
go/no-go gate:

- `NODE_ENV=production`
- `PUBLIC_BASE_URL` uses **https**
- `DATABASE_URL` set and reachable
- `REDIS_URL` set (production requires Redis — no in-memory fallback)
- `STORAGE_DRIVER=s3` **and** `S3_BUCKET` set (or `azure-blob` once §1 lands)
- `INTEGRATION_TOKEN_KEY` is a 64-hex-char key
- `PII_FIELD_ENCRYPTION=true` **and** `PII_ENCRYPTION_MASTER_KEY` is 64-hex
- `BIDSTACK_JOB_SIGNING_SECRET` set (job signing)
- `BIDSTACK_TENANT_SCOPE_GUARD` **not** `off`
- Auth: either real Clerk (`CLERK_SECRET_KEY` + publishable key) **or** the demo path
  (`DEMO_MODE=true` + `DEMO_SESSION_SECRET` + `DEMO_PUBLIC_DEPLOYMENT_ACK=true`) —
  the two are mutually exclusive.

Ports / probes (set per Container App): `PORT_API=4000`, `PORT_MCP=4001` (health
`MCP_HEALTH_PORT=4003`), `WORKER_HEALTH_PORT=4002`. **MCP ingress must route to 4001,
not the 4003 health server.**

Feature-gated (only if you enable them): `ERP_ENABLED=true` needs `ERP_MCP_URL`;
`LMS_360L_ENABLED=true` needs `LMS_360L_BASE_URL` + `LMS_360L_API_KEY`;
`SERUM_DEMO_MODE_ENABLED=true` is **rejected** in production.

Full var list: `.env.example` (327 keys). Only the subset above is boot-critical.

---

## 5. Deploy flow (per release)

From `AZURE_FOUNDATION.md`, encode in CI (`infra/azure/deploy.workflow.yml.draft` is
the starting point):

1. Build `api`, `worker`, `mcp-server`, `web`, `migrate` images **from the same commit**.
2. Push to ACR tagged `${GIT_SHA}`.
3. Update + run the **migrate Job**; poll to `Succeeded` — fail the release on
   `Failed`/`Degraded`/timeout.
4. Roll api, worker, mcp, web revisions.
5. Verify `/readyz` (api), `/health` (worker + mcp), and a browser smoke test.
6. Keep the previous revision live until smoke + canary pass, then retire it.

---

## 6. Post-deploy verification checklist

- [ ] `az bicep build` + `what-if` reviewed before the deploy
- [ ] Key Vault secret references resolve via the managed identity
- [ ] Postgres extensions allow-listed **before** migrations; HA + backups on
- [ ] Redis TLS-only and reachable from Container Apps
- [ ] `/readyz` returns unhealthy when DB / Redis / storage is down (fail-closed)
- [ ] MCP ingress hits `4001`
- [ ] RFP upload → storage → worker parse succeeds on production storage
- [ ] 2-replica API run: idempotency, rate limits, uploads, sessions stable
- [ ] Front Door + WAF fronting api/web; direct app ingress locked to the VNet
- [ ] App Insights receiving traces; alerts on 5xx + queue depth

---

## 7. Connect Sillage (API + MCP, for intent)

The Sillage intent connector is wired and **activates from env** — no code change to
turn on. It calls Sillage **MCP-first, REST-fallback**, and fails open (a Sillage
outage never breaks a request).

Set these (Key Vault → Container App env for `api`):

```
SILLAGE_API_KEY=            # REST bearer key
SILLAGE_API_BASE_URL=       # optional; defaults to the built-in base URL
SILLAGE_MCP_URL=            # Sillage MCP server endpoint
SILLAGE_MCP_BEARER_TOKEN=   # optional; if the MCP endpoint needs auth
SILLAGE_MCP_TIMEOUT_MS=     # optional; request timeout
SILLAGE_MCP_INTENT_TOOL=    # optional; defaults to 'detect_intent'
```

- Configure **either** the REST key **or** the MCP URL (or both — MCP is tried
  first). With neither set, the connector reports "disabled" and returns a null
  intent; nothing breaks.
- Endpoint: `POST /api/sillage/detect-intent` (org-scoped, RBAC-gated) →
  `{ intent, confidence, source: 'mcp'|'rest'|null, error? }`.
- It shows up in **Settings → Integrations** (connectors catalog) with a health
  badge derived from which vars are set.
- Consumers to wire next (product choice, not built yet): the ⌘K copilot, workflow
  automation triggers, or lead-routing — call `detectSillageIntent()` from any of
  them.

---

## 8. Recommended follow-ups (not blockers)

- Land the native **azure-blob** storage driver (§1) so you're not carrying an
  S3-compat shim.
- Wire Sillage intent into a concrete surface (copilot / workflow / routing).
- Add **CDN cache rules** + immutable asset headers on the web origin.
- Turn on **Rolling Releases / canary** at Front Door for safer deploys.
- Add the deferred **tenant-scope-guard** enforce-mode extension and a DB-level
  `parentId` acyclicity constraint (both tracked in `PROGRESS.md`).
- Purge the polluted dev/demo DB test-fixture accounts before a customer demo (the
  UI filter hides them; the data is still there).
