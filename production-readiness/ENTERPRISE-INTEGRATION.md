# BidStack 360° — Connecting to the Mantu Enterprise Environment

**Created:** 2026-06-29 · **Audience:** Mantu IT / Security / Platform · **Pairs with:**
`REMAINING-TO-PRODUCTION.md` (readiness checklist), `docs/AZURE_FOUNDATION.md`,
`docs/MICROSOFT_ENTRA_INTEGRATION.md`, `DEPLOY.production.md`.

This is the **integration map**: every point where BidStack 360° must plug into Mantu's existing enterprise
systems, what Mantu has to provision, the exact env wiring, and who owns it. The *code* for each integration
is built and committed — what's "missing" is the **enterprise-side provisioning + credentials + decisions**.

Legend — **REQUIRED** = the app refuses to boot in production without it (enforced in `apps/api/src/env.ts`);
**RECOMMENDED** = needed for a real launch; **OPTIONAL** = feature-flagged, off by default.

---

## 0. The one decision that gates everything: identity

**Production authentication runs through Clerk.** There is no direct-to-Entra path in the code today — the
only production auth provider is Clerk (`CLERK_SECRET_KEY`); the alternatives are the dev stub and the public
demo door, neither of which is for a real tenant. The corporate sign-in flow is:

```
Mantu user → Microsoft Entra ID (your IdP) → Clerk (SAML/OIDC enterprise connection) → BidStack
```

**What Mantu must decide first (DECISION — blocks the identity wiring):**
- **Accept Clerk as an identity subprocessor** (corporate identities transit Clerk), **OR**
- **Fund a direct Entra OIDC adapter** in `apps/api/src/plugins/auth.ts` (removes the Clerk dependency — this
  is net-new code, not configuration).

Everything in §1 assumes the Clerk-mediated path (the built one).

---

## 1. Identity & SSO — Microsoft Entra ID via Clerk — **REQUIRED**

| Mantu provides | Where it goes |
| --- | --- |
| A Clerk application (or approval to use one) | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET` |
| An Entra **Enterprise Application** (SAML or OIDC) for BidStack | wired into Clerk's Enterprise Connection (no app env) |
| Verified corporate domain(s) | `SSO_ALLOWED_EMAIL_DOMAINS=mantu.com,…` (defense-in-depth domain lock) |
| Entra group → role mapping | Clerk role mapping → `mapClerkRole()` in `apps/api/src/plugins/auth.ts` |

**Steps (per `docs/MICROSOFT_ENTRA_INTEGRATION.md`):**
- [ ] Register a single-tenant Enterprise App in Entra; configure SAML/OIDC reply URL to the Clerk callback.
- [ ] Add the Entra connection to Clerk (Enterprise Connections), bound to the Mantu email domain.
- [ ] Assign the approved Entra users/groups to the app.
- [ ] Set `VITE_SSO_MICROSOFT_ENABLED=true` + `SSO_ALLOWED_EMAIL_DOMAINS`.
- [ ] Map Entra groups → BidStack roles (admin / bid_manager / account_exec / viewer …) and extend
      `mapClerkRole()` for any custom roles.
- [ ] Add the production domain to Clerk `authorizedParties` in the API auth plugin.
- **Note:** users are **JIT-provisioned** on first sign-in (no manual user inserts), but **the org must exist
  first** — seed it or create it via onboarding, else users see "Organization not registered."
- **Verify:** corporate user signs in via Microsoft → lands on the dashboard; an out-of-domain email is rejected.

---

## 2. Hosting & network — Azure — **REQUIRED**

Target architecture is **Azure Container Apps** behind **Front Door + WAF** (`docs/AZURE_FOUNDATION.md`). Five
images from one commit: `api`, `worker`, `mcp-server`, `web`, `migrate` (a Container Apps Job).

| Mantu provides | Notes |
| --- | --- |
| Azure subscription + resource group | `infra/azure/main.bicep` is a **draft, never validated** — `az bicep build` + `what-if` first |
| Azure Container Registry | images tagged `${GIT_SHA}`, pulled by **managed identity** (no registry creds in CI) |
| Front Door + WAF + custom domain + TLS cert | `PUBLIC_BASE_URL=https://…` (must be https + non-loopback or boot fails) |
| Private networking (VNet) DB/Redis/storage | no public DB/admin; restrict egress |
| Egress allowlist for outbound providers | Clerk, Dust, Google/Microsoft Graph, Twilio, Apollo, ERP, 360Learning |

**Runtime contract (non-negotiable):** API `/livez` + `/readyz` (checks DB+Redis+storage); worker `/health`
(`WORKER_HEALTH_PORT` 4002); MCP ingress `PORT_MCP=4001`, health `MCP_HEALTH_PORT=4003`; the `migrate` job must
reach `Succeeded` before app revisions roll. Horizontal scaling **requires** Redis-backed rate limits/idempotency.

