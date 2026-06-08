# Azure Production Foundation

BidStack 360 is moving to Azure for online hosting. This document is the deployment
baseline until the Azure IaC is validated in a real subscription.

## Target Architecture

```text
Internet
  |
Azure Front Door + WAF
  |
  +-- Web Container App / Static Web App
  |
  +-- API Container App  -> Azure Database for PostgreSQL Flexible Server
  |                      -> Azure Cache for Redis
  |                      -> S3-compatible durable object storage
  |                      -> Key Vault
  |
  +-- MCP Container App  -> PostgreSQL + Redis
  |
  +-- Worker Container App -> PostgreSQL + Redis + durable object storage
  |
  +-- Container Apps Job: migrate -> prisma migrate deploy
```

## Azure Services

| Layer | Azure choice | BidStack requirement |
| --- | --- | --- |
| Containers | Azure Container Apps | Separate `api`, `worker`, `mcp-server`, `web`, and `migrate` images. |
| Registry | Azure Container Registry | Images are tagged with the git SHA and pulled by managed identity. |
| Database | Azure Database for PostgreSQL Flexible Server | PostgreSQL 16, pgvector allow-list, HA enabled for production regions. |
| Cache/queues | Azure Cache for Redis | Required for BullMQ, idempotency, API/MCP rate limits, and shared cache. |
| Secrets | Azure Key Vault | Container Apps read secrets through managed identity. No `.env` secrets in CI. |
| Logs/traces | Log Analytics + Application Insights/OpenTelemetry | Request, worker, queue, MCP, and RFP traceability. |
| Edge | Azure Front Door + WAF | TLS, custom domains, WAF, global routing, and cache policy. |
| Storage | S3-compatible storage today; Azure Blob adapter later | Current code supports `STORAGE_DRIVER=s3`, not native Blob. |

## Non-Negotiable Runtime Contract

- API liveness probe: `GET /livez`.
- API readiness probe: `GET /readyz`; must check DB, Redis, and durable storage config.
- Worker health probe: `GET /health` on `WORKER_HEALTH_PORT` default `4002`.
- MCP ingress: `PORT_MCP=4001`; MCP health: `GET /health` on `MCP_HEALTH_PORT=4003`.
- Migrations run as an Azure Container Apps Job and must succeed before app revisions roll.
- Production storage must be durable. `STORAGE_DRIVER=local` is dev/demo only.
- API and MCP can scale horizontally only with Redis-backed rate limits and idempotency.
- Worker replicas can scale horizontally, but OCR/RFP load needs queue-depth autoscaling and memory limits.

## Storage Decision

The current storage implementation uses the AWS SDK S3 contract:

- `STORAGE_DRIVER=s3`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT`
- `S3_FORCE_PATH_STYLE`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Azure Blob Storage is not wired yet. Do not point `STORAGE_DRIVER=s3` at plain
Azure Blob and call it done. Either:

1. Add a native Azure Blob storage adapter and worker reader, then support
   `STORAGE_DRIVER=azure-blob`, or
2. Use an S3-compatible object layer with private networking until the Blob
   adapter lands.

## Deployment Flow

1. Build all images from the same commit: `api`, `worker`, `mcp-server`, `web`, `migrate`.
2. Push to ACR with tag `${GIT_SHA}`.
3. Update and run the `migrate` Container Apps Job.
4. Poll the job to `Succeeded`; fail the release on `Failed`, `Degraded`, or timeout.
5. Roll API, worker, MCP, and web revisions.
6. Verify `/readyz`, worker `/health`, MCP `/health`, and a browser smoke test.
7. Keep the previous revision available until smoke and canary checks pass.

## First Azure Validation Checklist

- `az bicep build -f infra/azure/main.bicep` passes.
- `az deployment group what-if` is reviewed before create/update.
- Key Vault secret references resolve with the selected user-assigned managed identity.
- PostgreSQL Flexible Server has `VECTOR,PGCRYPTO,PG_TRGM,CITEXT` allow-listed before migrations.
- PostgreSQL HA and backup retention are enabled for production.
- Redis requires TLS and is reachable from Container Apps.
- API readiness fails when DB, Redis, or durable storage config is unavailable.
- MCP ingress routes to `4001`, not the `4003` health server.
- RFP upload -> storage -> worker parse path succeeds with production storage.
- A 2-replica API test confirms idempotency, rate limits, uploads, and sessions stay stable.

## Source Notes

- Microsoft documents separate liveness, readiness, and startup probes for Azure
  Container Apps; readiness controls whether a replica receives traffic.
- Microsoft documents Container Apps managed identity for Azure resource access,
  including Key Vault-backed secrets.
- Microsoft documents Container Apps Jobs for manual or event-triggered one-off
  and background work, which fits the migration job.
- Microsoft documents PostgreSQL Flexible Server high availability and backup
  choices; production should not run with single-node assumptions.
