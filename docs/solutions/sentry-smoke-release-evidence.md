# Sentry Smoke Release Evidence

## Problem

Runtime observability cannot be certified by "Sentry DSN configured" alone. A
real release needs proof that both API and worker errors reach Sentry for the
target release/environment, and the proof artifact must avoid storing raw event
payloads, stack traces, request bodies, user emails, or raw command output.

## Pattern

`pnpm deploy:evidence:sentry:trigger` now writes a stricter
`deploy-evidence/sentry-smoke-latest.json` artifact:

- release and environment
- Sentry organization
- API and worker project slugs
- API and worker smoke markers
- non-local trigger target
- compact API issue metadata from `sentry issue list`
- compact worker issue metadata from `sentry issue list`
- privacy flags proving raw event data and command output are omitted

The strict deploy verifier fails when project metadata is missing, issue queries
fail, observed issue metadata does not match the expected API/worker project, or
unsafe raw detail is included in the evidence artifact.

## Operator Contract

Set these before staging/production evidence runs:

```bash
SENTRY_SMOKE_ENABLED=true
SENTRY_SMOKE_TOKEN=<release-smoke-token>
BIDSTACK_SENTRY_API_BASE_URL=https://<deployed-api>
BIDSTACK_SENTRY_SMOKE_TOKEN=<same-release-smoke-token>
BIDSTACK_SENTRY_AUTH_TOKEN=<sentry-cli-token>
BIDSTACK_SENTRY_RELEASE=<release>
BIDSTACK_DEPLOY_ENV=staging # or production
BIDSTACK_SENTRY_ORG=<sentry-org>
BIDSTACK_SENTRY_API_PROJECT=<api-project-slug>
BIDSTACK_SENTRY_WORKER_PROJECT=<worker-project-slug>
BIDSTACK_SENTRY_DSN_CONFIGURED=true
```

Then run:

```bash
pnpm deploy:evidence:sentry:trigger
pnpm deploy:evidence:staging # or production
```

## Verification

- `pnpm deploy:evidence:sentry:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`
