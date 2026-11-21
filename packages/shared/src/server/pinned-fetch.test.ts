import { Readable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  classifyIpAddress,
  nodePinnedTransport,
  pinnedFetch,
  pinnedSocketOptions,
  readBounded,
  type PinnedDial,
  type PinnedHopResult,
} from './pinned-fetch.js';

/**
 * WHY: Hammer ARTEX F-01/F-09. A name that looks public can resolve to
 * metadata, loopback, or a private range, and a second lookup can change
 * the answer. These tests lock the refusal classes (parsed addresses, not
 * string prefixes) and the pin: one lookup, then a dial to that address only.
 */

const PUBLIC_V4 = '93.184.216.34';

function dialSpy(result?: Partial<PinnedHopResult>): {
  transport: (dial: PinnedDial) => Promise<PinnedHopResult>;
  dials: PinnedDial[];
} {
  const dials: PinnedDial[] = [];
  const transport = vi.fn(async (dial: PinnedDial) => {
    dials.push(dial);
    return {
      status: result?.status ?? 200,
      headers: result?.headers ?? {},
      body: result?.body ?? new Uint8Array(),
    };
  });
  return { transport, dials };
}

function resolveTo(address: string, family: 4 | 6 = address.includes(':') ? 6 : 4) {
  return async () => [{ address, family }];
}

describe('classifyIpAddress', () => {
  it.each([
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'],
    ['fc00::1', 'private'],
    ['fd00::1', 'private'],
  ] as const)('refuses private %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.0.0.2', 'loopback'],
    ['127.8.8.8', 'loopback'],
    ['127.255.255.255', 'loopback'],
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback'],
  ] as const)('refuses loopback %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it.each([
    ['169.254.1.1', 'link_local'],
    ['169.254.169.253', 'link_local'],
    ['fe80::1', 'link_local'],
    ['fe80::1%eth0', 'link_local'],
  ] as const)('refuses link-local %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it.each([
    ['100.64.0.1', 'cgnat'],
    ['100.127.255.255', 'cgnat'],
  ] as const)('refuses CGNAT %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it.each([
    ['169.254.169.254', 'metadata'],
    ['fd00:ec2::254', 'metadata'],
    ['fd00:0ec2:0:0:0:0:0:254', 'metadata'],
  ] as const)('refuses cloud metadata %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it.each([
    ['::ffff:169.254.169.254', 'ipv4_mapped'],
    ['::ffff:7f00:1', 'ipv4_mapped'],
    ['::ffff:8.8.8.8', 'ipv4_mapped'],
    ['0:0:0:0:0:ffff:808:808', 'ipv4_mapped'],
    ['::7f00:1', 'ipv4_mapped'],
  ] as const)('refuses IPv4-mapped and IPv4-compatible %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it.each([
    ['0.0.0.0', 'unspecified'],
    ['::', 'unspecified'],
    ['0:0:0:0:0:0:0:0', 'unspecified'],
  ] as const)('refuses unspecified %s', (address, block) => {
    expect(classifyIpAddress(address)).toBe(block);
  });

  it('parses ranges instead of string prefixes', () => {
    // 172.15 is outside 172.16/12. A prefix check on "172." would refuse it.
    expect(classifyIpAddress('172.15.0.1')).toBe('public');
    expect(classifyIpAddress('172.32.0.1')).toBe('public');
    // 100.63 and 100.128 sit just outside CGNAT 100.64/10.
    expect(classifyIpAddress('100.63.0.1')).toBe('public');
    expect(classifyIpAddress('100.128.0.1')).toBe('public');
    // A hostname that merely starts with "127." is not an address.
    expect(classifyIpAddress('127.attacker.example')).toBe('unparseable');
    expect(classifyIpAddress('169.254.169.254.example')).toBe('unparseable');
  });

  it('still allows an ordinary public address', () => {
    expect(classifyIpAddress(PUBLIC_V4)).toBe('public');
    expect(classifyIpAddress('8.8.8.8')).toBe('public');
    expect(classifyIpAddress('2606:4700:4700::1111')).toBe('public');
    expect(classifyIpAddress('[2606:4700:4700::1111]')).toBe('public');
  });
});

