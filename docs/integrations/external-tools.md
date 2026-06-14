# External tooling: code review, error monitoring, translation

Three off-the-shelf services augment BidStack. All three have a **free path that
needs no new secret committed to the repo** — they read credentials from env /
GitHub secrets, or are installed as a GitHub App. Each is inert until you activate it.

| Tool | Purpose | In-repo status | What you do to activate (free) |
| --- | --- | --- | --- |
| **Greptile** | AI PR code review | GitHub-App only (no repo code) | Install the GitHub App on the repo |
| **Sentry** | Error + performance monitoring | **Already wired** (web/api/worker) | Set a DSN env var (free tier or self-hosted GlitchTip) |
| **Crowdin** | Translation management | `crowdin.yml` committed | Free OSS project + token as a GitHub secret |

---

## 1. Greptile — AI code review on PRs

Greptile reviews pull requests with full-codebase context. It is a **GitHub App**,
so there is nothing to build in the repo — and **no API key lives here**.

**Activate (free for open-source / free trial otherwise):**
1. Go to <https://app.greptile.com>, sign in with GitHub.
2. Install the Greptile GitHub App and grant it access to this repository.
3. Open a PR — Greptile comments automatically.

**Optional repo-level steptailoring:** Greptile reads review preferences from the
dashboard (per-repo custom instructions). Point it at `CLAUDE.md` and
`.claude/rules/` so its reviews follow the same standards this repo already enforces
(org-scoped queries, no secrets, 50-line functions, all-states components, WCAG AA).

> Why a GitHub App, not a key: PR review needs repo + diff access that only the
> App's installation token can grant. I cannot install it for you — it is a
> repo-admin action.

---

## 2. Sentry — error monitoring (already wired)

The SDK is **already initialized** in all three runtimes — nothing to build:
- Web: `apps/web/src/lib/sentry.ts` (init + PII scrubbing + opt-in session replay)
  called from `main.tsx`, plus a Sentry error boundary.
- API: `apps/api/src/instrument.ts` + `apps/api/src/plugins/sentry.ts`.
- Worker: `apps/worker/src/plugins/sentry.ts`.

It is a **no-op until a DSN is set** (`if (!dsn) return;`). PII is scrubbed before
send (email/phone/name/tokens redacted), and only the user `id` + `orgId` are
attached — never email/name (GDPR).

**Activate without a paid key:**
- **Option A — Sentry free tier:** create a free Sentry project; copy its DSN.
  A DSN is a *public ingest URL*, not a secret API key.
- **Option B — self-hosted GlitchTip (FOSS, Sentry-compatible):** run GlitchTip
  and use its DSN. Fully free, your infrastructure, no third-party account.

Set these (see `.env.example`):
```
SENTRY_DSN=...                 # API + worker
VITE_SENTRY_DSN=...            # web (build-time)
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
```
Leave `VITE_SENTRY_REPLAY=false` unless you have privacy sign-off (replay records
sessions; inputs are masked but text is captured).

---

## 3. Crowdin — translation management

`crowdin.yml` (repo root) maps the English source namespaces
(`apps/web/public/locales/en/*.json`) to the per-locale translation files the app's
i18next HTTP backend serves at runtime. **No token is stored in the repo** — it is
read from `CROWDIN_PROJECT_ID` + `CROWDIN_PERSONAL_TOKEN` env vars.

**Activate (free OSS plan):**
1. Create a free Crowdin project (free for open-source).
2. Generate a personal access token; set `CROWDIN_PROJECT_ID` +
   `CROWDIN_PERSONAL_TOKEN` locally (or as GitHub Actions secrets).
3. Push sources and pull translations:
   ```
   npx @crowdin/cli upload sources
   npx @crowdin/cli download
   ```
   `download` writes completed translations into `fr/ es/ pt/ it/ zh/` and the app
   picks them up — no rebuild of the translation layer needed.

**CI (optional):** a GitHub Action can auto-upload sources on merge to `main` and
open a translations PR on a schedule. The workflow file is **not committed here**
because `.github/workflows/` is coordinate-before-edit (CLAUDE.md). Add
`crowdin-github-action` when ready; the `crowdin.yml` above is already compatible.

**Free, fully keyless alternative:** translations are plain JSON in the repo. You can
skip Crowdin entirely and edit `apps/web/public/locales/<lng>/<ns>.json` directly
(or machine-translate them in a local script). Crowdin only adds review workflow +
translator collaboration on top of the same files.

> Coverage note: the switcher and i18next pipeline work today, but many pages still
> use hardcoded English strings. The string-externalization program (wrapping UI
> text in `t()` and adding keys to these JSON files) is what makes language
> switching visible everywhere — Crowdin then scales the *translation* of that
> growing key catalog.