---

## 3. Database — Azure Database for PostgreSQL Flexible Server — **REQUIRED**

| Mantu provides | Where it goes |
| --- | --- |
| PostgreSQL 16 Flexible Server (HA, backups) | `DATABASE_URL` (+ `SHADOW_DATABASE_URL` for migrations) |
| Extension allow-list **before** migrations | `VECTOR, PGCRYPTO, PG_TRGM, CITEXT` (the RFP vector index migration needs `vector`) |
| Automated backups + PITR | see `REMAINING-TO-PRODUCTION.md` B2 — currently unproven |

- [ ] Provision PG16 + allow-list extensions + enable HA + automated backups/PITR.
- [ ] Run migrations via the safe guard: `pnpm db:migrate:deploy` (`run-safe-migrate-deploy.mjs` refuses a
      staging/prod migrate without a fresh encrypted backup proof).

---

## 4. Cache / queues — Azure Cache for Redis — **REQUIRED**

`REDIS_URL` (TLS, non-loopback, **shared across all API/worker replicas**). Backs BullMQ jobs, API/MCP rate
limits, idempotency, outbound email/SMS spend caps, OAuth refresh locks, and cache invalidation. In production
the app **fails closed** if rate-limit/outbound Redis is missing (`RATE_LIMIT_REDIS_REQUIRED`,
`OUTBOUND_COMM_REDIS_REQUIRED` default `true`) — a per-process fallback would let the global limit be multiplied
by the replica count.

---

## 5. Object storage — S3-compatible — **REQUIRED** (prod)

