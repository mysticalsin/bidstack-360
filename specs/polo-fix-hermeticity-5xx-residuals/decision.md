# Decision: 503, secret text, and the migration sentinel

Ticket: `polo-fix-hermeticity-5xx-residuals`
Product code head: `14aad56bc3565dedff3c01237b83e77fb3c17a8a`
Earlier code head `e7defdb07c1c752ea9091a265a9f748734e145ac` (tree `01f3d6b7fdd428f82b7cd260544be86f2da4ade2`) is void for PASS evidence. Debate round 1 changed product code.

## Why 503 instead of 500

A missing HubSpot OAuth app and a missing `INTEGRATION_TOKEN_KEY` are setup gaps. The route or the crypto helper already knows the safe sentence. Returning 500 `Something went wrong` hides that.

The error handler keeps a 503 only when the error carries `Symbol.for('bidstack.deliberate503')` and `statusCode` is 503. It does not compare `err.name`. This server stamps that brand on its own `httpErrors.serviceUnavailable`. `IntegrationTokenKeyMissingError` sets the same brand. A plain `Error` that only sets `name` and `statusCode`, and a `ServiceUnavailable` built on another server, are a generic 500. The message is not copied into the body.

| Case | Who can call it | Status | Body message |
| --- | --- | --- | --- |
| `GET /api/v1/migrations/hubspot/auth` | Signed-in, `settings:write`. The seed grants that permission only to Admin. | 503 | `HubSpot is not configured` |
| `GET /api/v1/migrations/hubspot/callback` | Unauthenticated | 503 when the app is unset | `HubSpot OAuth not configured` |
| `GET /api/v1/integrations/slack/oauth/start` | Signed-in, `integrations:write`. Seeded on Admin, Sales, Sales Manager, Account Executive, SDR, and Customer Success. | 503 | `Integration token encryption is not configured` |
| Public Dust webhook, public Clerk webhook, public Sentry smoke, Clerk auth (`CLERK_SECRET_KEY`, `PUBLIC_BASE_URL`), Cloudflare Access allowlist parse | Unauthenticated, or any caller who reaches Clerk auth | 503 | `integration not configured` |
| Any other thrown error, including a plain Error with a forged 503 name, and a DocuSign error that only sets `statusCode` | — | 500 | `Something went wrong` |

No 503 body in this set names an env var. HubSpot auth logs `HUBSPOT_CLIENT_ID` and `HUBSPOT_REDIRECT_URI` as `missingEnv`. The callback sentence does not name them. Slack does not name `INTEGRATION_TOKEN_KEY`.

The other routes above used to put the env var name in the 503 body. Those names now stay in the server log (`missingEnv`) and the body is `integration not configured`.

A malformed token key stays a plain Error, so it is a generic 500. The key value is never copied into the message.

Gmail and Microsoft already answered 503 by sending the response in the route. This change does not add a second catch there. Slack and HubSpot go through the one handler branch.

`CF Access org "<id>" is not registered` still includes the configured org id. It does not name an env var. It is left as written. A malware-scan `serviceUnavailable(err.message)` on file finalize is also unchanged: that route is a signed-in upload, and the message is the scanner's sentence, not an env var name.

## How secret text is scrubbed

`discardUpstreamBody` calls `cancel()` first and gives up after 2 seconds. If there is no `cancel`, it reads at most 64 KiB and also stops at 2 seconds. It never throws. A thrown `text()` is ignored. Callers log the status only. They throw an error whose message is the provider name and the status, not the body.

The HubSpot token-exchange route does not interpolate `err.message` into the HTTP response. It throws a bad gateway with the fixed sentence `HubSpot token exchange failed`. That is not a service-unavailable class, so the handler replaces it with 500 `Something went wrong`. The upstream body is not in the log line and not in the HTTP body.

There is no log redaction rule on a field named `body`. That name is used for ordinary payloads. The body is cancelled before it is logged.

## Migration text sentinel

Unknown text stored on `errorSummary` is not returned. The allowlist is exact.

- A known code matches the map key with `===`, not a prefix. `enqueue_failed: connection reset by driver` becomes `import_failed`.
- A known row sentence matches the set with `===`, or one of the two anchored regular expressions. `company.name is required` followed by driver text becomes `import_failed`.
- A stored message that starts with `chunk failed permanently:` becomes `chunk failed permanently: import_failed`. The named test is `maps chunk failed permanently plus raw text to chunk failed permanently: import_failed`.
- Known codes (`enqueue_failed`, `rows_expired`, `import_conflict`, `enqueue_stopped`, `stale`, and the legacy sentences) stay as stored when the whole message is that code. Known row sentences such as `company.name is required` stay as stored when the whole message is that sentence. The wizard keys on those.
- HubSpot sync-now uses `migrationFailureText`. Unknown text becomes the sentence `The import could not be completed.`

### Readers of `errorSummary`

