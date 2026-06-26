import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  api,
  buildApiUrl,
  normalizeApiBase,
  normalizeApiPath,
  setApiTokenProvider,
  type ApiError,
} from './api';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  setApiTokenProvider(null);
  vi.unstubAllGlobals();
});

describe('api fetch wrapper', () => {
  it('normalizes API paths and bases without duplicating /api prefixes', () => {
    expect(normalizeApiPath('/api/serum/status')).toBe('/api/v1/serum/status');
    expect(normalizeApiPath('/api/v1/serum/status')).toBe('/api/v1/serum/status');
    expect(normalizeApiBase('/api')).toBe('');
    expect(normalizeApiBase('/api/v1')).toBe('');
    expect(normalizeApiBase('https://api.bidstack.test/api/v1')).toBe('https://api.bidstack.test');
    expect(buildApiUrl('/api/serum/status', '/api')).toBe('/api/v1/serum/status');
    expect(buildApiUrl('/api/v1/serum/status', 'https://api.bidstack.test/api')).toBe(
      'https://api.bidstack.test/api/v1/serum/status',
    );
  });

  it('keeps cookie credentials when no bearer token provider is configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api('/api/health');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', {
      method: 'GET',
      headers: undefined,
      body: undefined,
      signal: undefined,
      credentials: 'include',
      cache: 'no-store',
    });
  });

  it('attaches the Clerk bearer token and JSON-encodes mutation bodies exactly once', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'product-1' }));
    vi.stubGlobal('fetch', fetchMock);
    setApiTokenProvider(async () => 'jwt-123');

    await api('/api/products', {
      method: 'POST',
      body: { sku: 'BID-001' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt-123',
      },
      body: JSON.stringify({ sku: 'BID-001' }),
      signal: undefined,
      credentials: 'include',
      cache: 'no-store',
    });
  });

  it('retries once with a forced token refresh after an auth rejection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Token expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const tokenProvider = vi.fn(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 'fresh-jwt' : 'stale-jwt',
    );
    vi.stubGlobal('fetch', fetchMock);
    setApiTokenProvider(tokenProvider);

    await expect(api('/api/products')).resolves.toEqual({ ok: true });

    expect(tokenProvider).toHaveBeenNthCalledWith(1, undefined);
    expect(tokenProvider).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/products',
      expect.objectContaining({
        headers: { Authorization: 'Bearer stale-jwt' },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/products',
      expect.objectContaining({
        headers: { Authorization: 'Bearer fresh-jwt' },
      }),
    );
  });

  it('surfaces auth errors after one forced-refresh retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Token expired' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, 403));
    vi.stubGlobal('fetch', fetchMock);
    setApiTokenProvider(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 'fresh-jwt' : 'stale-jwt',
    );

    await expect(api('/api/products')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Forbidden',
      status: 403,
    } satisfies Partial<ApiError>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses error payloads when APIs return legacy error bodies', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'SMS disabled for this org' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/api/sms/send')).rejects.toMatchObject({
      name: 'ApiError',
      message: 'SMS disabled for this org',
      status: 403,
    } satisfies Partial<ApiError>);
  });
});
