# KAM PII handling (Initiative/Session/Consultant)

**Context:** KAM front layer stores consultant identities and workshop
transcripts. The red-team (B6) flagged that the existing `PII_MAP` only covers
scalar `email`/`phone` and cannot touch `String[]` or free-text, so KAM PII
needed an explicit decision rather than an asserted "Contact PII pattern".

## Decision

| Field | Treatment | Why |
|-------|-----------|-----|
| `KamConsultant.email` | **Encrypted + HMAC-hashed** via the field-encryption middleware (`kamconsultant` added to `PII_MAP`, `email → emailHash`). | Same protection as `Contact`/`Lead`; lookups use `emailHash`. |
| `KamConsultant.name` | Plaintext. | Employee display name; needed in every list/board; low sensitivity, in-tenant + access-scoped. |
| `KamSession.attendees[]` | **Plaintext at rest** (string array — outside the scalar middleware scope). | Display names of meeting attendees; access-scoped + audited. |
| `KamSession.transcriptText` | **Plaintext at rest**; access-scoped + audited. | The transcript IS the AI input by design — it must be readable to organize into a note. Encrypting then decrypting on every read adds no real protection here. |
| AI prompts | A consultant flagged `aiOptOut=true` has their PII **excluded** from enrichment prompts (honored by the transcript-organize step in S3). | Mirrors `Contact.aiOptOut`. |

## Consequences / follow-ups

- `transcriptText`/`attendees[]` are plaintext PII at rest. Mitigations: org
  scoping (`org_id`), in-tenant access scope (`ensureAccountVisible`), audit
  logging, and soft-delete. A future at-rest encryption pass (pgcrypto column
  or app-layer) is possible but out of KAM v1 scope.
- Do NOT add `transcriptText`/`attendees` to `PII_MAP` — the middleware only
  handles scalar encrypt/decrypt and would corrupt arrays / break the AI read
  path. If at-rest encryption is wanted later, do it as a dedicated transcript
  cipher with an explicit decrypt-for-AI path.
- GDPR erasure: deleting a `KamSession` cascades nothing sensitive beyond its
  own row + drafts; consultant erasure soft-deletes `KamConsultant`.

Related: [[pii-field-encryption]] runbook (`docs/security/pii-field-encryption.md`).
