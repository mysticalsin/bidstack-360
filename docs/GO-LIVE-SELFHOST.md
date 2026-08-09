# BidStack 360° — Production go-live (self-hosted API + managed cloud data)

This is the path you chose: the **API and worker run on this PC** behind a
**stable Cloudflare tunnel**, your **data lives in managed cloud services**
(automatic backups, survives your machine being off for reads/writes only while
the PC is on), authentication is **real (Clerk)** with **team invitations**, and
the web app is served from **Vercel's CDN**.

```
  your team ──▶ https://app.<your-domain>      SPA on Vercel (Clerk sign-in)
                     │  calls https://api.<your-domain>
                     ▼
        Cloudflare named tunnel  (stable hostname, never changes)
                     │
                     ▼
        THIS PC:  API (Fastify) + worker (BullMQ)
                     │
        ┌────────────┼───────────────┬──────────────┐
        ▼            ▼               ▼              ▼
   Neon Postgres  Upstash Redis   Cloudflare R2   Clerk
   (data)         (queues/cache)  (file uploads)  (auth + invites)
```

Everything except five account signups is automated. Budget ~30–40 minutes for
the one-time setup; after that, going live (or updating) is a single command.

---

## What you provide (one-time, five accounts — all have free tiers)

You only need to **create the accounts and paste values** into one file. I've
already generated the app's own encryption/signing secrets for you.

### 1. Neon — Postgres (your data)
1. Sign up at neon.tech → **New Project**.
2. In the project's SQL editor run once: `CREATE EXTENSION IF NOT EXISTS vector;`
   (the schema uses pgvector; Neon supports it).
3. Copy the **connection string** (the pooled one, `...-pooler...`), ensure it
   ends with `?sslmode=require`. → `DATABASE_URL`

### 2. Upstash — Redis (queues, rate limits, locks)
1. Sign up at upstash.com → **Create Database** (Regional, pick a nearby region).
2. Copy the **TLS** URL (starts with `rediss://`). → `REDIS_URL`

### 3. Clerk — authentication + team invitations
1. Sign up at clerk.com → **Create application** (enable Email + any social you want).
2. **Organizations**: Configure → Organizations → **Enable**, and turn on
   **Invitations** (this is how you add teammates).
3. Create your organization (Organizations → create, name it your company). Copy
   its id (`org_...`). → `CLERK_ORG_ID`, and set `ORG_NAME` to the display name.
4. API Keys → copy **Publishable key** (`pk_...`) → `CLERK_PUBLISHABLE_KEY`, and
   **Secret key** (`sk_...`) → `CLERK_SECRET_KEY`.
5. Webhooks → **Add endpoint** → URL `https://api.<your-domain>/api/v1/webhooks/clerk`,
   subscribe to `user.*` and `organization*` events → copy the **Signing secret**
   (`whsec_...`) → `CLERK_WEBHOOK_SECRET`. (You can do this after step "Cloudflare
   tunnel" below, once the hostname exists.)

### 4. Cloudflare R2 — file storage (uploads, RFP documents)
1. In the Cloudflare dashboard → **R2** → create a bucket. → `S3_BUCKET`
2. R2 → **Manage API Tokens** → create an **S3-compatible** token (Object
   Read & Write). → `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
3. Your endpoint is `https://<account-id>.r2.cloudflarestorage.com`. → `S3_ENDPOINT`

### 5. Cloudflare named tunnel — the stable public URL
Needs a domain on Cloudflare (you already have `bidstack.dev` there; any zone works).
Run these once on this PC:
```bash
cloudflared tunnel login                      # opens a browser; pick your domain
cloudflared tunnel create bidstack            # creates the tunnel + credentials
cloudflared tunnel route dns bidstack api.<your-domain>
```
Then create `~/.cloudflared/config.yml` (path shown by `cloudflared tunnel info`):
```yaml
tunnel: bidstack
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-uuid>.json
ingress:
  - hostname: api.<your-domain>
    service: http://localhost:4100
  - service: http_status:404
```
Set `PUBLIC_API_URL=https://api.<your-domain>` and `CF_TUNNEL_NAME=bidstack`.

For the **web** URL (`PUBLIC_BASE_URL`), use your Vercel project's domain (e.g.
`https://app.<your-domain>` or the `*.vercel.app` URL). This is what your team opens.

---

## Fill the env, then go live

```bash
# 1. Create the env file (app-owned secrets are generated for you):
node scripts/gen-prod-secrets.mjs

# 2. Open .env.production.local and paste the values from the five steps above.
#    (It's gitignored — never commit it.)

# 3. Go live — migrates the cloud DB, seeds your org + roles, builds & runs the
#    API + worker here, opens the tunnel, and deploys the SPA:
node scripts/go-live-selfhost.mjs
```

When it finishes you'll see `LIVE — https://app.<your-domain> → https://api.<your-domain>`.
Open the web URL, sign in with the email you'll make an admin, and you're in with
real, persistent data.

> First admin: the first Clerk **organization admin** who signs in is granted the
> app's **Admin** role automatically (JIT). Everyone else gets roles you assign in
> Settings → Roles.

---

## Invite your team

1. In **Clerk → Organizations → your org → Members → Invite**, enter their emails.
2. They accept the email invite, land on your web URL, and sign in — a workspace
   user is provisioned automatically on first sign-in, in **your** org (shared
   data, not a separate copy).
3. In the app, **Settings → Team / Roles**, assign each person a role
   (Admin, Sales, Presales, etc.) — that controls what they can see and edit.

---

## Survive reboots (auto-start)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
```
Registers a boot task that restarts the API + worker + tunnel from the existing
build (no rebuild). Test it without rebooting: `Start-ScheduledTask -TaskName BidStack360-Prod`.

> The API runs on this PC, so the app is reachable whenever this machine is on
> and online. Your **data** is safe in Neon/Upstash/R2 regardless. If you later
> want it reachable 24/7 independent of this PC, the same build deploys to a
> cloud host (Railway/Fly) — see `DEPLOY.md`.

---

## Day-2 operations

- **Update to a new version:** `git pull` then `node scripts/go-live-selfhost.mjs`
  (re-migrates safely, rebuilds, redeploys). For a running box that only needs a
  restart: `node scripts/go-live-selfhost.mjs --run-only`.
- **Ongoing DB migrations** (once you have real data): take a Neon snapshot
  first, then migrate — the repo's `pnpm db:migrate:deploy` is the fail-closed
  path that requires backup proof. On the fresh/empty DB at first go-live this
  step is safe automatically.
- **File uploads** land in your R2 bucket; **queues/rate-limits** use Upstash;
  **secrets + PII** are encrypted at rest with the generated keys — never rotate
  `INTEGRATION_TOKEN_KEY` or `PII_ENCRYPTION_MASTER_KEY` after data exists.

---

## Enterprise-readiness checklist (what "production" means here)

- [x] Real per-user auth + org invitations (Clerk), RBAC roles enforced server-side
- [x] Multi-tenant isolation guard (`BIDSTACK_TENANT_SCOPE_GUARD=enforce`)
- [x] Secrets + PII encrypted at rest (AES-256-GCM); unbounded-query guard on
- [x] Managed, backed-up data (Neon PITR, Upstash persistence, R2 durability)
- [x] Rate limiting + outbound send caps backed by shared Redis
- [x] Stable HTTPS URL (Cloudflare tunnel), CDN-served SPA
- [x] Health/readiness endpoints (`/health`, `/livez`, `/readyz`) for monitoring
- [ ] Optional but recommended: set `SENTRY_DSN` for error tracking; put the app
      behind Cloudflare Access if you want SSO/allowlist at the edge.
