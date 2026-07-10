# PII Live DB Ciphertext Regression

Mocking Prisma middleware only proves payload transformation. For PII-at-rest,
the release-critical invariant is what Postgres actually stores.

Pattern used in `packages/db/src/pii-field-encryption.integration.test.ts`:

- load the same root env convention used by API integration tests before Prisma
  constructs a client;
- set `PII_FIELD_ENCRYPTION=true` and a test master key before importing the
  `@bidstack/db` entrypoint;
- import the real singleton, not a hand-built test client, so removing
  `makePiiMiddleware()` registration from `src/index.ts` fails the test;
- write a minimal tenant-scoped Contact through Prisma;
- read `contacts.email`, `contacts.phone`, and `contacts.email_hash` with
  `$queryRaw`, because normal Prisma reads decrypt transparently and cannot prove
  storage posture;
- assert raw values are encrypted envelopes, not plaintext, and that `email_hash`
  equals the tenant-scoped HMAC used for equality lookups;
- finally read through Prisma and assert normal application reads still decrypt.

Keep this separate from release evidence. The integration test prevents code
regression. `deploy:evidence:pii` against staging/production proves the operator
backfill and release database state.
