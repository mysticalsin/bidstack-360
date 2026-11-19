# Plan debate: polo-fix-hermeticity-5xx-residuals

Pinned head: `e7defdb07c1c752ea9091a265a9f748734e145ac`
Pinned tree: `01f3d6b7fdd428f82b7cd260544be86f2da4ade2`
Base main named by the validator: `1eada22cad1a82030941dc72506e07fbc6897859`
Clean merge tree named by the validator: `50abebc6`
Validator report sha: `f8b57629`

CONSENSUS: OPEN

## Proposal (writer)

The plan is `specs/polo-fix-hermeticity-5xx-residuals/plan.md`.

Ship the code already on the pinned head. Do not change product behavior in the docs commit that adds this file.

- Stop the two API tests from using `org_seed_mantu`. Use `createIsolatedOrg()` and `useIsolatedOrgAuth()`.
- Pass a deliberate 503 through once: Fastify `ServiceUnavailableError`, and `IntegrationTokenKeyMissingError`. Everything else at 500 stays `Something went wrong`.
- Throw that typed error from both integration-token key readers when the key is unset. A malformed key stays a plain Error.
- Drain upstream provider error bodies and do not log or throw them. Keep the HTTP status. The HubSpot token-exchange HTTP message is the fixed sentence `HubSpot token exchange failed`, which the handler then masks to a generic 500 because it is a bad gateway, not a deliberate 503.
- On the way out of `GET /migrations/:id`, map unknown `errorSummary` text to `import_failed`. Keep known codes and known row sentences. Keep the `chunk failed permanently:` prefix with the sentinel `import_failed`. HubSpot sync-now shows `The import could not be completed.`
- Do not add a migration. Do not edit the void cleanup. Do not change the migration race timeout.

## Challenger: Devin

Round 1, pinned to e7defdb07c1c752ea9091a265a9f748734e145ac (tree 01f3d6b7), read at docs head ce55a63a. CONSENSUS (Devin): OBJECTIONS.

1. The 503 bodies give API callers env var names (HUBSPOT_CLIENT_ID, HUBSPOT_REDIRECT_URI). State in decision.md who can reach each route: admin only, any signed-in user, or unauthenticated. If anyone other than an admin can reach it, return a generic "integration not configured" sentence and keep the env var names in the server log.
2. The handler keeps a 503 based on the error *name* string. Any error that sets name = 'ServiceUnavailableError' or 'IntegrationTokenKeyMissingError', such as a library or provider error, would pass its message straight through. Change: match on instanceof or a private brand. Test: a plain Error with a forged name, carrying secret-looking text, returns 500 'Something went wrong'.
3. The known-sentence allowlist for errorSummary must be an exact match. Tests: 'company.name is required' followed by driver text, and a known code with a suffix, both map to import_failed. 'chunk failed permanently:' plus raw text maps to 'chunk failed permanently: import_failed' (already claimed, so name the test).
4. Raw errorSummary text already stored stays at rest. List every reader of errorSummary (API, exports, admin views, logs) in decision.md, show that each one goes through migrationPublicMessage or migrationFailureText, and open a ticket for scrubbing data at rest as a residual.
5. discardUpstreamBody should cancel the stream, or cap the read, rather than draining an unbounded provider body. Note that in decision.md, or change it.
6. Merge needs Inspector's hands-on run of qa-inspector.md on the final head, and my exact-head re-gate. Any code change from items 1-3 moves the head and voids PASS evidence on e7defdb0.

## Writer response, round 1

1. Accepted, with the audience split in `decision.md`. `GET /api/v1/migrations/hubspot/auth` is `settings:write`, seeded only on Admin, so it still names `HUBSPOT_CLIENT_ID` and `HUBSPOT_REDIRECT_URI`. The unauthenticated callback already says `HubSpot OAuth not configured` and does not name them. Slack is `integrations:write` (Admin, Sales, Sales Manager, Account Executive, SDR, Customer Success) and already says `Integration token encryption is not configured`. Public Dust and Clerk webhooks, public Sentry smoke, Clerk auth (`CLERK_SECRET_KEY`, `PUBLIC_BASE_URL`), and a bad Cloudflare Access allowlist now return `integration not configured`. The env var name is logged as `missingEnv`. Red: `ddc4cee2356c684b638fcc63676eac24b956ad0d`, failing assertion `message` was `CLERK_WEBHOOK_SECRET not configured` (and the same shape for `DUST_WEBHOOK_SECRET`, `SENTRY_DSN`, `SENTRY_RELEASE`, `SENTRY_SMOKE_TOKEN`, `POLO_ALLOWED_USERS`, `CLERK_SECRET_KEY`, `PUBLIC_BASE_URL`). Fix: `9a369689ffb0246084c13abd5abb47981c9aea0f`.

2. Accepted. The handler no longer compares `err.name`. A service-unavailable 503 must share the prototype of `server.httpErrors.serviceUnavailable`. The token-key error must be `instanceof IntegrationTokenKeyMissingError`. Red: `002dcf3ac65f2bfde3071dd98755ef4db382ca2a`, failing assertion `expected 503 to be 500` for a plain Error named `ServiceUnavailableError` whose message contains `secret-token`. The follow-up red `ee27153e2fb2714ae7ddfcbeef928c319c05511a` adds the same assertion for a plain Error named `IntegrationTokenKeyMissingError`. Fix: `72240feb994d248be35bb7de5cd7939ee07303a2`. Both now return 500 `Something went wrong`, and the body does not contain `secret-token`.

3. The allowlist was already exact (`===` on the code map and the row-sentence set, plus two anchored expressions). No product change. New tests, green on that code, commit `14aad56bc3565dedff3c01237b83e77fb3c17a8a`: `maps company.name is required followed by driver text to import_failed`, `maps a known code with a suffix to import_failed`, and the named test `maps chunk failed permanently plus raw text to chunk failed permanently: import_failed`.

4. Readers are listed in `decision.md`. Job JSON goes through `migrationPublicMessage`. The CSV download and HubSpot sync-now reasons go through `migrationFailureText`. The wizard reads that API payload and calls `migrationFailureText` again. No log line prints the column. `POST /migrations/:id/retry` reads the stored strings only to decide `migrationRetryOffered` and returns `serializeJob`, so the HTTP body is mapped. The stored JSON is not rewritten. Residual ticket: `specs/polo-fix-hermeticity-5xx-residuals/residual-scrub-error-summary-at-rest.md`.

5. Changed, not only noted. `discardUpstreamBody` cancels the stream and does not call `text()`. Red: `421e96a6dfb2c086066a1e538c92ea57900ca6b1`, failing assertion `expected false to be true` on `cancelled`. Fix: `24d1c359b0427701e5ed87ed3a9d2a8b5e66b937`.

6. Agreed. Items 1 and 2 changed product code, so PASS evidence on `e7defdb0` is void. Item 3 did not change product code. Item 5 also changed product code. Merge waits on Inspector running `qa-inspector.md` on the final head, and on Devin's exact-head re-gate. This response does not merge. The polo-preview Worker and the deploy config were not touched. Deploy stays held for Tony's Q1.

## Challenger: Sentinel