describe('pinnedFetch refusals', () => {
  it.each([
    ['10.1.2.3', 'private'],
    ['127.1.2.3', 'loopback'],
    ['169.254.1.1', 'link_local'],
    ['100.64.10.1', 'cgnat'],
    ['169.254.169.254', 'metadata'],
    ['fd00:ec2::254', 'metadata'],
    ['::ffff:8.8.8.8', 'ipv4_mapped'],
    ['0.0.0.0', 'unspecified'],
    ['::', 'unspecified'],
    ['::1', 'loopback'],
  ] as const)('does not dial when DNS returns %s (%s)', async (address, block) => {
    const { transport, dials } = dialSpy();
    await expect(
      pinnedFetch('https://news.example/a', { resolve: resolveTo(address), transport }),
    ).rejects.toMatchObject({ name: 'PinnedFetchError', code: 'blocked_address', block });
    expect(dials).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not dial when any address in the set is blocked', async () => {
    const { transport, dials } = dialSpy();
    const resolve = async () => [
      { address: PUBLIC_V4, family: 4 as const },
      { address: '10.0.0.5', family: 4 as const },
    ];
    await expect(pinnedFetch('https://mixed.example/a', { resolve, transport })).rejects.toMatchObject({
      code: 'blocked_address',
      block: 'private',
    });
    expect(dials).toEqual([]);
  });

  it('does not dial an unparseable answer that only looks like loopback', async () => {
    const { transport } = dialSpy();
    await expect(
      pinnedFetch('https://odd.example/a', {
        resolve: async () => [{ address: '127.attacker.example', family: 4 }],
        transport,
      }),
    ).rejects.toMatchObject({ code: 'blocked_address', block: 'unparseable' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('refuses a metadata literal before any lookup or dial', async () => {
    const resolve = vi.fn(async () => [{ address: PUBLIC_V4, family: 4 as const }]);
    const { transport } = dialSpy();
    await expect(
      pinnedFetch('http://169.254.169.254/latest/meta-data/', { resolve, transport }),
    ).rejects.toMatchObject({ code: 'blocked_address', block: 'metadata' });
    expect(resolve).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('pinnedFetch DNS pin', () => {
  it('dials the first public answer and ignores a later private lookup', async () => {
    let calls = 0;
    const resolve = vi.fn(async () => {
      calls += 1;
      return [{ address: calls === 1 ? PUBLIC_V4 : '169.254.169.254', family: 4 as const }];
    });
    const { transport, dials } = dialSpy({ body: new TextEncoder().encode('ok') });
    const res = await pinnedFetch('https://rebind.example/a', { resolve, transport, maxHops: 0 });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(calls).toBe(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(dials.map((d) => d.address)).toEqual([PUBLIC_V4]);
    expect(dials[0]?.servername).toBe('rebind.example');
    expect(dials[0]?.hostHeader).toBe('rebind.example');
  });

  it('connects to the pinned address with the original Host and SNI', () => {
    const options = pinnedSocketOptions({
      protocol: 'https:',
      address: PUBLIC_V4,
      family: 4,
      port: 443,
      servername: 'news.example',
      hostHeader: 'news.example',
      method: 'GET',
      path: '/a?x=1',
      headers: { accept: 'text/html', host: 'evil.internal' },
      body: null,
      timeoutMs: 1000,
      maxBytes: 100,
    });
    expect(options.host).toBe(PUBLIC_V4);
    expect(options.servername).toBe('news.example');
    expect(options.headers).toMatchObject({ host: 'news.example', accept: 'text/html' });
    expect(options).not.toHaveProperty('lookup');
    expect(options.setHost).toBe(false);
    expect(options.path).toBe('/a?x=1');
  });

  it('keeps a non-default port on the Host header and the socket', async () => {
    const { transport, dials } = dialSpy();
    await pinnedFetch('https://news.example:8443/a', {
      resolve: resolveTo(PUBLIC_V4),
      transport,
      maxHops: 0,
    });
    expect(dials[0]).toMatchObject({
      address: PUBLIC_V4,
      port: 8443,
      servername: 'news.example',
      hostHeader: 'news.example:8443',
    });
  });
});

describe('pinnedFetch redirects, size and time', () => {
  it('does not dial a redirect whose target is the metadata address', async () => {
    const { transport, dials } = dialSpy({
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    });
    await expect(
      pinnedFetch('https://news.example/a', {
        resolve: resolveTo(PUBLIC_V4),
        transport,
        maxHops: 3,
      }),
    ).rejects.toMatchObject({ code: 'blocked_address', block: 'metadata' });
    expect(dials.map((d) => d.address)).toEqual([PUBLIC_V4]);
  });

  it('revalidates a redirect and pins the next hop to its own address', async () => {
    const seen: string[] = [];
    const transport = async (dial: PinnedDial) => {
      seen.push(`${dial.hostHeader} -> ${dial.address}`);
      if (dial.hostHeader === 'news.example') {
        return { status: 302, headers: { location: 'https://cdn.example/img' }, body: new Uint8Array() };
      }
      return { status: 200, headers: { 'content-type': 'text/plain' }, body: new TextEncoder().encode('next') };
    };
    const resolve = async (host: string) => {
      if (host === 'cdn.example') return [{ address: '8.8.8.8', family: 4 as const }];
      return [{ address: PUBLIC_V4, family: 4 as const }];
    };
    const res = await pinnedFetch('https://news.example/a', { resolve, transport, maxHops: 3 });
    expect(res.status).toBe(200);
    expect(res.pinnedAddress).toBe('8.8.8.8');
    expect(seen).toEqual([`news.example -> ${PUBLIC_V4}`, 'cdn.example -> 8.8.8.8']);
  });

  it('stops after the hop cap', async () => {
    let n = 0;
    const transport = async () => {
      n += 1;
      return { status: 302, headers: { location: `https://hop${n}.example/` }, body: new Uint8Array() };
    };
    await expect(
      pinnedFetch('https://start.example/', {
        resolve: resolveTo(PUBLIC_V4),
        transport,
        maxHops: 2,
      }),
    ).rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(n).toBe(3);
  });

  it("refuses a redirect when redirect is 'error'", async () => {
    const { transport, dials } = dialSpy({
      status: 302,
      headers: { location: 'https://cdn.example/next' },
    });
    await expect(
      pinnedFetch('https://news.example/a', {
        resolve: resolveTo(PUBLIC_V4),
        transport,
        redirect: 'error',
      }),
    ).rejects.toMatchObject({ code: 'redirect' });
    expect(dials).toHaveLength(1);
  });

  it('rejects a body over the size cap', async () => {
    const { transport } = dialSpy({ body: new Uint8Array(64) });
    await expect(
      pinnedFetch('https://news.example/a', {
        resolve: resolveTo(PUBLIC_V4),
        transport,
        maxBytes: 16,
        maxHops: 0,
      }),
    ).rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects when the transport does not finish within the time cap', async () => {
    const transport = () => new Promise<PinnedHopResult>(() => undefined);
    await expect(
      pinnedFetch('https://news.example/a', {
        resolve: resolveTo(PUBLIC_V4),
        transport,
        timeoutMs: 30,
        maxHops: 0,
      }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('stops reading a socket body once the cap is crossed', async () => {
    const stream = Readable.from([Buffer.alloc(40), Buffer.alloc(40)]);
    await expect(readBounded(stream, 50)).rejects.toMatchObject({ code: 'too_large' });
    expect(stream.destroyed).toBe(true);
  });
});

describe('nodePinnedTransport', () => {
  it('requests the pinned IP and does not install a second DNS lookup', async () => {
    const captured: { options?: { host?: string; servername?: string; headers?: Record<string, string>; lookup?: unknown } } = {};
    const request = vi.fn((_proto: string, options: { host?: string }, cb: (res: Readable & { statusCode?: number; headers?: Record<string, string> }) => void) => {
      captured.options = options as typeof captured.options;
      const res = Object.assign(Readable.from([Buffer.from('hi')]), {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
      });
      queueMicrotask(() => cb(res));
      return {
        write: () => true,
        end: () => undefined,
        destroy: () => undefined,
        on: () => undefined,
      };
    });
    const hop = await nodePinnedTransport(
      {
        protocol: 'https:',
        address: PUBLIC_V4,
        family: 4,
        port: 443,
        servername: 'news.example',
        hostHeader: 'news.example',
        method: 'GET',
        path: '/a',
        headers: { accept: 'text/plain' },
        body: null,
        timeoutMs: 1000,
        maxBytes: 1000,
      },
      { request: request as never },
    );
    expect(hop.status).toBe(200);
    expect(Buffer.from(hop.body).toString()).toBe('hi');
    expect(captured.options?.host).toBe(PUBLIC_V4);
    expect(captured.options?.servername).toBe('news.example');
    expect(captured.options?.headers?.host).toBe('news.example');
    expect(captured.options?.lookup).toBeUndefined();
  });
});
