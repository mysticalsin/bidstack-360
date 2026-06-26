import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import {
  _resetIntegrationTokenKey,
  decryptSecret,
  decryptSecretOrPlaintext,
  encryptSecret,
  getIntegrationTokenKey,
} from './crypto.js';

const originalIntegrationTokenKey = process.env.INTEGRATION_TOKEN_KEY;

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
});

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
      expect(decryptSecretOrPlaintext('legacy-plaintext-fixture')).toBe(
        'legacy-plaintext-fixture',
      );
    });
  });
});
