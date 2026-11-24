# Sweep 03 — Security

Lens: authorization, tenant isolation, stub login, sample data, injection, secret leakage, CORS/CSRF, rate limits, uploads, identity, and the dependency audit.

Date: 2026-11-21. Base: `main` at `40b13242ebf18d715b67bb6133a9774bbd7d0c78`.

Stack: PostgreSQL 16 and Redis on this VM only. Database `bidstack_sweep`, role used for the app tests is the local superuser. No Clerk key, no provider keys, no deploy, and no `polo-preview` process. Two synthetic orgs were created by `createIsolatedOrg` (`migration-authz` and `migration-authz-b`). The stub session for org A was admin. Member sessions used the stub role header for Account Executive, Presales, SDR, Read-only, Sales Manager, and Manager.

Dedupe: open PR #367 owns the runtime-mode gate, sample-source provenance, stub-login refusal, `NODE_ENV` fail-closed, Clerk key whitespace, and `GET /identity`. Open PR #365 owns the `psql` argv allowlist. Those files were not edited. Issues in those areas are marked covered.

## Findings

### 1. High — a member can start or undo a data import

Status: fixed in draft PR #383, head `f7f0baa2d817f95e83a9ead7d3df7c5ab85073ae`.

`migrations:read` says running or undoing an import needs `settings:write`. The settings screen hides Data import unless the caller is an org admin. `POST /api/v1/migrations/start-hubspot` already required `settings:write`. The CSV routes did not.

Ungated before the fix:

- `POST /api/v1/migrations/start-csv`
- `POST /api/v1/migrations/:id/retry`
- `POST /api/v1/migrations/preview-csv`
- `POST /api/v1/migrations/parse-spreadsheet`
- `POST /api/v1/migrations/mappings`
- `DELETE /api/v1/migrations/:id/cancel`
- `DELETE /api/v1/migrations/:id/undo`

Undo deletes imported companies, contacts, leads, opportunities, and financial periods in the caller’s org.

Evidence, after the gate, on the two synthetic orgs:

- Admin of org A, `DELETE /api/v1/migrations/<org B job id>/undo` → 404. The org B job stayed `COMPLETE`.
- Account Executive, Presales, SDR, Read-only, Sales Manager, and Manager: `POST /api/v1/migrations/start-csv` and `DELETE .../undo` → 403. No job row was created.

```
pnpm --filter @bidstack/db exec vitest run src/seed.rbac.permission-sync.test.ts
pnpm --filter @bidstack/api exec vitest run src/routes/migrations.authz.integration.test.ts
```

9 API tests passed, including the role matrix. The seed test pins `settings:write` to Admin only.

### 2. Medium — CSV formula injection on org-chart and audit export

Status: fixed in draft PR #385, head `617351b8df5914057a02fa94ea315cc35a19fdaf`.

`apps/web/src/lib/orgchart/csv.ts` quoted commas and did not prefix `= + - @` tab or CR. A contact name is free text. Opening the file in Excel, Sheets, or LibreOffice would treat `=HYPERLINK(...)` as a formula.

`apps/web/src/pages/audit-log/audit-log-export.ts` checked `= + - @` only after `trimStart()`, so a leading tab or carriage return was left in the cell.

Opportunity export, migration error CSV, and the shared `csvCell` helper already prefix those characters. These two exporters did not.

Evidence: `exportCsv` of a node named `=HYPERLINK("https://evil.example","ok")` now contains the quote prefix, and the audit download of an action `\t=HYPERLINK(...)` and an email `\r=cmd|...` does too. `Ann, CEO` still quotes and round-trips.

```
pnpm --filter @bidstack/web exec vitest run src/lib/orgchart/orgchart.test.ts src/pages/audit-log/audit-log-export.test.ts
```

18 passed.

### 3. Medium — click tracking copies `?url=` into `Location`

Status: fixed in draft PR #387, head `995778cc3d9234d50cbd1a87ba23bb61c643b023`.

`createTrackRoutes` implemented `GET /track/email/click/:token?url=`. After the token matched `EmailTrackingPixel`, the handler redirected to any `http:` or `https:` URL. The pixel row has no destination column. An open-tracking mail already gives the recipient the token (`injectTrackingPixel` embeds `/track/email/open/:token`). A carriage return in the URL would also have been a `Location` header injection.

