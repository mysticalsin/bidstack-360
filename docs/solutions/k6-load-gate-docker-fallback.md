# k6 Load Gate Docker Fallback

## Problem

The root `pnpm load-test` gate must certify live CRM read paths, but it previously depended on a machine-local `k6` binary and skipped authenticated routes unless an `API_TOKEN` was present. On a clean Windows workstation that made the gate either unavailable or too shallow to prove the app shell paths used by real users.

The search endpoint also has intentional per-user rate limiting. Under local dev-stub auth, the full ramp behaves like one user/IP hammering autocomplete, so `429` can be the correct graceful response instead of an infrastructure failure.

## Pattern

Keep the root gate runnable and strict:

- Run local `k6` when installed.
- Fall back to Docker with pinned `grafana/k6:2.0.0` when local `k6` is missing.
- Rewrite loopback `API_BASE_URL` to `host.docker.internal` for Docker so a Windows-hosted API is reachable from the container.
- Exercise authenticated routes by default in local/dev-stub mode; use `SKIP_AUTHENTICATED_ROUTES=true` only for deliberate health-only smoke checks.
- Fail closed for non-local targets unless `API_TOKEN` is provided or the run explicitly opts into health-only mode. This prevents staging/production from being "certified" by unauthenticated public probes.
- Keep endpoint checks as a threshold with `checks: ['rate>0.99']` so route regressions fail the run.
- Treat search `429` as graceful only for the search request, while all other endpoint checks still require `2xx`.
- Persist ignored run evidence under `load-test-report/`:
  - `k6-summary-latest.json`: raw k6 summary export.
  - `production-load-latest.json`: compact certification artifact with profile, runner, target, thresholds, and key metrics.

## Profiles

`K6_DURATION_PROFILE` supports:

- `smoke`: short local proof, 5 max VUs.
- `full`: default local regression ramp, 100 max VUs.
- `baseline`: steady 50-VU baseline.
- `stress`: stepped 100/250/500-VU pressure run.
- `soak`: 100-VU long hold.
- `certification`: 250/500-VU authenticated gate. This profile rejects `SKIP_AUTHENTICATED_ROUTES=true`.

## Gate

Start the API with current code, then run:

```powershell
$env:API_BASE_URL='http://127.0.0.1:4602'
pnpm load-test
```

Optional smoke profile:

```powershell
$env:API_BASE_URL='http://127.0.0.1:4602'
$env:K6_DURATION_PROFILE='smoke'
pnpm load-test
```

Production/staging certification shape:

```powershell
$env:API_BASE_URL='https://<staging-or-prod-api>'
$env:API_TOKEN='<short-lived bearer token>'
pnpm load-test:certify
```

## Verification Snapshot

2026-06-17 local gate after the fix:

- Runner: Docker fallback, `grafana/k6:2.0.0`, digest `sha256:a33a0cfdc4d2483d6b7a3a22e726a499ff2831a671a49239104cd34a9937523c`.
- Smoke: `80/80` checks, p95 `18.64ms`, `0.00%` failed HTTP responses.
- Full ramp: `100` max VUs, `5,870` HTTP requests, `11,740/11,740` checks, p95 `12.78ms`, `0.00%` failed HTTP responses.
- Authenticated routes covered: CRM dashboard, opportunities list, search, CRM summary.

2026-06-17 artifact hardening:

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-k6-load-test.mjs scripts/load-test.js`: pass.
- Local authenticated smoke with Docker fallback: `80/80` checks, p95 `15.58ms`, `0.00%` failed HTTP responses, `production-load-latest.json` `passed: true`.
- Non-local target without `API_TOKEN`: exits `1` before k6 runs and prints the fail-closed auth-proof warning.
- Release evidence path: `pnpm deploy:evidence:load` sets
  `BIDSTACK_LOAD_EVIDENCE_STRICT=true` and `K6_DURATION_PROFILE=certification`.
  It exits before k6 if the target is local or invalid, if `API_TOKEN` is
  missing, if health-only mode is enabled, or if the profile is not
  `certification`.
- The compact artifact now records `"strictEvidence": true` for strict release
  runs, making the release record distinguishable from local certification
  experiments.

2026-06-19 strict raw-summary proof:

- Strict deploy verification now requires `production-load-latest.json` to
  prove the raw k6 summary export exists with `rawSummaryFound: true` and a
  repo-local `rawSummaryPath`.
- `pnpm deploy:evidence:selftest` includes a poisoned compact load artifact
  where the raw k6 summary is missing; the strict verifier fails it with
  `load.rawSummary`.
- This keeps the derived certification artifact auditable: reviewers can inspect
  both `load-test-report/k6-summary-latest.json` and
  `load-test-report/production-load-latest.json`.

2026-06-19 parseable raw-summary proof:

- Strict deploy verification now parses the raw k6 summary JSON instead of only
  checking that the path exists.
- `pnpm deploy:evidence:selftest` includes an invalid-JSON raw summary fixture
  and rejects it with `load.rawSummary`.
- This prevents a zero-byte, text, or placeholder file from satisfying release
  load proof.

2026-06-18 strict preflight hardening:

- `node --check scripts/run-k6-load-test.mjs`: pass.
- `pnpm load-test:selftest`: pass.
- `pnpm deploy:evidence:load` without a staging target/token: fails before k6
  with local-target and missing-token errors, as intended.
- `pnpm exec eslint --no-ignore --no-warn-ignored scripts/run-k6-load-test.mjs scripts/load-test.js scripts/verify-deploy-evidence.mjs`: pass.

## References

- Grafana k6 running guide: https://grafana.com/docs/k6/latest/get-started/running-k6/
- Grafana k6 install/Docker guide: https://grafana.com/docs/k6/latest/set-up/install-k6/
