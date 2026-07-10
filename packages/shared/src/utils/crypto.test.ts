import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetIntegrationTokenKey,
  decryptSecret,
  decryptSecretOrPlaintext,
  decryptWebhookSigningSecret,
  encryptSecret,
  getIntegrationTokenKey,
  hashWebhookSigningSecret,
} from './crypto.js';

const originalIntegrationTokenKey = process.env.INTEGRATION_TOKEN_KEY;
const originalNodeEnv = process.env.NODE_ENV;
const originalDeployEnv = process.env.BIDSTACK_DEPLOY_ENV;
const originalWebhookFallback = process.env.BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK;

function setIntegrationTokenKey(value: string | undefined): void {
  _resetIntegrationTokenKey();
  if (value === undefined) {
    delete process.env.INTEGRATION_TOKEN_KEY;
    return;
  }
  process.env.INTEGRATION_TOKEN_KEY = value;
}

afterEach(() => {
  setIntegrationTokenKey(originalIntegrationTokenKey);
  restoreEnv('NODE_ENV', originalNodeEnv);
  restoreEnv('BIDSTACK_DEPLOY_ENV', originalDeployEnv);
  restoreEnv('BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK', originalWebhookFallback);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe('server secret crypto', () => {
  it('round-trips at-rest secrets with non-deterministic ciphertext', () => {
    setIntegrationTokenKey(randomBytes(32).toString('hex'));

    const first = encryptSecret(JSON.stringify({ apiKey: 'provider-secret' }));
    const second = encryptSecret(JSON.stringify({ apiKey: 'provider-secret' }));

    expect(first).not.toBe(second);
    expect(JSON.parse(decryptSecret(first))).toEqual({ apiKey: 'provider-secret' });
    expect(JSON.parse(decryptSecret(second))).toEqual({ apiKey: 'provider-secret' });
  });

  it('rejects legacy base64 key material so every secret boundary has one operator contract', () => {
    setIntegrationTokenKey(randomBytes(32).toString('base64'));

    expect(() => getIntegrationTokenKey()).toThrow('64-character hex string');
  });

  it('rejects non-hex values even when they are 64 characters long', () => {
    setIntegrationTokenKey('z'.repeat(64));

    expect(() => getIntegrationTokenKey()).toThrow('64-character hex string');
  });

  it('fails closed when the integration token key is missing', () => {
    setIntegrationTokenKey(undefined);

    expect(() => getIntegrationTokenKey()).toThrow('INTEGRATION_TOKEN_KEY env var is required');
  });

  describe('decryptSecretOrPlaintext (in-place at-rest migration)', () => {
    it('decrypts a real encrypted blob', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      const blob = encryptSecret('signing-secret-fixture');
      expect(decryptSecretOrPlaintext(blob)).toBe('signing-secret-fixture');
    });

    it('returns legacy plaintext unchanged (not a valid blob)', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      // A pre-encryption plaintext secret must pass through, not throw.
      expect(decryptSecretOrPlaintext('legacy-plaintext-fixture')).toBe('legacy-plaintext-fixture');
    });
  });

  describe('decryptWebhookSigningSecret (strict outbound webhook runtime)', () => {
    it('decrypts encrypted webhook signing secrets', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      const blob = encryptSecret('whsec_encrypted_fixture');

      expect(decryptWebhookSigningSecret(blob)).toBe('whsec_encrypted_fixture');
    });

    it('allows legacy whsec plaintext outside production so local backfills can run', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      process.env.NODE_ENV = 'test';
      delete process.env.BIDSTACK_DEPLOY_ENV;
      delete process.env.BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK;

      expect(decryptWebhookSigningSecret('whsec_legacy_fixture')).toBe('whsec_legacy_fixture');
    });

    it('rejects legacy plaintext by default in production-like runtimes', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      process.env.NODE_ENV = 'production';
      delete process.env.BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK;

      expect(() => decryptWebhookSigningSecret('whsec_legacy_fixture')).toThrow(
        'Legacy plaintext webhook signing secrets are disabled',
      );
    });

    it('allows production legacy plaintext only when the operator explicitly enables fallback', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      process.env.NODE_ENV = 'production';
      process.env.BIDSTACK_WEBHOOK_SECRET_PLAINTEXT_FALLBACK = 'true';

      expect(decryptWebhookSigningSecret('whsec_legacy_fixture')).toBe('whsec_legacy_fixture');
    });

    it('rejects malformed non-whsec values instead of returning arbitrary plaintext', () => {
      setIntegrationTokenKey(randomBytes(32).toString('hex'));
      process.env.NODE_ENV = 'test';

      expect(() => decryptWebhookSigningSecret('legacy-plaintext-fixture')).toThrow(
        'not a legacy whsec_ secret',
      );
    });
  });

  describe('hashWebhookSigningSecret (deterministic lookup hash)', () => {
    it('creates stable keyed lookup hashes without matching raw SHA-256', () => {
      const key = randomBytes(32);
      const first = hashWebhookSigningSecret('whsec_lookup_fixture', key);
      const second = hashWebhookSigningSecret('whsec_lookup_fixture', key);
      const otherKey = hashWebhookSigningSecret('whsec_lookup_fixture', randomBytes(32));

      expect(first).toMatch(/^[a-f0-9]{64}$/);
      expect(second).toBe(first);
      expect(otherKey).not.toBe(first);
    });

    it('requires the integration token key when a key is not passed', () => {
      setIntegrationTokenKey(undefined);

      expect(() => hashWebhookSigningSecret('whsec_lookup_fixture')).toThrow(
        'INTEGRATION_TOKEN_KEY env var is required',
      );
    });
  });
});