The factory is not registered from `server.routes.ts`, so this VM’s API process did not expose the path. The handler was still the only click implementation.

Evidence: mounting the factory and requesting five targets, including `https://evil.example/phish` and a `%0d%0aSet-Cookie` URL, returns 404 with no `Location` and no echo of the target.

```
pnpm --filter @bidstack/api exec vitest run src/routes/track.click.test.ts
```

5 passed. The route now also declares a 30/minute rate limit for when it is mounted.

### 4. Medium — OAuth token-endpoint bodies in logs and errors

Status: fixed in draft PR #389, head `0e13a6dcf7c4c1fb9276e2e6e46672a7fe0303ee`.

These paths copied the token-endpoint response body into a log object or an `Error` message:

- `apps/api/src/routes/integrations/gmail.ts` (`server.log.error({ status, body })`)
- `apps/api/src/routes/integrations/microsoft-mail.ts` (same)
- `apps/api/src/lib/hubspot-client.ts` (`throw new Error(... ${body})`), then the HubSpot callback pasted `err.message` into a 502
- `apps/api/src/services/documents/signature.service.ts` (`credentialError` with status and body)

A token endpoint error body can include `access_token`, `refresh_token`, or the authorization code. Pino redaction does not strip those keys when they sit inside a string named `body`. The 5xx handler does not return the message to the client. The log line still would.

Evidence: a fixture JSON body containing synthetic token strings reduces to `{ status, error: "invalid_grant" }` and `Gmail token exchange failed (400: invalid_grant)`. The rendered text does not contain the token strings.

```
pnpm --filter @bidstack/api exec vitest run src/lib/oauth-failure.test.ts
```

2 passed.

### 5. Product decision — proposal approve vs RFP approve

Status: not changed. Needs a product decision only if the 11 Nov 2026 call should be reopened.

`POST /api/v1/proposals/:id/approve` requires `proposals:approve` and an attestation. Admin and Presales do not hold `proposals:approve`. Manager does. `proposals:write` cannot PATCH a proposal to `approved`.

`POST /api/v1/proposals/:proposalId/rfp-approve` requires `proposals:write` and then sets `status: 'approved'`, `approvedAt`, and `approvedByUserId`. An Account Executive holds `proposals:write` and not `proposals:approve`.

`docs/state-machines.md` records Tony, 11 Nov 2026: “No, proposals:write is enough for the RFP gate.” The integration test `proposals:write can approve at the RFP gate` locks that in. Both writers still produce the same `approved` status that Dust reads as a human decision, and the RFP path does not require the attestation.

`POST /api/v1/bid-workspaces/:workspaceId/rfp/:orchestrationId/approve-drafting` also uses `proposals:write`. That call resumes section drafting. It does not set the proposal to `approved`.

`PATCH` of a compliance matrix row can set that row’s status to `approved` with `documents:write`. That is a different record from `proposals.status`.

### 6. Covered by #367 — runtime mode, stub login, sample rows, `/identity`

Not edited.

On this `main`:

- `getPoloDataMode` is demo unless `POLO_DATA_MODE` is exactly `real`.
- `assertPoloAuthBoot` throws if real mode has no Clerk key and no Cloudflare Access, and if production has neither Clerk, Cloudflare Access, nor an acknowledged demo door.
- A whitespace `CLERK_SECRET_KEY` is truthy, so it is treated as present. #367 treats whitespace as missing.
- `GET /api/v1/identity` is public and returns `dataMode`, `authProvider` (`stub`, `clerk`, `demo`, or `cf-access`), `demoBanner`, and `cfAccessEnabled`. #367 narrows that payload.
- There is no demo-data toggle route on `main`. #367 adds the server-enforced toggle and hides it from members.
- Sample rows are not hidden in real mode. `useOrgChart` falls back to `sampleChart` (Alex Morgan) when the account has no saved chart. `isSampleStatus` treats `not_enriched` and `not_configured` as sample firmographics. `GET` InfoSearch returns `sampleInfoSearchLeads` (Jordan Avery) when the provider is not configured (`apps/api/src/routes/infosearch.ts`). #367 owns `admitSample` / `readSample`.

