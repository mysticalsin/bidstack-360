# Accessibility Release Evidence Gate

## Problem

Frontend accessibility checks were useful locally but not part of the deploy evidence bundle, so a release could pass without proving axe, color contrast, and keyboard navigation on the build intended for users.

## Solution

Add a dedicated `deploy:evidence:a11y` writer that runs the Playwright a11y specs, writes a privacy-safe artifact, and is required by the strict deploy verifier before browser evidence.

## Contract

- Required specs: `e2e/a11y/axe.spec.ts`, `e2e/a11y/color-contrast.spec.ts`, `e2e/a11y/keyboard-nav.spec.ts`.
- Required project: `chromium-desktop` by default.
- Strict release mode requires a non-local target, `authMode=clerk`, and production-build evidence.
- The artifact records counts, projects, specs, command, profile, target class, auth mode, and control booleans only. Do not store raw axe node details or page data.
- Local `--no-strict` runs are diagnostics, not release certification.

## Verification

- `pnpm deploy:evidence:a11y:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`
- `pnpm deploy:evidence:a11y -- --no-strict --production-build --auth-mode stub --env local`

## Follow-up

Run strict mode against staging/production with Clerk auth before any production readiness claim.
