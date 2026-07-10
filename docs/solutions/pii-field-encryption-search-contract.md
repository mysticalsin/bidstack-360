# PII Field Encryption Search Contract

When a nullable email field is encrypted with random-IV AES-GCM, plaintext equality search stops working. A field is safe to add to `PII_MAP` only when the full contract is present:

- Schema has `emailHash String? @map("email_hash") @db.VarChar(64)` plus an `@@index([orgId, emailHash])`.
- Writes encrypt the email and store `hashPiiField(email, orgId)` before ciphertext replaces plaintext.
- `hashPiiField` canonicalizes email with `trim().toLowerCase()` so encrypted lookup preserves prior `citext` behavior.
- Middleware rewrites supported `where.email` equality filters (`string`, `equals`, `in`, `not`, `notIn`) to `where.emailHash`.
- Unsupported encrypted email operators fail loud rather than silently querying random ciphertext.
- Reads decrypt with the query orgId or the returned row's `orgId`; returning an `enc:v1:` value to app callers is a bug.
- Backfill and rollback scripts cover exactly the models in `PII_MAP`.

Do not field-encrypt `User.email` until a generated migration adds a hash column and auth/assignment lookup behavior is certified.
