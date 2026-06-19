import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const nginxConfig = readFileSync(path.resolve(process.cwd(), 'nginx.conf'), 'utf8');

function locationBlock(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = nginxConfig.match(new RegExp(`location\\s+${escaped}\\s+\\{([\\s\\S]*?)\\n    \\}`));
  if (!match) {
    throw new Error(`Missing nginx location ${selector}`);
  }
  return match[1];
}

function expectSecurityHeaders(block: string) {
  expect(block).toContain('add_header X-Frame-Options "DENY" always;');
  expect(block).toContain('add_header X-Content-Type-Options "nosniff" always;');
  expect(block).toContain('add_header Referrer-Policy "strict-origin-when-cross-origin" always;');
  expect(block).toContain(
    'add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;',
  );
  expect(block).toContain('add_header Cross-Origin-Opener-Policy "same-origin" always;');
  expect(block).toContain('add_header Cross-Origin-Resource-Policy "same-origin" always;');
  expect(block).toContain(
    'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()" always;',
  );
  expect(block).toContain('add_header Content-Security-Policy "');
  expect(block).toContain("default-src 'self'");
  expect(block).toContain("object-src 'none'");
  expect(block).toContain("frame-ancestors 'none'");
  expect(block).toContain('upgrade-insecure-requests');
}

describe('nginx app-shell cache policy', () => {
  it('declares the full browser hardening policy at the server edge', () => {
    expectSecurityHeaders(nginxConfig);
  });

  it('keeps service-worker and app-shell entrypoints fresh while preserving security headers', () => {
    for (const selector of ['= /', '= /index.html', '= /manifest.json', '= /sw.js']) {
      const block = locationBlock(selector);
      expectSecurityHeaders(block);
      expect(block).toContain('add_header Cache-Control "no-cache, no-store, must-revalidate" always;');
    }
  });

  it('keeps hashed build assets immutable without dropping inherited security posture', () => {
    const assets = locationBlock('/assets/');

    expectSecurityHeaders(assets);
    expect(assets).toContain(
      'add_header Cache-Control "public, max-age=31536000, immutable" always;',
    );
    expect(assets).toContain('try_files $uri =404;');
  });

  it('does not use add_header for Content-Type because that would shadow server security headers', () => {
    expect(nginxConfig).not.toContain('add_header Content-Type');
    expect(locationBlock('/health')).toContain('default_type text/plain;');
  });
});
