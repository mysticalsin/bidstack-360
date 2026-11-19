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

## Challenger: Sentinel
