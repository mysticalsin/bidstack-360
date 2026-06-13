# Azure deploy — ⚠️ UNVALIDATED DRAFT

> **Do not deploy this as-is.** These files (`main.bicep`, `deploy.workflow.yml.draft`)
> were authored from the validated `docker-compose.prod.yml` topology but have
> **not** been run through `az bicep build`, `az deployment group what-if`, or a
> real subscription. They are a reviewed starting point, not production IaC.
> Treat every API version, property name, and secret reference as suspect until
> validated against the checklist below.

The **validated, works-today** path is `docker-compose.prod.yml` at the repo
root — it provisions Postgres (pgvector) + Redis, runs the one-shot `migrate`
service, then boots api/worker/web/mcp with no hand-run prisma. This Azure draft
ports that same contract to Container Apps.

For the production Azure baseline and service decisions, read
`docs/AZURE_FOUNDATION.md` before changing this Bicep.

---

## Topology

| Resource                       | Purpose                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Log Analytics workspace        | Container Apps logs                                                                                                         |
| Key Vault                      | every secret (`DATABASE_URL`, `REDIS_URL`, `INTEGRATION_TOKEN_KEY`, `CLERK_SECRET_KEY`, storage) — read by managed identity |
| Postgres Flexible Server 16    | `azure.extensions=VECTOR,PGCRYPTO,PG_TRGM,CITEXT` (the migrations `CREATE EXTENSION` these)                                 |
| Azure Cache for Redis          | BullMQ queues, rate-limit + cache                                                                                           |
| Container Apps Job `…-migrate` | one-shot `prisma migrate deploy`; **runs to completion before apps roll**                                                   |
| Container App `…-api`          | Fastify API, external ingress :4000, `/readyz` + `/livez` probes                                                           |
| Container App `…-worker`       | BullMQ workers (OCR + python sidecar → 2Gi), no ingress                                                                     |
| Container App `…-mcp`          | MCP server, internal ingress :4001, health server :4003                                                                      |
| Container App `…-web`          | static nginx, external ingress :80                                                                                          |

The **zero-touch contract**: the deploy pipeline starts the migrate Job and
blocks until it `Succeeded`; only then does it roll the app revisions. A failed
migration stops the deploy before any app sees the new schema — same guarantee
as the compose `depends_on: service_completed_successfully`.

## Prerequisites (one-time)

1. Resource group + ACR.
2. A **user-assigned managed identity** with: `AcrPull` on the ACR, and
   `Key Vault Secrets User` on the Key Vault (RBAC). Pass its resource ID as
   `managedIdentityId`.
3. GitHub → Azure **OIDC** federated credential; repo secrets `AZURE_CLIENT_ID`,
   `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `VITE_CLERK_PUBLISHABLE_KEY`;
   repo vars `ACR_LOGIN_SERVER`, `AZURE_RG`, `NAME_PREFIX`.

## First deploy

```bash
az deployment group what-if -g <rg> -f infra/azure/main.bicep \
  -p namePrefix=bidstack-prod imageTag=<sha> acrLoginServer=<acr>.azurecr.io \
     managedIdentityId=<mi-resource-id> pgAdminLogin=<u> \
     pgAdminPassword=<***> integrationTokenKey=<***> clerkSecretKey=<***> \
     clerkPublishableKey=<pk> publicBaseUrl=https://app... publicApiUrl=https://api... \
     s3AccessKeyId=<***> s3SecretAccessKey=<***> s3Bucket=<b> s3Region=<r> \
     s3Endpoint=<optional> s3ForcePathStyle=false
# review what-if, then drop --what-if equivalent: `az deployment group create ...`
```

Then move `deploy.workflow.yml.draft` → `.github/workflows/deploy.yml` (maintainer-approved) for subsequent pushes.

## Validation checklist (do all before trusting this)

- [ ] `az bicep build -f infra/azure/main.bicep` compiles with no errors/warnings.
- [ ] Pin + verify every `apiVersion` against `az provider show` (App, DBforPostgreSQL, Cache, KeyVault, OperationalInsights are moving targets).
- [ ] **Secrets**: confirm Container Apps Key Vault secret references with a user-assigned identity use the exact `{ name, keyVaultUrl, identity }` shape for the chosen API version (this is the #1 thing that drifts).
- [ ] `redis.listKeys()` / `law.listKeys()` at deploy-time vs a dedicated `listKeys` resource function — confirm they resolve under the current Bicep linter.
- [ ] Networking: replace the `0.0.0.0` "allow all Azure" Postgres firewall rule with VNet integration + private endpoint for production.
- [ ] Confirm `DATABASE_URL` `sslmode=require` works with the Flexible Server cert chain from inside Container Apps.
- [ ] Health probe paths: API exposes `/readyz` + `/livez`; worker exposes `/health` on 4002; MCP serves traffic on 4001 and `/health` on 4003.
- [ ] Object storage: current code requires S3-compatible storage variables (`S3_*`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) or a new Azure Blob adapter.
- [ ] Job→apps ordering is enforced by the **pipeline** (migrate job gates roll-apps), not by bicep `dependsOn` (which only orders creation). Confirm the pipeline poll loop's terminal states match `az containerapp job execution` output.
- [ ] Cost/scale: SKUs (`Standard_D2ds_v5`, Redis C1) and min/max replicas are placeholders — right-size them.

## Demo-feedback program constraints (2026-06-12)

- **All sensitive config rides env vars** — no hardcoded endpoints/keys anywhere
  in the app. New variables (see `.env.example`): `WIN_LOSS_DATA_AVAILABLE`,
  `SHOW_REVENUE_BLOCK`, `INFOSEARCH_ENABLED` + `INFOSEARCH_MCP_URL`/`INFOSEARCH_API_KEY`,
  `LMS_360L_ENABLED` + `LMS_360L_BASE_URL`/`LMS_360L_API_KEY`. Flags are served
  to the SPA at runtime via `GET /api/v1/config/features`, so a flag flip is a
  Container App restart — not an image rebuild. Secrets belong in Key Vault
  like every other secret above.
- **Security validation gate:** the app must run end-to-end on mock/seed data
  only until the group security team validates the Azure deployment. Concretely:
  keep ABC/Opportunity-Management connectors disconnected (they do not exist
  yet), keep `DEMO_MODE` seed data, and do not load real client data. The
  access-scoping layer (Settings → Access groups) must be configured and
  reviewed as part of that validation before any real-tenant rollout.

## Known gaps (intentionally not modelled)

- Custom domains + managed certs (api/web ingress).
- Autoscale rules beyond replica bounds (e.g. queue-length KEDA scaler for the worker).
- Backups/restore runbook, alerting, dashboards.
- VNet + private endpoints (strongly recommended for prod; the draft uses public + firewall for brevity).
