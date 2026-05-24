/**
 * AES-256-GCM encryption for OAuth tokens stored in the database.
 *
 * WHY: Provider access/refresh tokens must be encrypted at rest so that a
 * database dump alone does not expose live OAuth credentials.
 *
 * Key source: process.env.INTEGRATION_TOKEN_KEY — 32-byte hex string.
 * If the key is absent the helpers throw so the caller fails loudly rather
 * than storing plaintext silently.
 *
 * Format: base64url("<12-byte-iv><16-byte-auth-tag><ciphertext>")
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;  // GCM recommended IV length
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_TOKEN_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: openssl rand -hex 32',
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts an OAuth access or refresh token for database storage.
 *
 * @param plaintext - The raw token string from the OAuth provider.
 * @returns Base64url-encoded AES-256-GCM envelope (iv + auth-tag + ciphertext).
 * @throws If `INTEGRATION_TOKEN_KEY` is not set or is not 64 hex characters.
 * @example
 * ```ts
 * const stored = encryptToken(accessToken);
 * await db.integration.update({ data: { accessTokenEncrypted: stored } });
 * ```
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Pack as iv || tag || ciphertext, then base64url-encode the whole blob
  const packed = Buffer.concat([iv, tag, encrypted]);
  return packed.toString('base64url');
}

/**
 * Decrypts an AES-256-GCM encrypted OAuth token previously produced by {@link encryptToken}.
 *
 * @param ciphertext - Base64url-encoded envelope from the database.
 * @returns The original plaintext token string.
 * @throws If the ciphertext is malformed, the auth tag fails, or the key is missing.
 * @example
 * ```ts
 * const token = decryptToken(row.accessTokenEncrypted);
 * // Use token for API call
 * ```
 */
export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const packed = Buffer.from(ciphertext, 'base64url');

  if (packed.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Ciphertext is too short to be a valid encrypted token');
  }

  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = packed.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
