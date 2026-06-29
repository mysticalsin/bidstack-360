# PII Field Encryption — Architecture & Runbook

> Last updated: 2026-06-28. Owner: Platform Security.

## Overview

BidStack 360° encrypts supported CRM/KAM PII fields stored in the `contacts`, `leads`, and `kam_consultants` database tables using AES-256-GCM with per-org HKDF-derived keys.

`User.email` is intentionally not field-encrypted yet: the current schema has no `User.emailHash` column, and auth/assignment flows still rely on case-insensitive email semantics. Treat `User.email` as covered by storage-level database encryption and access controls until a generated migration adds `users.email_hash` and the lookup path is certified.

Encryption is **opt-in** (default off) for backward compatibility. Operators enable it after running the one-shot migration script.

---

## Architecture

### Key hierarchy

```
PII_ENCRYPTION_MASTER_KEY  (32-byte hex, stored in secret manager)
        │
        └─ HKDF-SHA256(masterKey, orgId, "pii-field-v1")
                │
                └─ 32-byte org-scoped AES-256-GCM key
```

Per-org key derivation means:

- Rekeying one org does not affect others.
- A compromised org key does not expose other orgs' PII.
- Key rotation is scoped: generate a new master, re-derive, re-encrypt.

### Ciphertext envelope

```
enc:v1:<base64url-iv>:<base64url-auth-tag>:<base64url-ciphertext>
```

- **Version prefix** (`enc:v1:`) allows future algorithm migration without breaking existing rows.
- **IV**: 12 bytes random (per GCM recommendation).
- **Auth tag**: 16 bytes (GCM authenticated encryption — integrity verified on decrypt).
- **Ciphertext**: AES-256-GCM output.

### Searchable hash column

Equality lookup (find-by-email) without decryption uses a companion column:

```
Contact.emailHash = HMAC-SHA256(plaintext_email, org_derived_key)
Lead.emailHash    = HMAC-SHA256(plaintext_email, org_derived_key)
KamConsultant.emailHash = HMAC-SHA256(plaintext_email, org_derived_key)
```

Email hash input is trimmed and lowercased before hashing so encrypted lookups preserve the prior `citext`-style case-insensitive behavior. The hash is keyed with the org-derived key (not a static salt) so it is not vulnerable to offline preimage attacks without the master key.

### Prisma middleware

`packages/db/src/middleware/pii-encryption.ts` intercepts:

- **Writes** (`create`, `update`, `upsert`): encrypts plaintext values and computes hash columns.
- **Reads** (`findUnique`, `findMany`, etc.): decrypts ciphertext envelopes transparently.
- **Email equality filters**: rewrites `email` equality / `in` / `not` / `notIn` filters to `emailHash` for `Contact`, `Lead`, and `KamConsultant`.
- **Decryption failures**: return masked values (`***@***.***` for email, `***-***-****` for phone) — never crash.

The middleware is registered in `packages/db/src/index.ts` only when `PII_FIELD_ENCRYPTION=true`.

### PII field map

| Model         | Encrypted fields | Hash column |
| ------------- | ---------------- | ----------- |
| Contact       | email, phone     | emailHash   |
| Lead          | email, phone     | emailHash   |
| KamConsultant | email            | emailHash   |

**User.email note**: excluded until a generated `User.emailHash` migration and certified auth/assignment lookup path exist.

---

## Enabling PII Encryption (operator runbook)

### Prerequisites

1. Generate the master key:
   ```bash
   openssl rand -hex 32
   ```
2. Store in your secret manager (AWS Secrets Manager, Azure Key Vault, Vault, etc.).
3. Set `PII_ENCRYPTION_MASTER_KEY=<64-char-hex>` in the API and worker environment.

### Step-by-step

```
Step 1 — Provision key (above).

Step 2 — Run migration script (PII_FIELD_ENCRYPTION still OFF):
  tsx scripts/encrypt-existing-pii.ts --dry-run   # preview
  tsx scripts/encrypt-existing-pii.ts             # apply

Step 3 — Verify:
  Check script output for Contact, Lead, and KAM row counts: "X rows updated, Y skipped".
  Spot-check a row in psql:
    SELECT email FROM contacts LIMIT 1;
    -- should start with enc:v1:

Step 4 — Enable encryption:
  Set PII_FIELD_ENCRYPTION=true in env.
  Deploy (rolling restart — zero downtime; middleware activates on startup).

Step 5 — Confirm:
  New contacts/leads/KAM consultants created via API should have enc:v1:... email in DB.
  API responses should return plaintext (middleware decrypts on read).
```

---

## Key Rotation

```
Step 1 — Generate NEW_PII_ENCRYPTION_MASTER_KEY.
Step 2 — Add NEW_PII_ENCRYPTION_MASTER_KEY alongside existing key in env.
Step 3 — Write a one-off migration: decrypt with old key, re-encrypt with new key.
          (Pattern: same chunk loop as encrypt-existing-pii.ts)
Step 4 — Deploy migration.
Step 5 — Swap env: remove old key, rename new to PII_ENCRYPTION_MASTER_KEY.
Step 6 — Redeploy API.
```

**Never delete the old key before re-encryption is complete.**

---

## Rollback

If encryption must be reversed:

```bash
PII_ENCRYPTION_MASTER_KEY=<key> tsx scripts/decrypt-pii-rollback.ts --dry-run
PII_ENCRYPTION_MASTER_KEY=<key> tsx scripts/decrypt-pii-rollback.ts
```

Then set `PII_FIELD_ENCRYPTION=false` (or remove it) and redeploy.

---

## GDPR Consequences

### Data Subject Access Request (DSAR)

The Prisma middleware decrypts on every read, so standard API endpoints already return plaintext PII in responses. No special handling is required.

For bulk export (DSAR tooling or admin scripts), ensure `PII_ENCRYPTION_MASTER_KEY` is available in the execution environment.

### Right to Erasure

To erase a contact's PII without deleting the record (for audit trail integrity):

```sql
UPDATE contacts
SET email = NULL, phone = NULL, email_hash = NULL
WHERE id = '<contact-id>' AND org_id = '<org-id>';
```

Do not replace with the masked value — NULL is the correct erasure state. The audit log entry for the deletion is retained; the PII itself is gone.

### Retention / Archiving

Archived rows with `deleted_at IS NOT NULL` remain encrypted at rest. A GDPR purge job should NULL-out PII columns on rows past the retention window rather than dropping the row (to preserve referential integrity for audit logs).

---

## Security Properties

| Property                         | Status                                |
| -------------------------------- | ------------------------------------- |
| Encryption at rest               | AES-256-GCM                           |
| Key per org                      | HKDF-SHA256                           |
| Integrity verification           | GCM auth tag                          |
| Searchable without decrypt       | HMAC-SHA256 hash column               |
| Decryption failure handling      | Masked value, no crash                |
| Auth unaffected by email encrypt | User.email is not field-encrypted yet |
| Script idempotent                | `enc:v1:` prefix check                |
| Rollback available               | `decrypt-pii-rollback.ts`             |
