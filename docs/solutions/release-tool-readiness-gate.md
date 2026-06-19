# Release tool readiness gate

## Problem

The deploy evidence gate could require load, SAST, container, secret, Sentry,
and browser artifacts while the release runner still lacked the tools needed to
generate those artifacts. That creates late failures: CI can reach the approval
step before discovering that Docker, Sentry CLI, Playwright, pnpm, or the
Gitleaks fallback path is unavailable.

## Pattern

Run `pnpm deploy:evidence:tools` before generating strict staging/production
evidence. The command writes `deploy-evidence/tool-readiness-latest.json`, which
is now a required strict deploy artifact. The pnpm release command executes the
pinned Docker images, not just the Docker daemon probe, so fallback runners are
proven before heavier evidence generation begins.

The artifact proves:

- Node major version `24`
- pnpm major version `10`
- Git and Bash for repo gates
- Docker CLI and daemon for Semgrep, Trivy, k6 fallback, and Gitleaks fallback
- Sentry CLI for Sentry smoke issue queries
- Playwright CLI for browser-regression evidence
- k6 local runner or Docker fallback
- native Gitleaks or pinned Docker fallback
- Docker fallback images execute when a release tool depends on Docker
- required evidence scripts, including source-control provenance, source review
  planning/write mode, operational readiness, and `.gitleaks.toml`

The command is read-only apart from writing its JSON artifact. It does not print
secrets and does not query live provider data. For lightweight local inventory
without image pulls, run the Node script directly; strict deploy verification
will reject that artifact if any Docker-dependent tool lacks image execution
proof.

```powershell
node scripts/write-release-tool-readiness.mjs
```

## Verification

Local proof on 2026-06-17:

- `node --check scripts/write-release-tool-readiness.mjs`: pass
- `node --check scripts/verify-deploy-evidence.mjs`: pass
- `pnpm deploy:evidence:tools:selftest`: pass
- `pnpm deploy:evidence:selftest`: pass
- `pnpm deploy:evidence:tools -- --out deploy-evidence/tool-readiness-codex-local.json`:
  pass, 21 required checks, 0 blocking failures
- `BIDSTACK_TOOL_READINESS_EVIDENCE=deploy-evidence/tool-readiness-codex-local.json pnpm deploy:evidence:production`:
  tool-readiness checks pass, deploy still blocks correctly on the local smoke
  load profile/target and missing external release evidence artifacts
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/write-release-tool-readiness.mjs scripts/verify-deploy-evidence.mjs`:
  pass

Local proof on 2026-06-18:

- `pnpm deploy:evidence:tools`: pass, now including
  `scripts/write-source-control-evidence.mjs` and
  `scripts/write-source-review-plan.mjs` in required file proof.
- `pnpm deploy:evidence:tools:selftest`: pass after adding
  `scripts/write-operational-readiness-evidence.mjs` to required file proof.

Local proof on 2026-06-19:

- `node --check scripts/write-release-tool-readiness.mjs`: pass.
- `node --check scripts/verify-deploy-evidence.mjs`: pass.
- `node --check scripts/run-deploy-evidence-bundle.mjs`: pass.
- `pnpm deploy:evidence:tools:selftest`: pass.
- `pnpm deploy:evidence:selftest`: pass with a poisoned skipped-image-probe
  artifact rejected by `tools.imageProbes`.
- `pnpm deploy:evidence:bundle:selftest`: pass, including the bundle tools
  step forcing `BIDSTACK_TOOL_READINESS_EXECUTE_IMAGE_PROBES=true`.
- `pnpm deploy:evidence:tools`: pass, 31 required checks and executed
  Gitleaks, k6, Semgrep, and Trivy image probes.
- `pnpm deploy:evidence:production`: expected block, 29 pass / 52 fail;
  `tools.imageProbes` passes after the refreshed image execution proof.

## Notes

On Windows, run pnpm probes through `cmd /c pnpm ...` inside Node tooling. This
machine exposes pnpm as a PowerShell shim, and `spawnSync('pnpm')` or
`spawnSync('pnpm.cmd')` can fail even when shell usage succeeds.
