# Dependency audit zero-advisory remediation

## Problem

`pnpm audit --audit-level high` can pass while moderate advisories remain. For
enterprise release readiness, the dependency gate should also inspect the full
audit payload and drive the repo toward zero known advisories when the patches
are available.

## Pattern

1. Run `pnpm audit --json` and identify every advisory, not only high severity.
2. Prefer direct dependency upgrades when the repo owns the package.
3. Use `pnpm.overrides` for transitive packages when the vulnerable package is
   pulled by multiple toolchains and the patched version is semver-compatible.
4. Run `pnpm install` only after checking the worktree. If manifests or the
   lockfile are already dirty, record that the lock refresh may include
   pre-existing dependency drift.
5. Verify with the full quality gate that touches the upgraded packages:
   `pnpm audit`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Applied fix

- Upgraded `i18next-http-backend` in the web app to a patched 3.x release.
- Upgraded `react-router-dom` in the web and marketing apps to `^6.30.4`.
- Added a workspace `ws` override to keep transitive websocket consumers on a
  patched version.

### 2026-06-17 security gate refresh

The full `pnpm audit` gate later found 17 advisories, including high severity
issues in transitive packages and frontend tooling. The remediation used direct
upgrades where the workspace owned the dependency and explicit `pnpm.overrides`
where multiple toolchains pulled the vulnerable package.

- Upgraded web/marketing Vite usage to `^6.4.3`.
- Upgraded web DOMPurify usage to `^3.4.10`.
- Upgraded API observability packages as one compatible set:
  `@opentelemetry/*` to the `0.219.x`/`2.8.x` line and Sentry Node/profiling
  packages to `^10.58.0`.
- Upgraded worker Sentry Node/profiling packages to `^10.58.0`.
- Added overrides for `tmp@0.2.7`, `form-data@4.0.6`, `vite@6.4.3`,
  `protobufjs@7.6.4`, `hono@4.12.25`, `js-yaml@4.2.0`,
  `@babel/core@7.29.7`, and `@opentelemetry/core@2.8.0`.
- Added `@sentry/node-cpu-profiler` to `onlyBuiltDependencies` and rebuilt it.

Verification snapshot:

- `pnpm audit`: pass, no known vulnerabilities.
- `bash scripts/check-secrets.sh --full`: pass, 1670 tracked files.
- `pnpm lint`: pass with existing warnings only.
- `pnpm typecheck`: pass.
- `node scripts/run-worker-tests.mjs --reporter=dot`: 243 tests passed.
- `pnpm --filter @bidstack/api test`: 638 passed, 2 skipped.
- `pnpm test`: full workspace test suite passed.
- `pnpm build`: pass.

## Guardrail

Do not claim a lockfile diff is small when `pnpm install` ran in a dirty
workspace. The right record is: which dependency intent was changed, which
pre-existing drift was observed, and which gates proved the resulting graph is
usable.

Do not force one vulnerable transitive package to a new major line without
checking its integration family. The first attempt to override only
`@opentelemetry/core` broke API tests through an older Sentry/OpenTelemetry
combination. Upgrade the compatible observability set together, then run API
tests before calling the dependency graph clean.
