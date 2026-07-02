/**
 * AES-256-GCM encryption for PII fields stored in the database.
 *
 * WHY: Contact/Lead email and phone values must be encrypted at rest so that a
 * database dump alone cannot expose live PII. Unlike token-cipher.ts (which uses
 * a single shared key), PII fields use per-org key derivation via HKDF so that
 * org-level key rotation is possible without re-encrypting every other org's data.
 *
 * Envelope format: `enc:v1:<base64url-iv>:<base64url-tag>:<base64url-ciphertext>`
 *
 * Key source: HKDF(PII_ENCRYPTION_MASTER_KEY, orgId) → 32-byte derived key.
 * PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 raw bytes).
 *
 * SHA-256 hash for searchable equality: stored in a companion `*_hash` column
 * so equality lookups (find-by-email) work without decrypting every row.
 * Email hash input is trimmed + lowercased so encrypted lookup preserves the
 * previous citext-like case-insensitive semantics. The hash is
 * HMAC-SHA256(canonical_plaintext, derivedKey) — keyed so that the hash is not
 * preimage-attackable without the master key.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENC_PREFIX = 'enc:v1:';

// Masks returned on decryption failure — must NEVER expose partial plaintext.
const EMAIL_MASK = '***@***.***';
const PHONE_MASK = '***-***-****';

/**
 * Discriminates which type of PII field is being processed.
 * Used to select the appropriate masking string on decryption failure.
 */
export type PiiFieldType = 'email' | 'phone';

function getMasterKeyBuffer(): Buffer {
  const hex = process.env.PII_ENCRYPTION_MASTER_KEY;
  if (!hex || hex.length !== 64) {
    // A value that is 64 chars only after trim() means the secret was stored
    // with padding (e.g. `echo` appends \n). Name that cause explicitly — the
    // boot validators check the RAW value for the same reason, so ops can fix
    // the secret instead of chasing a "wrong key" red herring.
    const whitespaceHint =
      hex && hex.trim().length === 64
        ? ' The configured value has surrounding whitespace or a newline — remove the padding; the cipher reads the raw value.'
        : '';
    throw new Error(
      'PII_ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32' +
        whitespaceHint,
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Derive a 32-byte org-scoped encryption key via HKDF-SHA256.
 * WHY: Per-org keys mean a compromised key only exposes one org's PII
 * and rotation is scoped — other orgs are unaffected.
 */
function deriveOrgKey(orgId: string): Buffer {
  const master = getMasterKeyBuffer();
  return Buffer.from(hkdfSync('sha256', master, Buffer.from(orgId, 'utf8'), 'pii-field-v1', 32));
}

/**
 * Returns `true` if the value is an `enc:v1:` envelope produced by {@link encryptPiiField}.
 *
 * @param value - The string read from the database column.
 * @returns `true` if the value is already encrypted, `false` if plaintext.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

/**
 * Encrypt a PII field value.
 * Idempotent: returns the input unchanged if it is already an enc:v1 envelope.
 */
export function encryptPiiField(plaintext: string, orgId: string): string {
  if (isEncrypted(plaintext)) return plaintext;

  const key = deriveOrgKey(orgId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return (
    ENC_PREFIX +
    iv.toString('base64url') +
    ':' +
    tag.toString('base64url') +
    ':' +
    ciphertext.toString('base64url')
  );
}

/**
 * Decrypt a PII field value.
 * Returns the mask string on any error — never throws, never crashes the caller.
 */
export function decryptPiiField(envelope: string, orgId: string, fieldType: PiiFieldType): string {
  if (!isEncrypted(envelope)) return envelope; // plaintext (pre-migration or encryption disabled)

  const mask = fieldType === 'email' ? EMAIL_MASK : PHONE_MASK;
  const inner = envelope.slice(ENC_PREFIX.length);
  const parts = inner.split(':');

  if (parts.length !== 3) return mask;

  try {
    const [ivB64, tagB64, ctB64] = parts;
    const key = deriveOrgKey(orgId);
    const iv = Buffer.from(ivB64!, 'base64url');
    const tag = Buffer.from(tagB64!, 'base64url');
    const ct = Buffer.from(ctB64!, 'base64url');

    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return mask;

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return mask;
  }
}

/**
 * Compute HMAC-SHA256 of plaintext using the org-derived key.
 * WHY: Keyed hash prevents rainbow-table attacks against the hash column.
 * Stored in Contact.emailHash / Lead.emailHash for equality lookup without decrypt.
 */
export function hashPiiField(plaintext: string, orgId: string): string {
  const key = deriveOrgKey(orgId);
  const canonical = plaintext.trim().toLowerCase();
  return createHmac('sha256', key).update(canonical, 'utf8').digest('hex');
}
