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
| Container images (`api`, `worker`, `mcp-server`, `web`, `migrate`) | ✅ Multi-stage targets in the root `Dockerfile` | build + push to ACR per release |
| Azure IaC (`infra/azure/main.bicep`) | ✅ Full stack; **compiles clean** (`bicep build`, 0 errors/0 warnings) + passes `scripts/verify-azure-infra-policy.mjs`. ⚠️ Not yet `what-if`'d against a live subscription | run `az deployment group what-if` on a real RG (confirms quotas/region/wiring), then deploy |
| Health probes | ✅ `/livez`, `/readyz` (api), `/health` (worker, mcp) | wire to Container App probes |
| DB migrations | ✅ Run as a Container Apps Job before revisions roll | run + gate each release |
| **Durable storage on Azure** | ⚠️ **GAP — code only supports `local` and `s3`, no native Azure Blob** | see §1 — pick S3-compatible layer *or* add a Blob adapter |
| PII + integration encryption | ✅ Enforced in prod (fails boot if keys missing) | generate + store the two 64-hex keys (§4) |
| Sillage intent connector | ✅ Wired, env-activated (see §7) | set `SILLAGE_*` env to turn on |
| Real-data bootstrap | ✅ `pnpm db:seed:prod` (org + system roles, zero fixtures) + purge script for demo data | follow `docs/PRODUCTION_DATA_BOOTSTRAP.md` |

**Bottom line:** the app builds; the Azure IaC covers the full topology, now
**compiles clean** (`bicep build`) and passes the repo policy gate — one
validation step remains: `az deployment group what-if` against a live
subscription. The one code change required before a *pure-Azure* production
deploy is durable storage (§1). Everything else is provisioning + secrets + config.

---

## 1. The one code gap: durable storage

`STORAGE_DRIVER` accepts only `local` (dev/demo) and `s3` today
(`apps/api/src/env.ts`), and production boot **fails** unless `STORAGE_DRIVER=s3`
with an `S3_BUCKET` (the worker additionally requires `S3_REGION`). One carve-out:
`DEMO_MODE=true` exempts the storage guard, so a demo-mode production deploy may
run `local` storage. Azure Blob is not wired. Choose one:

- **Fast path (recommended for first go-live):** put an **S3-compatible object
  layer** in front of Azure (or use any S3-compatible store on private networking)
  and set `STORAGE_DRIVER=s3` + the `S3_*` vars. No code change; ships today.
- **Native path (do this soon after):** add an `azure-blob` driver.
  1. `STORAGE_DRIVER` enum → add `'azure-blob'` in `apps/api/src/env.ts`.
  2. New adapter in `apps/api/src/storage/` implementing the same put/get/sign
     interface as the S3 driver, using `@azure/storage-blob` + the Container App's
     managed identity (no account keys).
  3. Matching reader in the worker (`apps/worker/src/…`) for RFP/OCR parse.
  4. Update the prod guard in `env.ts` (~line 359, the `STORAGE_DRIVER` check) to
     accept `azure-blob`.
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
| `CLERK_WEBHOOK_SECRET` | Clerk Dashboard → Webhooks → endpoint `https://<api>/webhooks/clerk` (organization events) — automatic org bootstrap; fallback is `pnpm db:seed:prod` |
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

Full var list: `.env.example` (~333 keys). Only the subset above is boot-critical.

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

## 7. Connect Sillage (API + MCP — buying-intent signals)

Sillage (getsillage.com) is a **GTM buying-intent signals** platform: give it a
target **account** (company name + domain) and it returns buying signals — hiring
moves, champion job-changes, competitor engagement, funding, social/news — with a
priority score. The connector is wired and **activates from env**; it calls Sillage
**MCP-first, REST-fallback**, and fails open (a Sillage outage never breaks a
request).

Set these (Key Vault → Container App env for `api`):

```
SILLAGE_API_KEY=              # REST bearer key
SILLAGE_API_BASE_URL=         # optional; defaults to https://api.getsillage.com
SILLAGE_REST_SIGNALS_PATH=    # optional; REST endpoint path, defaults to /v1/accounts/signals
SILLAGE_MCP_URL=              # Sillage MCP server endpoint
SILLAGE_MCP_BEARER_TOKEN=     # optional; if the MCP endpoint needs auth
SILLAGE_MCP_TIMEOUT_MS=       # optional; request timeout
SILLAGE_MCP_SIGNALS_TOOL=     # optional; defaults to 'account_signals'
```

- Configure **either** the REST key **or** the MCP URL (or both — MCP is tried
  first). With neither set, the connector is "disabled" and returns no signals;
  nothing breaks.
- Endpoint: `POST /api/v1/sillage/account-signals` (org-scoped, RBAC-gated), body
  `{ companyName?, domain? }` → `{ signals: Trigger[], intentScore, source }`.
- Output is shaped as the app's existing **`Trigger`** type, and Sillage signals
  are **already wired into the opportunity "Buying triggers" card**
  (`opportunityDetail/IntelCards.tsx`, merged server-side by
  `lib/sillage-intel-augment.ts` behind a 1.5s fail-open race — a slow or down
  Sillage never delays the opportunity read). Sillage categories map to trigger
  kinds (hiring→hiring, champion move→executive_move, competitor→deal_activity,
  funding→funding, social/news→press).
- The MCP client **negotiates the protocol version** at initialize and **reuses
  the session** across lookups (one round trip per call after warm-up, re-inits
  once on session expiry). SSE and JSON responses both handled.
- Shows up in **Settings → Integrations** with a health badge, and the
  **"Test now"** probe performs a REAL connectivity check (MCP initialize
  round trip, or a REST call when only the API key is set) reporting lane +
  latency — credential presence alone no longer reads as "healthy".
- **The REST endpoint path + payload shape are a documented guess** (Sillage has
  no public API docs yet): default `POST {base}/v1/accounts/signals`. When you get
  the real contract, set `SILLAGE_REST_SIGNALS_PATH` (and `SILLAGE_API_BASE_URL`
  if needed) — pure config, no code change. The MCP lane is spec-correct and is
  the recommended integration path. The MCP tool name is the
  `SILLAGE_MCP_SIGNALS_TOOL` env var.

---

## 8. Recommended follow-ups (not blockers)

- **Validate the Bicep** on a real subscription (`az bicep build` + `what-if`) —
  the IaC has never been exercised; treat API versions/property names as suspect
  until it passes (its README says the same).
- Land the native **azure-blob** storage driver (§1) so you're not carrying an
  S3-compat shim.
- **Decide the production domain.** The marketing site still points at
  `bidstack.dev` everywhere (canonical/OG URLs, footer links, sign-in CTAs,
  `hello@bidstack.dev`) — swap once the Polo PreSales domain exists.
- Extend Sillage intent beyond the Buying-triggers card (copilot / workflow /
  routing) if the signals prove valuable.
- Add **CDN cache rules** + immutable asset headers on the web origin.
- Turn on **Rolling Releases / canary** at Front Door for safer deploys.
- Add the deferred **tenant-scope-guard** enforce-mode extension and a DB-level
  `parentId` acyclicity constraint (both tracked in `PROGRESS.md`).
- Purge the polluted dev/demo DB test-fixture accounts before a customer demo:
  `pnpm db:purge:demo -- --seed-org --demo-orgs --test-orgs` (dry-run; add
  `--apply` to delete). Full real-data flow: `docs/PRODUCTION_DATA_BOOTSTRAP.md`.
