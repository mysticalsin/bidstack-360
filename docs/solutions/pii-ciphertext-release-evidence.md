# PII Ciphertext Release Evidence

Release PII proof should be privacy-safe and executable:

- Use `pnpm deploy:evidence:pii` after `scripts/encrypt-existing-pii.ts` dry-run/apply.
- The writer reads the release database directly and writes only aggregate counts to `deploy-evidence/pii-ciphertext-latest.json`.
- Do not include row IDs, plaintext PII, ciphertext samples, or email hashes in the artifact.
- Strict staging/production proof requires `Contact`, `Lead`, and `KamConsultant` email rows to be non-empty, encrypted with the `enc:v1:` prefix, and backed by valid 64-character email hashes.
- The deploy bundle preflight requires `BIDSTACK_PII_CIPHERTEXT_DATABASE_URL` or `DATABASE_URL`, `PII_FIELD_ENCRYPTION=true`, and `PII_ENCRYPTION_MASTER_KEY`.

Verification commands:

- `pnpm deploy:evidence:pii:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`
