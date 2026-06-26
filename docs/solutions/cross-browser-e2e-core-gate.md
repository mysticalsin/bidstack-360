# Cross-Browser E2E Core Gate

## Problem

Chromium-only E2E coverage can miss browser-specific harness assumptions and
interaction regressions. A CRM launch gate for large customers needs the core
flows to pass in Chromium, Firefox, and WebKit before any premium-readiness
claim is credible.

## Pattern

- Keep Chromium as the full-suite owner for OCR-heavy, visual, responsive, and
  performance gates.
- Add Firefox and WebKit projects for the highest-value customer flows:
  smoke, navigation, critical controls, accounts, account detail, contacts,
  opportunities, pipeline, search, settings, tasks, service desk, auth, and RBAC.
- Run cross-browser gates with one worker unless the data setup has been proven
  parallel-safe across all browsers.
- Avoid path-based assertions for auth shell detection. Browsers can preserve
  slightly different landing URLs while still rendering the correct app shell.
  Assert semantic UI landmarks such as `main`, primary navigation, and the
  absence of a login form.
- Stub-auth role tests must prove both halves of authorization: the frontend
  auth context and the backend capability manifest. Use an explicit E2E-only
  role header, guarded by loopback stub auth and an opt-in server env flag, so
  non-admin browser sessions resolve to real users with real `UserRole` rows.
- Keep browser-specific skips explicit and visible. A skipped Clerk-only path is
  acceptable in stub-auth mode; a skipped customer flow is not.

## Verification

- `pnpm --filter @bidstack/web exec playwright test --project=firefox-desktop --project=webkit-desktop --list`
- `pnpm --filter @bidstack/web exec tsc -p e2e/tsconfig.json --noEmit --pretty false`
- `pnpm --filter @bidstack/web exec eslint playwright.config.ts e2e/pages/LoginPage.ts`
- `pnpm --filter @bidstack/web exec cross-env E2E_WORKERS=1 playwright test --project=firefox-desktop --project=webkit-desktop --reporter=list`

## Notes

This gate strengthens browser portability. It does not replace a real per-role
browser matrix, load testing, security testing, or deploy-image certification.

## 2026-06-19 Release Evidence Source Report Proof

Strict deploy verification requires browser regression evidence to point at the
raw Playwright JSON report that generated the compact
`deploy-evidence/browser-regression-latest.json` summary.

The raw report must be:

- repo-local,
- parseable JSON,
- paired with the recorded Playwright command, and
- free of unknown test outcomes in the compact summary.

Verification:

- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `pnpm deploy:evidence:selftest`: pass, including missing-source,
  invalid-JSON, and unknown-outcome browser poison fixtures.
- Targeted verifier ESLint: pass.

## 2026-06-19 Preflight Red Artifact

The production release bundle must not leave browser evidence missing when
operator preflight is blocked. Missing proof makes the strict verifier less
actionable than a fresh red artifact.

Pattern:

- Keep the full browser evidence command as `deploy:evidence:browser` so it can
  run Playwright against a non-local release target.
- Give the bundle runner a preflight diagnostic script,
  `deploy:evidence:browser:write`, that writes
  `deploy-evidence/browser-regression-latest.json` from the existing or missing
  Playwright JSON report without launching Playwright.
- Mark the step as `preflightDiagnostic` and preserve `originalScript` so the
  release bundle shows why the red artifact was produced.
- Let strict verification consume that artifact and report concrete browser
  failures: missing target, missing Clerk-backed auth, missing production-build
  proof, missing raw Playwright report, missing command trail, and missing
  required roles/projects/specs.

Verification:

- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:bundle:selftest`: pass.
- `pnpm deploy:evidence:browser:selftest`: pass.
- `pnpm deploy:evidence:bundle:production`: expected block, now writes a fresh
  `deploy-evidence/browser-regression-latest.json` with `preflightDiagnostic`.
- `pnpm deploy:evidence:production`: expected block, 44 pass / 77 fail with
  browser evidence present and 10 concrete browser failures.
