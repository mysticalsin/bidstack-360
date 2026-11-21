import { describe, expect, it, vi } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

import { createResearchFetch } from './safe-research-fetch.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

describe('createResearchFetch (SSRF + DNS-rebinding guard)', () => {
  it('rejects internal IP literals / bad protocols before any fetch or DNS lookup', async () => {
    const base = vi.fn(async () => new Response('nope')) as unknown as FetchLike;
    const f = createResearchFetch(base);
    await expect(f('http://127.0.0.1/')).rejects.toThrow();
    await expect(f('http://169.254.169.254/latest')).rejects.toThrow();
    await expect(f('ftp://example.com/')).rejects.toThrow();
    expect(base).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects when a public host RESOLVES to an internal IP (rebinding)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5' }]);
    const base = vi.fn(async () => new Response('nope')) as unknown as FetchLike;
    const f = createResearchFetch(base);
    await expect(f('https://rebind.example/')).rejects.toThrow('internal address');
    expect(base).not.toHaveBeenCalled();
  });

  it('pins the first address when a later lookup is private', async () => {
    let n = 0;
    lookupMock.mockImplementation(async () => {
      n += 1;
      return [{ address: n === 1 ? '93.184.216.34' : '169.254.169.254' }];
    });
    const dials: string[] = [];
    const base = vi.fn(async () => new Response('should-not-run')) as unknown as FetchLike;
    const f = createResearchFetch(base, {
      resolve: async () => {
        n += 1;
        return [{ address: n === 1 ? '93.184.216.34' : '169.254.169.254', family: 4 as const }];
      },
      transport: async (dial: { address: string }) => {
        dials.push(dial.address);
        return { status: 200, headers: {}, body: new TextEncoder().encode('ok') };
      },
    });
    const res = await f('https://rebind.example/');
    expect(await res.text()).toBe('ok');
    expect(base).not.toHaveBeenCalled();
    expect(dials).toEqual(['93.184.216.34']);
    expect(n).toBe(1);
  });

  it('fetches when the host resolves to only public IPs', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34' }]);
    const base = vi.fn(async () => new Response('ok')) as unknown as FetchLike;
    const f = createResearchFetch(base);
    const res = await f('https://example.com/');
    expect(await res.text()).toBe('ok');
  });
});
