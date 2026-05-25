import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, setApiTokenProvider } from './api';

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
    });
  });
});
