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

## Challenger: Sentinel
