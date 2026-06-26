import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from './token-cipher.js';

const originalIntegrationTokenKey = process.env.INTEGRATION_TOKEN_KEY;

function setIntegrationTokenKey(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.INTEGRATION_TOKEN_KEY;
    return;
  }
  process.env.INTEGRATION_TOKEN_KEY = value;
}

afterEach(() => {
  setIntegrationTokenKey(originalIntegrationTokenKey);
});

describe('token-cipher', () => {
  it('round-trips OAuth tokens without deterministic ciphertext reuse', () => {
    setIntegrationTokenKey(randomBytes(32).toString('hex'));

    const first = encryptToken('oauth-refresh-token');
    const second = encryptToken('oauth-refresh-token');

    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe('oauth-refresh-token');
    expect(decryptToken(second)).toBe('oauth-refresh-token');
  });

  it('fails closed when the integration token key is missing', () => {
    setIntegrationTokenKey(undefined);

    expect(() => encryptToken('oauth-refresh-token')).toThrow(
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string',
    );
  });

  it('rejects non-hex values even when they are 64 characters long', () => {
    setIntegrationTokenKey('z'.repeat(64));

    expect(() => encryptToken('oauth-refresh-token')).toThrow(
      'INTEGRATION_TOKEN_KEY must be a 64-character hex string',
    );
  });

  it('rejects malformed ciphertext before decrypting', () => {
    setIntegrationTokenKey(randomBytes(32).toString('hex'));

    expect(() => decryptToken(Buffer.from('too-short').toString('base64url'))).toThrow(
      'Ciphertext is too short to be a valid encrypted token',
    );
  });
});
