import { createHmac } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { zoomUrlValidationResponse } from './zoom.service.js';

// WHY: zoomUrlValidationResponse returns HMAC(ZOOM_SECRET_TOKEN, plainToken), and
// the webhook signature is HMAC(ZOOM_SECRET_TOKEN, `v0:<ts>:<body>`) under the SAME
// key. Without a guard, an attacker who controls plainToken can request the HMAC of
// an arbitrary `v0:<ts>:<body>` string and forge a valid webhook signature. The guard
// rejects any plainToken that could form that message (anything containing ':').
describe('zoomUrlValidationResponse — signing-oracle guard', () => {
  beforeAll(() => {
    process.env.ZOOM_SECRET_TOKEN = 'test-secret';
  });

  it('returns the HMAC for a legitimate opaque token', () => {
    const token = 'qS5AaEbB2aT13Nx_abc';
    const res = zoomUrlValidationResponse(token);
    expect(res.plainToken).toBe(token);
    expect(res.encryptedToken).toBe(
      createHmac('sha256', 'test-secret').update(token).digest('hex'),
    );
  });

  it('refuses a plainToken that reconstructs a webhook signing message (v0:ts:body)', () => {
    const forge = 'v0:1700000000:{"event":"meeting.ended"}';
    expect(() => zoomUrlValidationResponse(forge)).toThrow();
  });

  it('refuses any plainToken containing a colon', () => {
    expect(() => zoomUrlValidationResponse('a:b')).toThrow();
  });

  it('refuses an empty plainToken', () => {
    expect(() => zoomUrlValidationResponse('')).toThrow();
  });
});
