# Plan: polo-fix-hermeticity-5xx-residuals

Ticket: `polo-fix-hermeticity-5xx-residuals` (PR #348). Findings: M-1 hermeticity, L-1 deliberate 503, L-2 Slack OAuth when `INTEGRATION_TOKEN_KEY` is unset, plus the residuals for provider response bodies and raw migration `errorSummary`.

Code head this plan describes: `e7defdb07c1c752ea9091a265a9f748734e145ac`
Tree: `01f3d6b7fdd428f82b7cd260544be86f2da4ade2`

## Done when

- [ ] `pnpm test:hermeticity` exits 0. The scanner reports no `org_seed_mantu` hit in an API test file.
- [ ] `keeps a deliberate 503 and its safe message` passes, and the body is status 503 with `HubSpot OAuth not configured — set HUBSPOT_CLIENT_ID and HUBSPOT_REDIRECT_URI`.
- [ ] `hides unexpected failures behind a generic 500` passes, and the body message is `Something went wrong` with none of the thrown text.
- [ ] `answers 503 not configured when the integration token key is unset` passes, and the body message is `Integration token encryption is not configured`.
- [ ] `does not log the Gmail response body when send fails` passes. The captured log contains the status and does not contain the upstream sentinel.
- [ ] `does not put the HubSpot response body on the thrown error` passes. The error text contains the status and does not contain the upstream sentinel.
- [ ] `maps raw errorSummary on a job response to a safe code` passes. Raw driver text becomes `import_failed`. A `chunk failed permanently:` tail becomes `chunk failed permanently: import_failed`. `enqueue_failed` and `company.name is required` stay as written.
- [ ] `maps raw HubSpot sync-now reasons to a safe message` passes. The reason is `The import could not be completed.`
- [ ] Root `pnpm test` exits 0.
- [ ] This change adds no Prisma migration.

## Failing tests (red, before the fix)

These names fail on the red commits and pass on the code head.

| Test name | File |
| --- | --- |
| `keeps a deliberate 503 and its safe message` | `apps/api/src/plugins/error-handler.test.ts` |
| `hides unexpected failures behind a generic 500` | `apps/api/src/plugins/error-handler.test.ts` |
| `answers 503 not configured when the integration token key is unset` | `apps/api/src/routes/integrations/slack.oauth-start.integration.test.ts` |
| `does not log the Gmail response body when send fails` | `apps/api/src/lib/provider-upstream-body.test.ts` |
| `does not put the HubSpot response body on the thrown error` | `apps/api/src/lib/provider-upstream-body.test.ts` |
| `maps raw errorSummary on a job response to a safe code` | `apps/api/src/routes/migrations.public-error.test.ts` |
| `maps raw HubSpot sync-now reasons to a safe message` | `apps/api/src/routes/migrations.public-error.test.ts` |

M-1 has no vitest name. The red check is `pnpm test:hermeticity`, which exits 1 with exactly two violations on `3619ed1946c3d9af07f91d2561e96b166955bec5`:

- `apps/api/src/routes/bid-workspace-rfp.integration.test.ts`
- `apps/api/src/routes/public-sign.integration.test.ts`

## TEST COMMAND

From the repository root, with local Postgres (pgvector) and Redis, and without a live deploy:

```bash
pnpm test
```

The named tests alone:

```bash
pnpm --filter @bidstack/api exec vitest run \
  src/plugins/error-handler.test.ts \
  src/lib/provider-upstream-body.test.ts \
  src/routes/integrations/slack.oauth-start.integration.test.ts \
  src/routes/migrations.public-error.test.ts
```

Hermeticity alone:

```bash
pnpm test:hermeticity
```
