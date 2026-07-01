# PII Ciphertext Release Evidence

Release PII proof should be privacy-safe and executable:

- Use `pnpm deploy:evidence:pii` after `scripts/encrypt-existing-pii.ts` dry-run/apply.
- The writer reads the release database directly and writes only aggregate counts to `deploy-evidence/pii-ciphertext-latest.json`.
- Do not include row IDs, plaintext PII, ciphertext samples, or email hashes in the artifact.
- Strict staging/production proof requires `Contact`, `Lead`, and `KamConsultant` email rows to be non-empty, encrypted with the `enc:v1:` prefix, and backed by valid 64-character email hashes.
- Strict staging/production proof also requires storage-at-rest evidence and a formal `User.email` posture. Current schema can only pass with `BIDSTACK_USER_EMAIL_AT_REST_DECISION=storage-encryption-only`; choosing field encryption instead requires a generated `User.emailHash` migration and certified lookup path before this gate can pass.
- Strict staging/production proof also requires an exact decision scope for current plaintext-at-field-level PII: `SmsMessage.fromNumber`, `SmsMessage.toNumber`, `SmsMessage.body`, `SmsConsent.phoneNumber`, `ActivityAttendee.email`, `CalendarEvent.attendees`, `KamSession.transcriptText`, and `KamSession.attendees`. Current schema can only pass with `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION=storage-encryption-only`, a reviewable owner/reference, and every field listed in `BIDSTACK_PLAINTEXT_PII_AT_REST_ACCEPTED_FIELDS`.
- The deploy bundle preflight requires `BIDSTACK_PII_CIPHERTEXT_DATABASE_URL` or `DATABASE_URL`, `PII_FIELD_ENCRYPTION=true`, `PII_ENCRYPTION_MASTER_KEY`, `BIDSTACK_STORAGE_ENCRYPTION_AT_REST=true`, `BIDSTACK_STORAGE_ENCRYPTION_PROVIDER`, `BIDSTACK_STORAGE_ENCRYPTION_EVIDENCE`, `BIDSTACK_USER_EMAIL_AT_REST_DECISION`, `BIDSTACK_USER_EMAIL_AT_REST_DECISION_REF`, `BIDSTACK_USER_EMAIL_AT_REST_DECISION_OWNER`, `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION`, `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION_REF`, `BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION_OWNER`, and `BIDSTACK_PLAINTEXT_PII_AT_REST_ACCEPTED_FIELDS`.

Verification commands:

- `pnpm deploy:evidence:pii:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`
