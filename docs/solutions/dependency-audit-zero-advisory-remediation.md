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

## Guardrail

Do not claim a lockfile diff is small when `pnpm install` ran in a dirty
workspace. The right record is: which dependency intent was changed, which
pre-existing drift was observed, and which gates proved the resulting graph is
usable.
