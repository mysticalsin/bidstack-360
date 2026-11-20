import { describe, expect, it, vi } from 'vitest';

import { PsSourceError } from './errors.js';
import {
  CHILE_SOURCE_HOSTS,
  assertAllowedSourceUrl,
  guardedGet,
  redactUrl,
  type FetchLike,
} from './fetch-guard.js';

const okFetch = (body = '{}', status = 200, headers: Record<string, string> = {}): FetchLike =>
  vi.fn(async () => new Response(body, { status, headers }));

describe('source URL allowlist (on top of the SSRF guard)', () => {
  it('accepts the official Chile hosts only', () => {
    expect(
      assertAllowedSourceUrl(
        'https://api.mercadopublico.cl/APISOCDS/OCDS/tender/1-1-LE25',
        CHILE_SOURCE_HOSTS,
      ).hostname,
    ).toBe('api.mercadopublico.cl');
    expect(() =>
      assertAllowedSourceUrl('https://evil.example.com/x', CHILE_SOURCE_HOSTS),
    ).toThrow(PsSourceError);
  });

  it('blocks cloud metadata and loopback even if a tender links to them', () => {
    expect(() =>
      assertAllowedSourceUrl('http://169.254.169.254/latest/meta-data/', CHILE_SOURCE_HOSTS),
    ).toThrow(/internal|not allowed/i);
    expect(() => assertAllowedSourceUrl('http://127.0.0.1/', CHILE_SOURCE_HOSTS)).toThrow();
  });

  it('upgrades the http links the OCDS list returns to https', () => {
    expect(
      assertAllowedSourceUrl(
        'http://api.mercadopublico.cl/APISOCDS/OCDS/tender/1-1-LE25',
        CHILE_SOURCE_HOSTS,
      ).protocol,
    ).toBe('https:');
  });

  it('does not treat look-alike hosts as allowed', () => {
    expect(() =>
      assertAllowedSourceUrl('https://api.mercadopublico.cl.evil.example/x', CHILE_SOURCE_HOSTS),
    ).toThrow();
    expect(() =>
      assertAllowedSourceUrl('https://other.blob.core.windows.net/x', CHILE_SOURCE_HOSTS),
    ).toThrow();
  });
});

describe('redactUrl', () => {
  it('strips the ticket so it never reaches logs, errors or the raw index', () => {
    const redacted = redactUrl(
      'https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=SECRET-VALUE-123',
    );
    expect(redacted).not.toContain('SECRET-VALUE-123');
    expect(redacted).toContain('ticket=REDACTED');
    expect(redacted).toContain('estado=activas');
  });
});

describe('guardedGet', () => {
  it('only issues GET with manual redirects (compatible with createSafeFetch)', async () => {
    const fetch = okFetch('{"a":1}');
    await guardedGet(fetch, 'https://api.mercadopublico.cl/x', { allowedHosts: CHILE_SOURCE_HOSTS });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.mercadopublico.cl/x',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('refuses to follow redirects', async () => {
    const fetch = okFetch('', 302, { location: 'http://169.254.169.254/' });
    await expect(
      guardedGet(fetch, 'https://api.mercadopublico.cl/x', { allowedHosts: CHILE_SOURCE_HOSTS }),
    ).rejects.toMatchObject({ kind: 'redirect_refused' });
  });

  it('maps 429 to rate_limited with Retry-After', async () => {
    const fetch = okFetch('', 429, { 'retry-after': '30' });
    await expect(
      guardedGet(fetch, 'https://api.mercadopublico.cl/x', { allowedHosts: CHILE_SOURCE_HOSTS }),
    ).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 30_000 });
  });

  it('never leaks the ticket through a network error message', async () => {
    const url = 'https://api.mercadopublico.cl/x?ticket=SECRET-VALUE-123';
    const fetch: FetchLike = async () => {
      throw new TypeError(`fetch failed for ${url}`);
    };
    const err = await guardedGet(fetch, url, { allowedHosts: CHILE_SOURCE_HOSTS }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(PsSourceError);
    expect(JSON.stringify(err)).not.toContain('SECRET-VALUE-123');
    expect(String((err as Error).message)).not.toContain('SECRET-VALUE-123');
    expect((err as Error).cause).toBeUndefined();
  });

  it('enforces a response size cap', async () => {
    const fetch = okFetch('x'.repeat(2_000));
    await expect(
      guardedGet(fetch, 'https://api.mercadopublico.cl/x', {
        allowedHosts: CHILE_SOURCE_HOSTS,
        maxBytes: 1_000,
      }),
    ).rejects.toMatchObject({ kind: 'too_large' });
  });
});
