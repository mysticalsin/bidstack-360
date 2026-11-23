# Mac Playwright package preview

## Problem

`pnpm e2e` does not run the package preview. With `E2E_BASE_URL` unset,
`apps/web/playwright.config.ts` builds the web app inside its `webServer` and
boots the API on `E2E_API_PORT` (default **4010**), then previews on **4174**.
Linux CI installs Chromium only and still leaves `E2E_BASE_URL` unset, so that
job does not answer whether Safari/WebKit works against the package `build` +
`preview` path (API default **4000**, preview **4173**).

WebKit and Chromium downloads are large. A Mac that starts the install with
under 6 GiB free tends to die in the middle and leave a half-written browser
cache.

## Pattern

Run `node scripts/run-mac-playwright-preview.mjs` on a Mac with Node 24
(`.nvmrc`). The script reuses the existing package scripts and Playwright
projects. It does not grow a second test runner.

1. Measure free space with `fs.statfsSync` on the repo and on the Playwright
   browser directory (`~/Library/Caches/ms-playwright` on macOS, or
   `PLAYWRIGHT_BROWSERS_PATH` when that is set to a real path). `0` means
   browsers install inside the repo, so only the repo is checked. If either
   filesystem has **under 6 GiB** (`6 * 1024^3` bytes), exit 1 before
   `playwright install`, the web build, or either server. Exactly 6 GiB is
   allowed. The same disk reported twice is still one 6 GiB floor.
2. `corepack pnpm --filter @bidstack/web exec playwright install webkit chromium`.
   No Firefox, and no `--with-deps` (that flag is the Linux package install).
3. `corepack pnpm --filter @bidstack/web build` (the package `build` script).
   The child environment sets `VITE_ENABLE_E2E_ROLE_HEADER=true` so the
   cross-browser RBAC specs keep the header the Playwright web build already
   sets, clears `VITE_API_URL` so the bundle stays same-origin, and clears
   `VITE_CLERK_PUBLISHABLE_KEY` so an ambient Clerk key does not turn off stub
   storage. `/api` is proxied, not baked into the bundle.
4. Start the API with `tsx src/main.ts`, the same entry
   `playwright.config.ts` uses, not `pnpm dev` (watch would restart under the
   browsers). `PORT_API=4000`. `PUBLIC_BASE_URL` is the preview origin.
   `BIDSTACK_ALLOW_STUB_ROLE_HEADER`, `API_RATE_LIMIT_MAX`, and
   `PUBLIC_BOOKING_RATE_LIMIT_MAX` match the Playwright webServer env.
5. `corepack pnpm --filter @bidstack/web preview -- --host 127.0.0.1`. The
   port stays the one in the package `preview` script (4173 today).
   `BIDSTACK_DEV_API_URL=http://127.0.0.1:4000` is the server-only proxy
   override in `apps/web/vite.config.ts`, so the preview hits the API on 4000
   without a cross-origin client bundle.
6. Run Playwright only after both health checks pass. `E2E_BASE_URL` is the
   preview origin, which makes `webServer` in `playwright.config.ts` stay
   unset. `E2E_API_URL=http://127.0.0.1:4000` and `E2E_WORKERS=1`. Projects
   run as two processes, in this order, each with `--workers=1`:
   `webkit-desktop`, then `chromium-desktop`. WebKit still uses the
   `crossBrowserTestMatch` list in the config. Chromium runs the full
   project. A WebKit failure stops the run before Chromium. Servers are
   terminated when the process exits.

The suite itself refuses to start on a non-macOS host (exit 2). Linux WebKit
is not this gate. `--preflight-only` and `--dry-run` still run on Linux so the
disk floor and the command plan can be checked without browsers.
`--allow-non-darwin` and `--chromium-smoke` (only `e2e/smoke.spec.ts` on
`chromium-desktop`) are explicit escapes, not the Mac result.

Prerequisites are the same ones named on `playwright.config.ts`: Node 24,
`pnpm db:migrate`, `pnpm db:seed`, and a reachable Postgres plus Redis. The
API loads the repo-root `.env` itself. This script does not print that file.
Default Redis, when `REDIS_URL` is unset, remains `redis://localhost:6380`.

```bash
node scripts/run-mac-playwright-preview.mjs --preflight-only
node scripts/run-mac-playwright-preview.mjs --dry-run
node scripts/run-mac-playwright-preview.mjs
```

`--selftest` checks the 6 GiB boundary, the WebKit-then-Chromium plan, and
that the plan still points at the package `build` / `preview` scripts.

## Proposed CI snippet

Not wired. Do not add this to `.github/workflows/` until a Mac image has
Postgres, Redis, and at least 6 GiB free. `macos-latest` has no job `services:`
containers, so the databases have to be up before the script starts. The
script installs WebKit and Chromium after the disk check; the workflow should
not also run `playwright install --with-deps chromium`.

```yaml
# Proposed only. The workflow files in this repo are unchanged.
e2e-mac-preview:
  name: E2E Mac package preview
  runs-on: macos-latest
  timeout-minutes: 60
  env:
    DATABASE_URL: postgres://bidstack:bidstack_test@127.0.0.1:5432/bidstack_test
    REDIS_URL: redis://127.0.0.1:6380
  steps:
    - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
    - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
      with:
        version: '10'
        run_install: false
    - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm db:generate && pnpm db:migrate:deploy && pnpm db:seed
    - run: node scripts/run-mac-playwright-preview.mjs
```

## What this does not replace

Firefox stays on the existing cross-browser gate
(`docs/solutions/cross-browser-e2e-core-gate.md`). Deploy-evidence browser
runs stay on `pnpm deploy:evidence:browser` and a real target URL. This
script does not start Docker, seed the database, or deploy.

## Verification

Checked on Linux, without a Mac browser run:

- `node --check scripts/run-mac-playwright-preview.mjs`
- `node scripts/run-mac-playwright-preview.mjs --selftest`
- `node scripts/run-mac-playwright-preview.mjs --preflight-only`
- `node scripts/run-mac-playwright-preview.mjs --dry-run`
- `node scripts/run-mac-playwright-preview.mjs` exits 2 on Linux before
  install, build, or servers

A live Chromium smoke was not run: Postgres and Redis were not up, and a
package build plus browser install is not a cheap check on this host.