| Reader | What it returns | Sanitizer |
| --- | --- | --- |
| `serializeJob` in `apps/api/src/routes/migrations.helpers.ts`. Callers: `GET /migrations` (`migrations.ts` list), `GET /migrations/:id`, `POST` start (201), retry (200), cancel, and HubSpot start `jobs`. | Job JSON `errorSummary[].message` | `migrationPublicMessage` |
| `GET /migrations/:id/errors.csv` | CSV download | `migrationErrorsCsv` → `migrationFailureText` |
| HubSpot sync-now (`sync-now/hubspot.ts` selects the column, `sync-now/runs.ts` builds `reasons`) | `reasons[]` on the run | `migrationFailureText` |
| Import wizard `apps/web/src/components/import/CsvImportWizard.tsx` | The sentence under the progress bar | Reads the API payload above, then `importErrorCopy` → `migrationFailureText`. The retry button uses `migrationRetryOffered` on those already mapped messages. |
| `POST /migrations/:id/retry` in `migrations.ts` | Does not return the stored messages. The response body is `serializeJob`. | The decision calls `migrationRetryOffered` on the stored strings. That comparison is exact codes plus the `chunk failed permanently:` prefix. It is the one product reader that does not run the string through `migrationPublicMessage` first. The HTTP body still does. |

No log line in `apps/api`, `apps/web`, or `apps/worker` prints `errorSummary`. The worker writes the column. Tests read the stored row. Those tests are not a product reader.

Rows already stored keep the raw text. Scrubbing them is the residual in `residual-scrub-error-summary-at-rest.md`.

The test sentinel for a provider-shaped summary is the plain marker `hubspot-body-marker` plus `buyer@secret.example`. Neither string may appear on the sync-now run. The test sentinel for a logged Gmail body is `provider-body-SENTINEL-upstream-text`.

`field` on a job error is the column name from that org's upload. It is not a driver sentence. The serializer still returns it, capped at 100 characters, so a long or odd cell header cannot fill the response.

The account-name and entity-type sentences echo at most 80 characters, and those characters cannot be a control character or a quote. A longer name, or a newline, becomes `import_failed`.

Known failure codes are read with `Object.hasOwn`. `constructor` and `__proto__` are not codes.

## Cause, Sentry, and callers

No converted fetch site sets `cause` or attaches the response to the thrown error. A search of `apps/api/src` finds `cause` only in demo auth, which is not one of these sites.

The handler logs and reports a copy of an unhandled error that has no `cause`. Pino's err serializer appends `cause` onto the message, which is why the copy drops it. `captureSentryServerError` then calls `Sentry.captureException` on that copy. `scrubSentryEvent` (`beforeSend`) scrubs `exception.values[].value` as a message. It does not walk `Error.cause` itself. The copy has no `cause`, so there is nothing further to walk.

### DocuSign

| Function | Who calls it | On failure |
| --- | --- | --- |
| `getDocuSignAccessToken` | `sendDocuSignEnvelope`, `voidSignatureRequest` | Missing credentials: `credentialError`, `statusCode` 503, no brand, so the handler returns 500 `Something went wrong`. HTTP failure: body cancelled, plain `Error` `DocuSign OAuth token exchange failed: <status>`, same 500. |
| `sendDocuSignEnvelope` | `createSignatureRequest` when the provider is `DOCUSIGN` (`POST /signatures/requests`) | Document fetch and envelope creation cancel the body and throw a plain status error. The route does not catch it. The caller sees 500 `Something went wrong`. The request row stays `DRAFT` because the status update is after the throw. No retry classifier reads the error class. |
| `voidSignatureRequest` | `POST /signatures/requests/:id/void` | Provider HTTP failure is a plain status error. The existing test expects 500 `Something went wrong`, and the row stays `SENT`. |

The public signing route uses the INTERNAL link. It does not call these functions.

### 503 unset versus 500 malformed

Accepted. An unset `INTEGRATION_TOKEN_KEY` is a 503 whose message is `Integration token encryption is not configured`. A key that is present but not 64 hex characters is a plain Error and a 500 `Something went wrong`. A caller with `integrations:write` can tell those two apart. That is the point: an operator can see that the feature is not set up, and a bad key is not described. `import_failed` versus `chunk failed permanently: import_failed` tells the wizard whether retry is offered. It does not include driver text.

### Left as written

`hubspotFetch` puts the token in the Authorization header. The thrown path is `/crm/v3/objects/${objectType}` with `objectType` a fixed union, and query params are not part of that string. A 4xx whose `statusCode` is below 500 still returns `err.message`. That passthrough is older than this PR and is out of scope.

`judgeWithOpenAiCompatible` in `apps/api/src/evals/llm-judge.ts` throws `NVIDIA NIM eval judge error: <status>` and does not read the body. It also does not cancel it. Company news returns an empty list when the feed is not ok. The MCP clients read `text()` only after `response.ok`. Those are not not-ok body leaks. The scan in `scripts/scan-upstream-error-body.mjs` fails the hermeticity run if a not-ok branch throws or logs the response text.

Rows already stored are not rewritten here. The residual ticket is `polo-residual-scrub-error-summary-at-rest`, owner Tony.
