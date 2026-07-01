import { describe, expect, it } from 'vitest';

import { buildServer } from '../server.js';
import { buildContentSecurityPolicy } from './security-headers.js';

describe('security headers', () => {
  it('keeps the provider allowlist in the single CSP builder', () => {
    const csp = buildContentSecurityPolicy(false);

    expect(csp).toContain('connect-src');
    expect(csp).toContain('https://graph.microsoft.com');
    expect(csp).toContain('https://www.googleapis.com');
    expect(csp).toContain('https://api.twilio.com');
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('serves CSP and Permissions-Policy from securityHeadersPlugin', async () => {
    const server = await buildServer();
    try {
      server.get('/test-security-headers', async () => ({ ok: true }));

      const res = await server.inject({ method: 'GET', url: '/test-security-headers' });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-security-policy']).toBe(buildContentSecurityPolicy(true));
      expect(res.headers['permissions-policy']).toBe(
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
      );
    } finally {
      await server.close();
    }
  });
});
