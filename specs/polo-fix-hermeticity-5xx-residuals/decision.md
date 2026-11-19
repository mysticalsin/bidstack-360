# Decision: 503, secret text, and the migration sentinel

Ticket: `polo-fix-hermeticity-5xx-residuals`
Code head: `e7defdb07c1c752ea9091a265a9f748734e145ac`
Tree: `01f3d6b7fdd428f82b7cd260544be86f2da4ade2`

## Why 503 instead of 500

A missing HubSpot OAuth app and a missing `INTEGRATION_TOKEN_KEY` are setup gaps. The route or the crypto helper already knows the safe sentence. Returning 500 `Something went wrong` hides that.

The error handler keeps a 503 only when the error name is `ServiceUnavailableError` (Fastify `httpErrors.serviceUnavailable`) or `IntegrationTokenKeyMissingError`.

| Case | Status | Body message |
| --- | --- | --- |
| HubSpot auth with no client id or redirect URI | 503 | `HubSpot OAuth not configured — set HUBSPOT_CLIENT_ID and HUBSPOT_REDIRECT_URI` |
| Slack OAuth start with the token key unset | 503 | `Integration token encryption is not configured` |
| Any other thrown error, including a DocuSign error that only sets `statusCode` | 500 | `Something went wrong` |

A malformed token key stays a plain Error, so it is a generic 500. The key value is never copied into the message.

Gmail and Microsoft already answered 503 by sending the response in the route. This change does not add a second catch there. Slack and HubSpot go through the one handler branch.

## How secret text is scrubbed

`discardUpstreamBody` reads a failed provider response and drops the bytes. Callers log the status only. They throw an error whose message is the provider name and the status, not the body.

The HubSpot token-exchange route does not interpolate `err.message` into the HTTP response. It throws a bad gateway with the fixed sentence `HubSpot token exchange failed`. That is not a `ServiceUnavailableError`, so the handler replaces it with 500 `Something went wrong`. The upstream body is not in the log line and not in the HTTP body.

There is no log redaction rule on a field named `body`. That name is used for ordinary payloads. The body is discarded before it is logged.

## Migration text sentinel

Unknown text stored on `errorSummary` is not returned.

- `GET /migrations/:id` uses `migrationPublicMessage`. Unknown text, including driver and provider text, becomes the sentinel `import_failed`.
- A stored message that starts with `chunk failed permanently:` becomes `chunk failed permanently: import_failed`. The prefix stays so the wizard still refuses a retry. The raw tail does not.
- Known codes (`enqueue_failed`, `rows_expired`, `import_conflict`, `enqueue_stopped`, `stale`, and the legacy sentences) stay as stored. Known row sentences such as `company.name is required` stay as stored. The wizard keys on those.
- HubSpot sync-now uses `migrationFailureText`. Unknown text becomes the sentence `The import could not be completed.`

The test sentinel for a provider-shaped summary is the plain marker `hubspot-body-marker` plus `buyer@secret.example`. Neither string may appear on the sync-now run. The test sentinel for a logged Gmail body is `provider-body-SENTINEL-upstream-text`.
