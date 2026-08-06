# Deploying the BidStack 360° public demo

Hybrid hosting: **Vercel** serves the React app (the `vercel.app` URL you
share); **Railway** runs the API + worker + Postgres + Redis (so the RFP AI
pipeline and Apollo enrichment actually work — they can't run on Vercel).

```
visitor ─▶ bidstack.vercel.app         (SPA on Vercel, VITE_AUTH_MODE=demo)
                 │  fetch(VITE_API_URL + /api/v1/...)   [CORS]
                 ▼
   Railway project
     ├─ api      (Dockerfile target: api)     ← public, port 4000
     ├─ worker   (Dockerfile target: worker)  ← private, runs RFP pipeline + Apollo enrich
     ├─ Postgres (plugin)
     └─ Redis    (plugin)
```

Everyone who signs in gets their **own** freshly-seeded workspace (passwordless,
any email). The demo door is triple-gated (`DEMO_MODE=true`, no
`CLERK_SECRET_KEY`, `DEMO_SESSION_SECRET` set) so it can never arm on a real
tenant. Stale demo orgs auto-reap after `DEMO_ORG_TTL_HOURS`.

> Prereqs: the repo is already on GitHub (`mysticalsin/bidstack-360`, branch
> `demo`). You'll need a Railway account and a Vercel account. An Apollo API key
> is optional (accounts are pre-seeded with realistic data either way).

---

## Part A — Railway (backend)

1. **New Project → Deploy from GitHub repo** → `mysticalsin/bidstack-360`,
   branch `demo`.
2. **Add Postgres** (New → Database → PostgreSQL) and **Add Redis** (New →
   Database → Redis). Railway exposes `DATABASE_URL` and `REDIS_URL` as
   reference variables you can attach to the services below.
   - The schema uses `pgvector`; run `CREATE EXTENSION IF NOT EXISTS vector;`
     once in the Postgres instance (Railway → Postgres → Data/Query), or it's
     created by the first migration if your Postgres image bundles it.
3. **API service** — point it at this repo with **Dockerfile** builder, build
   **target `api`** (Settings → Build → Docker target). Networking → set the
   public port to **4000**. Add the env vars from the table below.
4. **Worker service** — add a second service from the same repo, Dockerfile
   builder, build **target `worker`**. No public port (it's a background
   process). Same env vars (it shares the DB/Redis + needs the Apollo + signing
   secrets).
5. **Run migrations once** (the `api`/`worker` images are `--prod` and omit the
   Prisma CLI on purpose). Easiest: from your machine, against the Railway
   Postgres URL —
   ```bash
   DATABASE_URL="<railway postgres connection string>" pnpm --filter @bidstack/db migrate:deploy
   ```
   (Re-run only when migrations change. Alternatively add a one-off Railway
   service built with Docker target `migrate`.)

### Railway env vars (set on **both** api + worker unless noted)

| Var                           | Value                                | Notes                                                                                              |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                    | `production`                         |                                                                                                    |
| `DATABASE_URL`                | _(reference Postgres)_               | from the PG plugin                                                                                 |
| `REDIS_URL`                   | _(reference Redis)_                  | from the Redis plugin                                                                              |
| `PUBLIC_BASE_URL`             | `https://<your>.vercel.app`          | **CORS allowlist** — set after Part B, then redeploy api                                           |
| `DEMO_MODE`                   | `true`                               | arms the public passwordless door                                                                  |
| `DEMO_SESSION_SECRET`         | _(generate: `openssl rand -hex 32`)_ | signs demo session tokens                                                                          |
| `DEMO_PUBLIC_DEPLOYMENT_ACK`  | `true`                               | **required** with `DEMO_MODE=true` + `NODE_ENV=production` — the api refuses to boot without it    |
| `BIDSTACK_JOB_SIGNING_SECRET` | _(generate: `openssl rand -hex 32`)_ | **same value on api + worker** — signs Apollo enrich jobs                                          |
| `APOLLO_API_KEY`              | _(your Apollo key)_                  | optional; enables **live** enrichment (employee count, revenue)                                    |
| `DEMO_AUTO_ENRICH`            | `false`                              | set `true` to auto-refresh each visitor's accounts from Apollo (uses Apollo credits)               |
| `DEMO_ORG_TTL_HOURS`          | `24`                                 | stale demo orgs reaped after this                                                                  |
| `DEMO_MAX_ORGS`               | `500`                                | capacity cap                                                                                       |
| `INTEGRATION_TOKEN_KEY`       | _(generate: `openssl rand -hex 32`)_ | required in prod (encrypts integration secrets at rest)                                            |
| `STORAGE_DRIVER`              | `s3` _(or `local`)_                  | prod defaults to s3; `local` works for a demo                                                      |
| `RFP_LLM_PROVIDER` + key      | _(optional)_                         | e.g. `openai` + `OPENAI_API_KEY` for the live RFP AI pipeline; omit to use deterministic fallbacks |
| `RFP_LLM_TIMEOUT_MS`          | `120000`                             | raise for slow providers                                                                           |

> **Do not set `CLERK_SECRET_KEY`** — the demo refuses to boot if both it and
> `DEMO_MODE=true` are present (mutual-exclusion gate). Generate every secret
> yourself; never commit them.

---

## Part B — Vercel (frontend)

1. **Add New → Project** → import `mysticalsin/bidstack-360`.
2. **Root Directory: `apps/web`** (Vercel will use `apps/web/vercel.json` for
   the build + SPA rewrite; it runs `build:demo`, which sets
   `VITE_AUTH_MODE=demo`).
3. **Environment variable:** `VITE_API_URL` = `https://<your-railway-api>` (the
   API service's public Railway URL). This is inlined at build time and prefixed
   onto every API request.
4. **Deploy.** Note the resulting `https://<your>.vercel.app` URL.

---

## Part C — Wire the two together

1. Put the **Vercel URL** into Railway → api → `PUBLIC_BASE_URL` and redeploy
   the api (this lets CORS accept the SPA's origin).
2. Confirm **Vercel** `VITE_API_URL` points at the **Railway api** URL.
3. That's the only cross-wiring — the SPA calls the API across origins; CORS +
   the demo Bearer token handle the rest.

---

## Part D — Verify

1. Open the Vercel URL → you get the **demo sign-in** card. Enter any email →
   you land in a fresh admin workspace.
2. **Accounts** shows Siemens / IKEA / Sanofi / HSBC / Stellantis / Spotify with
   employee counts + revenue (pre-seeded — works with **no** Apollo key).
3. **Live Apollo** (your explicit goal): with `APOLLO_API_KEY` +
   `BIDSTACK_JOB_SIGNING_SECRET` set on **both** services, open an account →
   **Enrich** → the worker calls Apollo and overwrites with live employee count,
   revenue, industry, logo. (Validated live: all 6 demo accounts return real
   data — e.g. Siemens 313k employees / $92.8B.) Or set `DEMO_AUTO_ENRICH=true`
   to refresh automatically on every sign-in.
4. **RFP Analytics** (Settings → RFP Analytics) shows a populated win-rate +
   by-owner rollup; uploading an RFP exercises the worker pipeline.

---

## Known demo limitations (acceptable for a showcase)

- **WebSocket realtime/collab** (live cursors, presence) won't traverse the
  cross-origin split — the REST app is unaffected.
- **PDF export** (puppeteer) needs system Chromium, which the slim `api` image
  omits; that single action degrades gracefully.
- Demo data is **per-visitor and ephemeral** — workspaces reset after
  `DEMO_ORG_TTL_HOURS`.

## When Railway is down: the local-backend stopgap

The Railway trial expired on 2026-08-04. All four services (api, worker,
Postgres, Redis) have zero deployments and `railway redeploy` answers **"Your
trial has expired. Please select a plan to continue using Railway."** The env
vars and the `api-production-3437.up.railway.app` domain are intact, so picking
a plan and redeploying restores the demo with no reconfiguration — that is the
real fix, and the only one that survives this machine being switched off.

Until then:

```bash
node scripts/demo-local-backend.mjs
```

It starts Postgres + Redis, builds and runs the api against the `bidstack_demo`
database, opens a Cloudflare quick tunnel, then rebuilds the SPA against that
tunnel and redeploys it. `--no-deploy` stops after the tunnel.

**It is a stopgap, and it has teeth:**

- The tunnel hostname is random and changes on every start, so the SPA has to be
  rebuilt and redeployed each time — the api origin is inlined at build time.
- It dies with the machine.
- Cloudflare quick tunnels hard-cap a request at 100 seconds (Error 524). Demo
  provisioning of a fresh tenant can approach that.
- WebSocket realtime is already a known cross-origin casualty (see above); the
  tunnel does not change that.

Two traps worth knowing even if you never run the script, because both fail
**silently** and look like a backend outage:

- `VITE_API_URL` is stored on Vercel as a **sensitive** variable. `vercel env
  pull` returns `[SENSITIVE]`, so a local `vercel build` bakes an EMPTY api base;
  every request then hits the SPA origin and gets `index.html` back through the
  catch-all rewrite. Export `VITE_API_URL` into the build environment —
  `vite.config.ts` prefers `process.env` over the env file.
- A stale `.vercel/.env.production.local` from an earlier session overrides the
  pull, so a rebuild re-inlines the *old* api host. Delete it before building.

## Single-platform alternative

If you'd rather run everything on Railway (one URL, no Vercel), add a third
service with Docker target **`web`** (nginx serving the SPA) — but build it in
demo mode and point its `VITE_API_URL` at the api service. The hybrid above is
recommended for the best frontend performance + a `vercel.app` link.
