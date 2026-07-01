# Plaintext PII Decision Evidence

## Problem

`Contact`, `Lead`, and `KamConsultant` have field-level ciphertext proof, but
several real-data fields are intentionally still plaintext at the column level:
`SmsMessage.fromNumber`, `SmsMessage.toNumber`, `SmsMessage.body`,
`SmsConsent.phoneNumber`, `ActivityAttendee.email`, `CalendarEvent.attendees`,
`KamSession.transcriptText`, and `KamSession.attendees`.

Those fields may be acceptable for a release only if platform storage encryption
and privacy/security sign-off explicitly cover the exact scope. A vague
"storage encryption exists" claim is not enough for real customer data.

## Pattern

`pnpm deploy:evidence:pii` writes a privacy-safe `atRestControls.plaintextPii`
section with:

- `decision=storage-encryption-only`
- reviewable `decisionRef`
- reviewable `owner`
- exact `acceptedFields` coverage for every required plaintext-PII field
- `rawValuesIncluded=false`

The strict verifier and release bundle preflight both fail closed when the
decision is missing, placeholder-like, incomplete, or includes unsupported field
names.

## Operator Contract

Set these before staging/production evidence runs:

```bash
BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION=storage-encryption-only
BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION_REF=<real-DPIA-or-security-approval>
BIDSTACK_PLAINTEXT_PII_AT_REST_DECISION_OWNER=<owner>
BIDSTACK_PLAINTEXT_PII_AT_REST_ACCEPTED_FIELDS=SmsMessage.fromNumber,SmsMessage.toNumber,SmsMessage.body,SmsConsent.phoneNumber,ActivityAttendee.email,CalendarEvent.attendees,KamSession.transcriptText,KamSession.attendees
```

If security chooses field encryption instead, add the schema/migration and
lookup changes first, then update this required field list and evidence gate.

## Verification

- `pnpm deploy:evidence:pii:selftest`
- `pnpm deploy:evidence:selftest`
- `pnpm deploy:evidence:bundle:selftest`