Stub login was not reachable in this run as a production or real-mode door: the API booted in `NODE_ENV=test` with no Clerk key and logged `AUTH STUB MODE`. That is the test/dev path. Real mode without Clerk or Cloudflare Access refuses to boot in `assertPoloAuthBoot`.

`skipOnError` on the global rate limit is true when `POLO_DATA_MODE` is not `real`. The default on `main` is demo, so a Redis store error fails open. #367’s default of real would flip that without a separate edit. Left as covered by that change.

### 7. Covered by #365 — `psql` argv allowlist

Not edited. The allowlist, verbose flag, and drill-hook production guard live under `apps/polo-preview/`. This sweep did not start `polo-preview` and did not read or write credentials outside the VM.

### 8. Dependency audit — report only

`pnpm audit` on this tree, no installs and no overrides added.

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 3, all already in `pnpm.auditConfig.ignoreGhsas` |
| Moderate | 27 |
| Low | 4 |

`pnpm audit --audit-level high` exits 0 because the three highs are ignored. They are the dated no-fix entries in `docs/solutions/pnpm-audit-allowlist.md`:

- `GHSA-jmr9-qjv8-65gv` and `GHSA-7pqw-9j4j-h8q3` — `extract-zip` 2.0.1, no patched release, dev path through Lighthouse / Puppeteer
- `GHSA-mrhx-c7xc-m3w5` — `zod` 3.25.76; the advisory is fixed in Zod 4.6.6, which is a breaking upgrade

The allowlist note says to re-check on or before 2026-12-02. Moderates worth a later pass, not changed here: `react-router` / `react-router-dom` (constructor injection, open redirect, XSS), `vite` 6.4.4 `server.fs.deny` bypass, `vitest` / `@vitest/mocker` file read (dev), `hono` (not the API framework), OpenTelemetry `db.user` span attributes, `postcss`, `glob`, `minimatch`, `brace-expansion`.

## Checked, no new defect

- SQL: request paths use Prisma’s tagged queries. The migration savepoint name is `chunk_row_${i}` or `opp_code_${attempt}` with a numeric index, not a cell value.
- XSS in notes: `NotesPanel` renders markdown as React text nodes. It does not use `dangerouslySetInnerHTML`. Email HTML goes through the sanitizer. Compliance responses go through DOMPurify.
- File download header injection: `safeContentDisposition` strips controls and uses RFC 5987 encoding. `X-Request-Id` accepts only a short token charset.
- CORS: `buildAllowedCorsOrigins` allowlists `PUBLIC_BASE_URL`, optional extra origins parsed as URLs, and loopback dev ports outside production. `*` does not parse as an origin. Production rejects a loopback `Origin`. `credentials: true` is paired with that allowlist.
- CSRF: API auth is `Authorization: Bearer` or an API key. No session cookie is set by the auth plugin.
- Login rate limit: `POST /api/v1/demo/session` is 5/minute and only mounts when `DEMO_MODE=true`. There is no password login route. Clerk login is not on this API. Stub mode has no login POST.
- Import rate limits, already present and kept: start-csv 10/minute, parse-spreadsheet 10/minute, preview 20/minute, HubSpot start 5/minute. Finding 1 was the missing permission, not a missing counter.
- Upload limits: `FILE_MAX_BYTES` is 50 MiB on presign and local PUT. The content-type allowlist excludes SVG and HTML. Local download sets `nosniff`, `Content-Disposition: attachment`, and `Content-Security-Policy: default-src 'none'; sandbox`. Spreadsheet parse rejects buffers over 8 MB. Global JSON body limit is 10 MiB.
- `GET /metrics` without `METRICS_BEARER_TOKEN` is 404. Release commit and branch on `/health` are omitted unless that bearer is presented. Sentry smoke routes 404 unless `SENTRY_SMOKE_ENABLED=true` and a token of at least 24 characters matches.

This sweep did not replay every `:id` route as a live cross-tenant pair. The undo case in finding 1 is the live pair. The existing route census and tenant-isolation suites remain the broad net.
