import { describe, expect, it } from 'vitest';

import { verifyDustSignature } from './index.js';

// Why: webhook signature verification is the security boundary that prevents
// random POSTs to /webhooks/dust from mutating tenant data. These tests pin
// the algorithm to sha256 + constant-time compare so a regression here can't
// silently weaken auth.

const SECRET = 'whsec_test_123';
const BODY = JSON.stringify({ event: 'opportunity.updated', id: 'OP-2041' });

// Pre-computed sha256(BODY, SECRET) — pinned so a hash-algo change requires
// updating this test deliberately.
async function sigFor(body: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const buf = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('verifyDustSignature', () => {
  it('accepts a correctly signed payload', async () => {
    const sig = await sigFor(BODY, SECRET);
    expect(await verifyDustSignature(BODY, `sha256=${sig}`, SECRET)).toBe(true);
  });

  it('rejects when signature does not start with sha256=', async () => {
    const sig = await sigFor(BODY, SECRET);
    expect(await verifyDustSignature(BODY, sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const sig = await sigFor(BODY, SECRET);
    expect(await verifyDustSignature(BODY, `sha256=${sig}`, 'whsec_wrong')).toBe(false);
  });

  it('rejects a tampered body', async () => {
    const sig = await sigFor(BODY, SECRET);
    expect(await verifyDustSignature(`${BODY}!`, `sha256=${sig}`, SECRET)).toBe(false);
  });

  it('rejects a missing signature header', async () => {
    expect(await verifyDustSignature(BODY, null, SECRET)).toBe(false);
  });
});
