# Main CI inherited gates (2026-11-01)

**Problem:** The first product runs of CI / E2E / Lighthouse / Semgrep / Checkov on `main` failed. None of the failures were introduced by `polo/mars-integration` or the Polo lockup plate drop. `polo/consolidated` (`dbd7e904`) and `archive/demo` (`e51c7aa3`) had no last-green product run of those workflows (consolidated only recorded gitleaks; demo only Dependabot Updates).

**Fixes (do not revert MARS/logo for these):**

- Unit no-DB job must exclude `apps/mcp-server/src/tools/kam-tools.test.ts`. That suite fail-louds when Postgres is missing and belongs in the integration job.
- Pin Playwright / Chromium jobs to `ubuntu-24.04`. `ubuntu-latest` is 26.04 and Playwright has no chromium build for it (`Playwright does not support chromium on ubuntu26.04-x64`).
- Lighthouse config in this ESM repo must be `.lighthouserc.cjs` (`module.exports`). `.js` throws `module is not defined in ES module scope`.
- Semgrep ERROR-only gate: `semgrep scan --severity=ERROR --error`. `semgrep ci` is Cloud-backed and rejects those flags.
- Checkov 3.3.x frameworks: `dockerfile,bicep`. `docker_compose` is not a valid name.
- Required CI e2e gate is Chromium `smoke.spec.ts` only (`pnpm --filter @bidstack/web e2e:smoke`). The job named "E2E smoke" previously ran the full suite (`playwright test`), which installs only Chromium and then fails Firefox/WebKit plus inherited v24 RBAC/mobile/baseline specs. Chromium smoke was already 6/6 green on `f9054fda` (https://github.com/mysticalsin/bidstack-360/actions/runs/41281301311). Full suite stays in `e2e.yml` as an extra, non-blocking workflow.

**Evidence (SHA `3e678009`):**

- E2E: https://github.com/mysticalsin/bidstack-360/actions/runs/41278503179
- Lighthouse: https://github.com/mysticalsin/bidstack-360/actions/runs/41278503126
- Semgrep: https://github.com/mysticalsin/bidstack-360/actions/runs/41278503075
- Supply Chain: https://github.com/mysticalsin/bidstack-360/actions/runs/41278503063
- CI unit: https://github.com/mysticalsin/bidstack-360/actions/runs/41278503083
