# Deploying BidStack 360° to real production (Mantu bid teams)

This is the **real-tenant** production runbook: authenticated Mantu users, Clerk
organization auth, per-tenant data isolation. It is distinct from `DEPLOY.md`,
which deploys the **public passwordless demo** (`DEMO_MODE`). The two modes are
mutually exclusive and the API refuses to boot if both `DEMO_MODE=true` and
`CLERK_SECRET_KEY` are set.

> Audience: whoever owns the Mantu deployment + secrets. Several steps require
> credentials and infra access that only you hold — those are called out as
> **[operator action]**.

---

## 1. Topology

```
Mantu users ─▶ web SPA (Vercel or Railway `web` target)   VITE_AUTH_MODE=clerk
                  │  Bearer <Clerk session JWT>   fetch(VITE_API_URL + /api/v1/...)
                  ▼
   Railway (or any container host) project
     ├─ api      (Dockerfile target: api)     ← public, port 4000, Clerk-verified
     ├─ worker   (Dockerfile target: worker)  ← private (enrichment, RFP pipeline, webhooks)
     ├─ Postgres 16 (+ pgvector)
     └─ Redis 7
```

The `api`/`worker` images are built `--prod` and **omit the Prisma CLI on
purpose**, so database migrations are a deliberate, explicit release step (see
§4) — they do **not** run automatically on container boot. This is intentional
for multi-replica safety; never auto-migrate from N replicas at once.

---

## 2. Backend env vars (set on **both** `api` and `worker` unless noted)

| Var | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production`. Gates off stub auth entirely. |
| `DATABASE_URL` | yes | Postgres 16 connection string (pooled). |
| `REDIS_URL` | yes | Redis 7. BullMQ queues + caches. |
| `CLERK_SECRET_KEY` | yes | Enables real auth. Its presence is what turns Clerk on. |
| `PUBLIC_BASE_URL` | yes | The SPA origin, e.g. `https://crm.mantu.com`. **Required in production** (the API throws on boot/verify without it) — used both as the CORS allowlist and the Clerk `authorizedParties` audience. |
| `INTEGRATION_TOKEN_KEY` | yes | 32-byte hex (`openssl rand -hex 32`). Encrypts per-org integration secrets at rest. Required in prod. |
| `BIDSTACK_JOB_SIGNING_SECRET` | yes | 32-byte hex. **Same value on api + worker.** HMAC-signs enrichment jobs; the worker rejects unsigned jobs. |
| `SSO_ALLOWED_EMAIL_DOMAINS` | recommended | Comma-separated allowlist, e.g. `mantu.com,amaris.com`. Rejects sign-ins from any other email domain even if Clerk's dashboard allows broader providers. Leave unset only if you intend to allow any Clerk-authenticated domain. |
| `STORAGE_DRIVER` | yes | `s3` for production file storage (uploads, generated docs). `local` is demo-only. |
| `S3_*` | if `s3` | Bucket/region/access creds for the storage driver. |
| `SENTRY_DSN` | recommended | Error monitoring. |
| `RFP_LLM_PROVIDER` + provider key | optional | e.g. `openai` + `OPENAI_API_KEY` for the live RFP AI pipeline; omit for deterministic fallbacks. |
| `APOLLO_API_KEY` | optional | Live company enrichment. |
| `DEMO_MODE` | **must be unset / false** | The API refuses to boot if this is `true` while `CLERK_SECRET_KEY` is set. |

**[operator action]** Generate every secret yourself; never commit them. Keep
`BIDSTACK_JOB_SIGNING_SECRET` and `INTEGRATION_TOKEN_KEY` identical across
api+worker and stable across deploys (rotating `INTEGRATION_TOKEN_KEY` makes
previously-encrypted integration secrets unreadable).

## 3. Frontend env vars (build-time, inlined)

| Var | Value |
| --- | --- |
| `VITE_AUTH_MODE` | `clerk` |
| `VITE_CLERK_PUBLISHABLE_KEY` | your Clerk publishable key (the SPA throws at startup if `VITE_AUTH_MODE=clerk` and this is missing) |
| `VITE_API_URL` | the public `api` URL, e.g. `https://api.crm.mantu.com` |

---

## 4. Database migrations (explicit release step)

**[operator action]** Run once per deploy whose migrations changed, against the
production database, from a machine that has the repo + Prisma CLI:

```bash
DATABASE_URL="<prod postgres url>" pnpm --filter @bidstack/db migrate:deploy
```

- `pgvector` must exist: `CREATE EXTENSION IF NOT EXISTS vector;` (once).
- **Pending migration to deploy now:** `20260613160000_yjs_updates_created_at_index`
  (Yjs compaction index from the security hardening pass — see ISSUES.md #16). It
  is committed but not yet applied to live environments.
- Prefer a one-off `migrate` Docker target (it exists) as a release job over
  auto-migrating from the long-running api/worker replicas.

---

## 5. Per-tenant onboarding (the one non-obvious step)

Clerk JIT-provisioning creates **users** on first sign-in, but **not
organizations**. If a user signs in whose Clerk `org_id` has no matching `Org`
row, the API returns `404 Organization not registered` and they cannot enter.

So for each Mantu tenant, **[operator action]** before their first sign-in:

1. Create the Clerk organization; note its `org_id` (`org_...`).
2. Create the matching `Org` row with `clerkOrg = <that org_id>` and seed its
   RBAC roles/permissions (the 6 system roles: Admin, Sales Manager, Account
   Executive, SDR, Read-Only, plus permissions). Use the existing seed/admin
   path for role+permission creation rather than hand-inserting.
3. Map Clerk org roles to BidStack roles via Clerk org metadata — the API maps
   the Clerk `org_role` claim on every login (unknown roles are rejected with an
   audited `auth.login_failed`).
4. Clerk org-admins automatically receive an `Admin` role grant on first login.

After that, every member of that Clerk org self-provisions on first sign-in with
the role Clerk reports.

---

## 6. Verification checklist

- [ ] `GET /readyz` returns `200` with `{db:true, redis:true, storage:true}`.
- [ ] Boot logs show `Clerk auth enabled` (NOT `AUTH STUB MODE` / `AUTH DEMO MODE`).
- [ ] A Mantu user signs in via Clerk and lands in their org's workspace.
- [ ] A user from a non-allowlisted email domain is rejected (if `SSO_ALLOWED_EMAIL_DOMAINS` set).
- [ ] Two different Clerk orgs see fully isolated data (tenant isolation smoke).
- [ ] A custom role without `reports:read` / `accounts:read` is 403'd on those reads (RBAC gate smoke).
- [ ] An outbound webhook to an internal/private IP host is refused (SSRF guard).

---

## 7. Known production gaps / operator follow-ups

- **WebSocket realtime/collab** (live cursors, presence) needs same-origin or a
  WS-aware proxy; the REST app is unaffected if it doesn't traverse.
- **PDF export** (puppeteer) needs system Chromium; the slim `api` image omits
  it. Add Chromium to the image or run export in a worker with it installed.
- **Access groups** (country-scoped visibility) are a v1 list-visibility feature,
  not a hard authorization boundary — cross-replica scope invalidation is now
  broadcast over Redis pub/sub (≤ pub/sub latency), but do not market access
  groups as a data-access control.
- Multi-replica deployments rely on Redis for cache coherency; run at least the
  documented `replicas` with a shared Redis.
