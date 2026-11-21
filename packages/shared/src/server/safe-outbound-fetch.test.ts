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
    await expect(safe('https://evil.example.com', { redirect: 'manual' })).rejects.toThrow();
    expect(baseFetch).not.toHaveBeenCalled();
  });

  it('calls the pinned transport for a public URL with redirect: manual', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
    const baseFetch = vi.fn();
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: new TextEncoder().encode('ok') }));
    const safe = createSafeFetch(baseFetch as unknown as typeof fetch, { transport });
    const res = await safe('https://example.com', { redirect: 'manual' });
    expect(await res.text()).toBe('ok');
    expect(transport).toHaveBeenCalledOnce();
    expect(baseFetch).not.toHaveBeenCalled();
  });

  // Regression: undici/fetch defaults to redirect: 'follow', which would let a
  // validated public host 302 to an internal/metadata IP with no re-validation
  // (SSRF bypass via redirect hop). createSafeFetch must refuse to proceed
  // unless the caller opts into manual redirect handling.
  it('throws synchronously when redirect is omitted (unsafe fetch default)', () => {
    const baseFetch = vi.fn();
    const safe = createSafeFetch(baseFetch as unknown as typeof fetch);
    expect(() => safe('https://example.com')).toThrow(/redirect/i);
    expect(baseFetch).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("throws synchronously when the caller explicitly passes redirect: 'follow'", () => {
    const baseFetch = vi.fn();
    const safe = createSafeFetch(baseFetch as unknown as typeof fetch);
    expect(() => safe('https://example.com', { redirect: 'follow' })).toThrow(/redirect/i);
    expect(baseFetch).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("accepts redirect: 'manual'", async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: new Uint8Array() }));
    const safe = createSafeFetch(vi.fn() as unknown as typeof fetch, { transport });
    await expect(safe('https://example.com', { redirect: 'manual' })).resolves.toBeInstanceOf(Response);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('pins the first address and does not fetch the hostname when a later lookup is private', async () => {
    // WHY: F-09. assert-then-fetch looks the name up twice. The second answer
    // can be the metadata address. The socket must use the first answer only.
    let n = 0;
    lookupMock.mockImplementation(async () => {
      n += 1;
      return [{ address: n === 1 ? '93.184.216.34' : '169.254.169.254', family: 4 }];
    });
    const dials: string[] = [];
    const base = vi.fn(async () => new Response('should-not-run'));
    const safe = createSafeFetch(base as unknown as typeof fetch, {
      resolve: async () => {
        n += 1;
        return [{ address: n === 1 ? '93.184.216.34' : '169.254.169.254', family: 4 as const }];
      },
      transport: async (dial: { address: string }) => {
        dials.push(dial.address);
        return { status: 204, headers: {}, body: new Uint8Array() };
      },
    });
    const res = await safe('https://rebind.example/a', { redirect: 'manual' });
    expect(res.status).toBe(204);
    expect(base).not.toHaveBeenCalled();
    expect(dials).toEqual(['93.184.216.34']);
    expect(n).toBe(1);
  });

  it("accepts redirect: 'error'", async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34' }]);
    const transport = vi.fn(async () => ({ status: 200, headers: {}, body: new Uint8Array() }));
    const safe = createSafeFetch(vi.fn() as unknown as typeof fetch, { transport });
    await expect(safe('https://example.com', { redirect: 'error' })).resolves.toBeInstanceOf(Response);
    expect(transport).toHaveBeenCalledOnce();
  });
});
