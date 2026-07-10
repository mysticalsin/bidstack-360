# CI Repeat Release Evidence

Production readiness cannot rely on a generic green badge. The release verifier must see compact proof that the exact release commit and branch passed the full suite repeatedly on isolated infrastructure.

Use `pnpm deploy:evidence:ci` with either `BIDSTACK_CI_REPEAT_INPUT` or `BIDSTACK_CI_REPEAT_RUNS_JSON`. The input must include:

- CI provider, repository, workflow, branch, full 40-character release commit, and an HTTPS review URL.
- At least 10 consecutive passing runs.
- Required checks: `install`, `audit`, `db:generate`, `lint`, `typecheck`, `test`, `build`.
- Isolated infrastructure with pgvector-enabled Postgres.
- Zero failed suites and zero skipped suites.
- Privacy flags proving no raw logs, command output, raw provider payloads, or secrets are included.

The writer emits `deploy-evidence/ci-repeat-latest.json`. `pnpm deploy:evidence:production` then rejects the release unless that artifact matches `deploy-evidence/source-control-latest.json` for commit and branch.

Selftest:

```bash
pnpm deploy:evidence:ci:selftest
pnpm deploy:evidence:selftest
pnpm deploy:evidence:bundle:selftest
```

This closes the code-owned gap. The operator-owned gap remains exporting the real CI provider run series for the release candidate.