Stores RFP/proposal documents. `STORAGE_DRIVER=s3` + `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`,
`S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
- ⚠️ **Azure Blob is NOT wired.** Do not point `STORAGE_DRIVER=s3` at plain Azure Blob. Either use an
  S3-compatible object layer with private networking, or fund the native `azure-blob` adapter (net-new code).
- [ ] Provision the bucket with block-public-access + versioning + object-lock + SSE + replication (§H2).

---

## 6. Secrets & encryption keys — Azure Key Vault — **REQUIRED**

Container Apps read secrets via **managed identity** — no `.env` secrets in CI. Mantu must **generate and store**:

| Secret | Purpose | Generate |
| --- | --- | --- |
| `INTEGRATION_TOKEN_KEY` | AES-256-GCM for per-org Dust + OAuth tokens at rest | 64-char hex |
| `PII_ENCRYPTION_MASTER_KEY` | AES-256-GCM for Contact/Lead/KamConsultant PII | 64-char hex |
| `BIDSTACK_JOB_SIGNING_SECRET` | HMAC, shared api↔worker for enrichment jobs | random ≥32B |
| `DEMO_SESSION_SECRET` | only if running demo mode (not for a real tenant) | random ≥32B |
| All provider keys below | per integration | from each provider |

`openssl rand -hex 32` produces a valid 64-char hex key. **Rotate** on the schedule in
`scripts/rotate-integration-tokens.ts`.

---

## 7. Email & calendar — Google Workspace / Microsoft 365 — **RECOMMENDED**

Outbound email + calendar sync. Both are OAuth apps Mantu registers in its own tenant.
- **Gmail / Google Workspace:** OAuth client + admin consent for the send/calendar scopes.
- **Microsoft Graph (M365):** App registration + admin-consented Mail.Send / Calendars scopes.
- Outbound is abuse/spend-capped (`OUTBOUND_EMAIL_DAILY_*`, daily Redis counters) and timeout-bounded
  (`GMAIL_HTTP_TIMEOUT_MS`, `GOOGLE_HTTP_TIMEOUT_MS`, `OAUTH_HTTP_TIMEOUT_MS`, …).
- [ ] Register the OAuth app(s), grant admin consent, store client id/secret in Key Vault, set the from-identity.

---

## 8. AI providers — Dust + direct models — **RECOMMENDED**

The RFP/agent automation runs on **Dust** (Mantu's AI workspace) and/or direct model keys.
- **Dust:** `DUST_API_KEY`, `DUST_WORKSPACE_ID`, `DUST_DATA_SOURCE_ID`, `DUST_WEBHOOK_SECRET`,
  `DUST_BASE_URL`, `DUST_MCP_PUBLIC_URL`.
- **Direct provider keys** are added per-org in Settings → Integrations → AI & Agents (encrypted with
  `INTEGRATION_TOKEN_KEY`), so individual tenants can bring their own model keys under Mantu AI governance.
- [ ] Decide the Mantu AI-governance posture (Dust tenant vs direct keys) and provision the Dust workspace.

---

## 9. ERP / financial — Odoo / ERP (via MCP) — **OPTIONAL** (flag-gated)

Quote/invoice/financial sync. Direct (`ERP_URL`, `ERP_DB`, `ERP_API_KEY`, `ERP_USER`, `ERP_PASSWORD`) or via an
MCP bridge (`ERP_MCP_URL` + `ERP_MCP_BEARER_TOKEN`); `ODOO_*` equivalents exist.
- [ ] Point at Mantu's real ERP instance + service account, or leave the flag off.

---

## 10. 360Learning (LMS) — **OPTIONAL** (flag-gated) — Mantu-owned

`LMS_360L_ENABLED=true` requires `LMS_360L_BASE_URL` + `LMS_360L_API_KEY` (fails closed otherwise). Since Mantu
owns 360Learning, this is a natural enterprise tie-in for enablement content.

---

## 11. Telephony / SMS — Twilio — **OPTIONAL** (flag-gated)

Outbound SMS + call review. Mantu Twilio account SID/auth token + from-number. Spend-capped
(`OUTBOUND_SMS_DAILY_ORG_COST_CAP_MICROS`) and timeout-bounded. Inbound webhook signature verification required.

---

## 12. Enrichment & other — **OPTIONAL**

- **Apollo** (`APOLLO_API_KEY`) — company/contact enrichment (worker). Bounds credit usage.
- **InfoSearch** (`INFOSEARCH_MCP_URL` + `INFOSEARCH_API_KEY`), **Slack**, **HubSpot** (`HUBSPOT_*`) — all
  feature-flagged, fail closed when enabled without credentials.

---

## 13. Observability & SIEM — **RECOMMENDED**

- **Sentry** org + DSN (API + worker + web; `sendDefaultPii:false`, PII scrubbed in `beforeSend`).
- **Application Insights / OpenTelemetry + Log Analytics** for request/worker/queue/MCP traces.
- [ ] Ship logs to Mantu's **SIEM**; validate log redaction shows no PII; wire app-level alerts (5xx, p95,
      availability, queue depth) and on-call paging (§H7).

---

## 14. Compliance / data-governance sign-offs (Security + Legal)

- [ ] **Subprocessor register** — Clerk (identity), Dust (AI), Twilio, Apollo, Google/Microsoft, Sentry, the
      cloud provider. Each needs a DPA + data-flow entry.
- [ ] **Data residency** — pin Azure region(s) for DB, Redis, storage, backups to Mantu's required geography.
- [ ] **PII decisions** — `User.email` storage-only vs `emailHash`; plaintext-at-rest sign-off for SMS bodies,
      calendar/activity attendees, KamSession transcripts (see `REMAINING-TO-PRODUCTION.md` D1/D3).
- [ ] **Retention** — confirm retention/erasure policy vs the built erasure/export routes.

---

## Connection matrix (quick reference)

| # | System | Mantu provides | Required? | Boot-blocks if missing? |
| - | --- | --- | --- | --- |
| 1 | Entra ID + Clerk | Enterprise App + Clerk app + domain | REQUIRED | yes (no auth) |
| 2 | Azure hosting | subscription, ACR, Front Door/WAF, VNet, TLS domain | REQUIRED | yes (`PUBLIC_BASE_URL` https) |
| 3 | PostgreSQL 16 | Flexible Server + extensions + backups | REQUIRED | yes (`DATABASE_URL`) |
| 4 | Redis | Azure Cache for Redis (TLS, shared) | REQUIRED | yes (`REDIS_URL`) |
| 5 | Object storage | S3-compatible bucket (or fund Blob adapter) | REQUIRED | yes (`STORAGE_DRIVER=s3`) |
| 6 | Key Vault + keys | generate 3 crypto keys + store all secrets | REQUIRED | yes (3 key checks) |
| 7 | Email/Calendar | Google/M365 OAuth apps | RECOMMENDED | no |
| 8 | Dust / models | Dust workspace or direct keys | RECOMMENDED | no |
| 9 | ERP/Odoo | instance + service account | OPTIONAL | only if flag on |
| 10 | 360Learning | base URL + API key | OPTIONAL | only if flag on |
| 11 | Twilio | account + from-number | OPTIONAL | only if used |
| 12 | Apollo/InfoSearch/Slack/HubSpot | provider keys | OPTIONAL | only if flag on |
| 13 | Sentry + SIEM | org/DSN + log pipeline | RECOMMENDED | no |
| 14 | Compliance | DPAs, residency, retention sign-off | REQUIRED (launch) | no |

**Minimum to stand up an internal Mantu instance:** rows **1–6** (identity, Azure, Postgres, Redis, storage,
Key Vault) + the `REMAINING-TO-PRODUCTION.md` blockers (B1 PII backfill, B2 backups). Rows 7–13 light up the
integrations as Mantu provisions each provider; row 14 gates external/customer data.
