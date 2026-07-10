// AES-256-GCM envelope encryption for at-rest secrets (OAuth tokens, refresh
// tokens, webhook signing secrets).
//
// Why GCM: authenticated encryption — a tampered ciphertext fails on decrypt
// rather than returning garbled plaintext. Why a fresh IV per call: GCM's
// security collapses if the same (key, IV) pair encrypts two different
// messages. We pack version + iv + tag + ciphertext into a single base64url
// blob so the column stays a TEXT field and migrations don't have to manage
// three columns per secret.
//
// The master key (`INTEGRATION_TOKEN_KEY`) must be a 32-byte value supplied
// out of band as a 64-character hex string, typically generated once with
// `openssl rand -hex 32` and stored in a secret manager. A non-conforming
// value throws before any secret is encrypted or decrypted.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12; // GCM standard — 96-bit nonces
const TAG_LENGTH_BYTES = 16;
const VERSION = 0x01; // bump if we ever change algorithm/layout
const WEBHOOK_SIGNING_SECRET_PREFIX = 'whsec_';
const WEBHOOK_SIGNING_SECRET_HASH_PURPOSE = 'webhook-signing-secret-lookup-v1';

function decodeMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  throw new Error(
    `INTEGRATION_TOKEN_KEY must be a 64-character hex string (${KEY_LENGTH_BYTES} bytes). Got length ${trimmed.length}.`,
  );
}

let cachedKey: Buffer | null = null;

/** Resolve the master key from `INTEGRATION_TOKEN_KEY`. Cached per process. */
export function getIntegrationTokenKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_TOKEN_KEY;
  if (!raw) {
    throw new Error('INTEGRATION_TOKEN_KEY env var is required to encrypt integration tokens');
  }
  cachedKey = decodeMasterKey(raw);
  return cachedKey;
}

/** Reset the cached key — exposed for tests only. Do not call in app code. */
export function _resetIntegrationTokenKey(): void {
  cachedKey = null;
}

/**
 * Encrypt a plaintext secret. Returns a URL-safe single string that can be
 * stored in a TEXT column. Output is non-deterministic — encrypting the same
 * plaintext twice gives different ciphertexts (because the IV is fresh).
 */
export function encryptSecret(plaintext: string, key?: Buffer): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret requires a non-empty string plaintext');
  }
  const masterKey = key ?? getIntegrationTokenKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: TAG_LENGTH_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphertext]);
  return packed.toString('base64url');
}

/**
 * Decrypt a previously encrypted blob. Throws if the blob is malformed, the
 * version is unknown, or the authentication tag fails. Callers should treat
 * a thrown error as an integrity violation, not a transient failure.
 */
export function decryptSecret(blob: string, key?: Buffer): string {
  if (typeof blob !== 'string' || blob.length === 0) {
    throw new Error('decryptSecret requires a non-empty string blob');
  }
  const masterKey = key ?? getIntegrationTokenKey();
  const packed = Buffer.from(blob, 'base64url');
  if (packed.length < 1 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES + 1) {
    throw new Error('decryptSecret: blob too short');
  }
  const version = packed[0];
  if (version !== VERSION) {
    throw new Error(`decryptSecret: unsupported version ${version}`);
  }
  const iv = packed.subarray(1, 1 + IV_LENGTH_BYTES);
  const tag = packed.subarray(1 + IV_LENGTH_BYTES, 1 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES);
  const ciphertext = packed.subarray(1 + IV_LENGTH_BYTES + TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
    authTagLength: TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Decrypt a blob, but fall back to returning the input unchanged if it is not a
 * valid encrypted blob. Used for in-place at-rest migration of columns that may
 * still hold legacy PLAINTEXT secrets (written before encryption was added) —
 * new writes are encrypted, old plaintext is read as-is until backfilled. Only
 * use where the column is transitioning; never as a general "decrypt maybe".
 */
export function decryptSecretOrPlaintext(value: string, key?: Buffer): string {
  try {
    return decryptSecret(value, key);
  } catch {
    return value;
  }
}

function isProductionLikeRuntime(): boolean {
  const nodeEnv = String(process.env.NODE_ENV ?? '')
    .trim()
    .toLowerCase();
  const deployEnv = String(process.env.BIDSTACK_DEPLOY_ENV ?? '')
    .trim()
    .toLowerCase();
  return nodeEnv === 'production' || deployEnv === 'production' || deployEnv === 'staging';
}

function allowsLegacyWebhookPlaintext(): boolean {
  const raw = process.env.BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK;
  if (raw !== undefined) {
    return ['1', 'true', 'yes', 'y'].includes(raw.trim().toLowerCase());
  }
  return !isProductionLikeRuntime();
}

export function isLegacyWebhookSigningSecret(value: string): boolean {
  return typeof value === 'string' && value.startsWith(WEBHOOK_SIGNING_SECRET_PREFIX);
}

/**
 * Deterministic keyed lookup hash for webhook signing secrets.
 *
 * Secret ciphertext uses a random IV, so equality lookup must not query the
 * encrypted `secret` column. This HMAC gives inbound webhook receivers a stable
 * DB lookup without storing or logging the raw signing secret.
 */
export function hashWebhookSigningSecret(secret: string, key?: Buffer): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('hashWebhookSigningSecret requires a non-empty string secret');
  }
  const masterKey = key ?? getIntegrationTokenKey();
  return createHmac('sha256', masterKey)
    .update(WEBHOOK_SIGNING_SECRET_HASH_PURPOSE)
    .update('\0')
    .update(secret, 'utf8')
    .digest('hex');
}

/**
 * Decrypt an outbound webhook signing secret and fail closed for malformed data.
 * Historical plaintext `whsec_` rows can be read only outside production-like
 * runtimes, or when an operator explicitly enables the one-time fallback while
 * running the backfill. Do not use this for other secret columns.
 */
export function decryptWebhookSigningSecret(value: string, key?: Buffer): string {
  try {
    return decryptSecret(value, key);
  } catch (error) {
    if (!isLegacyWebhookSigningSecret(value)) {
      throw new Error(
        `Webhook signing secret is not decryptable and is not a legacy ${WEBHOOK_SIGNING_SECRET_PREFIX} secret.`,
        { cause: error },
      );
    }

    if (!allowsLegacyWebhookPlaintext()) {
      throw new Error(
        'Legacy plaintext webhook signing secrets are disabled; run scripts/encrypt-webhook-secrets.ts before delivery.',
        { cause: error },
      );
    }

    return value;
  }
}

/** Constant-time compare for string secrets (CSRF state, signing keys, etc.). */
export function safeCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  // timingSafeEqual requires equal-length inputs — pad to the longer side.
  // Always fail if lengths differ regardless of comparison result.
  if (aBuf.length !== bBuf.length) {
    const max = Math.max(aBuf.length, bBuf.length);
    const padA = Buffer.concat([aBuf, Buffer.alloc(max - aBuf.length)]);
    const padB = Buffer.concat([bBuf, Buffer.alloc(max - bBuf.length)]);
    timingSafeEqual(padA, padB); // run comparison to avoid timing leak via early return
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
