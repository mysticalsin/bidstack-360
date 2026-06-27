import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:dns so the SSRF gate is tested deterministically with no network.
// vi.hoisted keeps the mock fn available inside the hoisted vi.mock factory.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { assertUrlResolvesPublic, createSafeFetch } from './safe-outbound-fetch.js';

describe('assertUrlResolvesPublic', () => {
  beforeEach(() => lookupMock.mockReset());

  it('rejects a non-http(s) URL before any DNS lookup', async () => {
    await expect(assertUrlResolvesPublic('file:///etc/passwd')).rejects.toThrow();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a host that resolves to a private address (SSRF)', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5' }]);
    await expect(assertUrlResolvesPublic('https://evil.example.com')).rejects.toThrow(
      /internal address/,
    );
  });

  it('rejects a host resolving to the cloud metadata IP (DNS-rebind)', async () => {
    lookupMock.mockResolvedValue([{ address: '169.254.169.254' }]);
    await expect(assertUrlResolvesPublic('https://rebind.example.com')).rejects.toThrow(
      /internal address/,
    );
  });

  it('rejects when ANY resolved address is internal (mixed answer)', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }, { address: '127.0.0.1' }]);
    await expect(assertUrlResolvesPublic('https://mixed.example.com')).rejects.toThrow(
      /internal address/,
    );
  });

  it('accepts a host that resolves only to public addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
    const url = await assertUrlResolvesPublic('https://example.com/path');
    expect(url.hostname).toBe('example.com');
  });

});

describe('createSafeFetch', () => {
  beforeEach(() => lookupMock.mockReset());

  it('never calls the base fetch when the URL resolves to an internal address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3' }]);
    const baseFetch = vi.fn();
    const safe = createSafeFetch(baseFetch as unknown as typeof fetch);
    await expect(safe('https://evil.example.com')).rejects.toThrow();
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('calls the base fetch for a public URL', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
    const baseFetch = vi.fn().mockResolvedValue(new Response('ok'));
    const safe = createSafeFetch(baseFetch as unknown as typeof fetch);
    await safe('https://example.com');
    expect(baseFetch).toHaveBeenCalledOnce();
  });
});
