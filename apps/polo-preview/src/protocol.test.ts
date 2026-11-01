import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  PUBLIC_PREVIEW_ORIGIN,
  filterCookieHeader,
  filterRequestHeaders,
  filterResponseHeaders,
  isApiPath,
  rewriteLocalUrl,
  rewriteResponseHeaders,
  safePathname,
  targetForPath,
  targetUrl,
} from './protocol.js';

const here = dirname(fileURLToPath(import.meta.url));

describe('polo-preview path routing', () => {
  it('sends API and probe paths to :4020 so vite preview cannot answer them with index.html', () => {
    // WHY: `vite preview` is a static server. If /api, /readyz, or /webhooks
    // hit :4180, the SPA looks "down" (HTML where JSON should be). The box
    // exists specifically to split those onto the Fastify process.
    const api = 'http://127.0.0.1:4020';
    const web = 'http://127.0.0.1:4180';
    for (const path of [
      '/api',
      '/api/v1/health',
      '/readyz',
      '/livez',
      '/health',
      '/metrics',
      '/webhooks/dust',
    ]) {
      expect(isApiPath(path)).toBe(true);
      expect(targetForPath(path, { apiOrigin: api, webOrigin: web })).toBe(api);
    }
  });

  it('keeps the SPA, assets, and app routes on the web preview port', () => {
    const api = 'http://127.0.0.1:4020';
    const web = 'http://127.0.0.1:4180';
    for (const path of ['/', '/dashboard', '/accounts', '/assets/index-abc.js', '/favicon.svg']) {
      expect(isApiPath(path)).toBe(false);
      expect(targetForPath(path, { apiOrigin: api, webOrigin: web })).toBe(web);
    }
  });

  it('refuses protocol-relative paths so the box cannot be pointed at an arbitrary host', () => {
    // WHY: `new URL('//169.254.169.254/', 'http://127.0.0.1:4180')` leaves
    // loopback. The relay must keep pathname on the configured origin.
    expect(safePathname('//169.254.169.254/latest/meta-data')).toBe('/');
    const url = targetUrl('//evil.example/?x=1', 'http://127.0.0.1:4180');
    expect(url.origin).toBe('http://127.0.0.1:4180');
    expect(url.pathname).toBe('/');
  });
});

describe('polo-preview header contract', () => {
  it('strips Cloudflare Access cookies so the box never sees the JWT', () => {
    // WHY: Access authenticates the visitor. Forwarding CF_Authorization to
    // localhost would put a tenant JWT on the box process and in its logs.
    const filtered = filterCookieHeader(
      'CF_Authorization=eyJhbGciOiJSUzI1NiJ9.aaa; CF_AppSession=ae3a; bidstack=ok',
    );
    expect(filtered).toBe('bidstack=ok');
    expect(filterCookieHeader('CF_Authorization=secret')).toBeNull();
  });

  it('drops Access, forwarding, and e2e-impersonation request headers', () => {
    const headers = filterRequestHeaders([
      ['Host', 'polo-preview.tony-walteur.workers.dev'],
      ['cf-access-jwt-assertion', 'jwt'],
      ['x-forwarded-for', '1.2.3.4'],
      ['x-bidstack-e2e-role', 'admin'],
      ['authorization', 'Bearer user-token'],
      ['cookie', 'CF_Authorization=jwt; session=abc'],
    ]);
    const names = headers.map(([name]) => name.toLowerCase());
    expect(names).not.toContain('host');
    expect(names).not.toContain('cf-access-jwt-assertion');
    expect(names).not.toContain('x-forwarded-for');
    expect(names).not.toContain('x-bidstack-e2e-role');
    expect(headers).toContainEqual(['authorization', 'Bearer user-token']);
    expect(headers).toContainEqual(['cookie', 'session=abc']);
  });

  it('strips hop-by-hop and content-encoding from reconstructed responses', () => {
    // WHY: the relay already decoded the body. Forwarding gzip + a decoded
    // body is the classic "this preview is a blank page" failure.
    const headers = filterResponseHeaders([
      ['Content-Type', 'text/html'],
      ['Content-Encoding', 'gzip'],
      ['Transfer-Encoding', 'chunked'],
      ['Content-Length', '12'],
    ]);
    const names = headers.map(([name]) => name.toLowerCase());
    expect(names).toEqual(['content-type']);
  });

  it('rewrites localhost redirects onto the Access-gated Worker origin', () => {
    // WHY: a 302 to http://127.0.0.1:4180/login sends the visitor off the
    // preview and onto their own machine, which looks like "Access is broken".
    expect(rewriteLocalUrl('http://127.0.0.1:4180/login?next=/', PUBLIC_PREVIEW_ORIGIN)).toBe(
      `${PUBLIC_PREVIEW_ORIGIN}/login?next=/`,
    );
    expect(rewriteLocalUrl('/dashboard', PUBLIC_PREVIEW_ORIGIN)).toBe('/dashboard');
    const rewritten = rewriteResponseHeaders(
      [
        ['Location', 'http://localhost:4020/api/v1/oauth/callback'],
        ['Content-Type', 'text/plain'],
      ],
      PUBLIC_PREVIEW_ORIGIN,
    );
    expect(rewritten).toContainEqual([
      'Location',
      `${PUBLIC_PREVIEW_ORIGIN}/api/v1/oauth/callback`,
    ]);
  });
});

describe('worker source stays on the shared contract', () => {
  it('imports protocol.js instead of forking the header lists', () => {
    const worker = readFileSync(join(here, 'worker.js'), 'utf8');
    expect(worker).toContain("from './protocol.js'");
    expect(worker).toContain('filterCookieHeader');
    expect(worker).toContain('rewriteResponseHeaders');
    expect(worker).toContain("idFromName('box')");
    expect(worker).not.toContain('wrangler deploy');
  });
});
