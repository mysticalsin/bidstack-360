import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyClerkWebhookSignature } from './webhooks-clerk.js';

const KEY_B64 = Buffer.from('clerk-test-signing-key-32-bytes!').toString('base64');
const SECRET = `whsec_${KEY_B64}`;

function sign(rawBody: string, id: string, timestamp: string, secret = SECRET): string {
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe('verifyClerkWebhookSignature', () => {
  it('accepts a correctly signed payload (svix scheme: id.timestamp.body)', () => {
    const body = JSON.stringify({ type: 'organization.created', data: { id: 'org_1' } });
    const ts = nowSeconds();
    const sig = `v1,${sign(body, 'msg_1', ts)}`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET),
    ).toBe(true);
  });

  it('rejects a signature computed over a DIFFERENT body (tamper detection)', () => {
    const ts = nowSeconds();
    const sig = `v1,${sign('{"a":1}', 'msg_1', ts)}`;
    expect(
      verifyClerkWebhookSignature('{"a":2}', { id: 'msg_1', timestamp: ts, signature: sig }, SECRET),
    ).toBe(false);
  });

  it('rejects a signature bound to a different svix-id (splice protection)', () => {
    const body = '{"a":1}';
    const ts = nowSeconds();
    const sig = `v1,${sign(body, 'msg_original', ts)}`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_replayed', timestamp: ts, signature: sig }, SECRET),
    ).toBe(false);
  });

  it('rejects a timestamp outside the ±5 minute replay window', () => {
    const body = '{"a":1}';
    const stale = String(Math.floor(Date.now() / 1000) - 6 * 60);
    const sig = `v1,${sign(body, 'msg_1', stale)}`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: stale, signature: sig }, SECRET),
    ).toBe(false);
  });

  it('accepts when ANY space-separated v1 candidate matches (key rotation)', () => {
    const body = '{"a":1}';
    const ts = nowSeconds();
    const good = sign(body, 'msg_1', ts);
    const sig = `v1,${Buffer.from('wrong-signature-padding-to-32-bb').toString('base64')} v1,${good}`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET),
    ).toBe(true);
  });

  it('ignores non-v1 versions and malformed candidates without throwing', () => {
    const body = '{"a":1}';
    const ts = nowSeconds();
    const sig = `v2,${sign(body, 'msg_1', ts)} garbage v1`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: ts, signature: sig }, SECRET),
    ).toBe(false);
  });

  it('rejects non-numeric timestamps and empty keys', () => {
    const body = '{"a":1}';
    const ts = nowSeconds();
    const sig = `v1,${sign(body, 'msg_1', ts)}`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: 'soon', signature: sig }, SECRET),
    ).toBe(false);
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: ts, signature: sig }, 'whsec_'),
    ).toBe(false);
  });

  it('accepts a raw base64 secret without the whsec_ prefix', () => {
    const body = '{"a":1}';
    const ts = nowSeconds();
    const sig = `v1,${sign(body, 'msg_1', ts, KEY_B64)}`;
    expect(
      verifyClerkWebhookSignature(body, { id: 'msg_1', timestamp: ts, signature: sig }, KEY_B64),
    ).toBe(true);
  });
});
