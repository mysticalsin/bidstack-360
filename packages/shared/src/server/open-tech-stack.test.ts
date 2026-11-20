import { describe, expect, it, vi } from 'vitest';

import {
  createCrtShState,
  detectOpenTechStack,
  publicGet,
  publicOnlyLookup,
  robotsTxtAllows,
  type DnsResolverLike,
  type PublicGet,
  type PublicGetResponse,
} from './open-tech-stack.js';

const NOW = new Date('2026-11-07T12:00:00.000Z');

const resolver: DnsResolverLike = {
  resolveMx: async () => [{ exchange: 'acme-com.mail.protection.outlook.com' }],
  resolveTxt: async () => [['v=spf1 include:spf.protection.outlook.com include:mail.zendesk.com ~all'], ['atlassian-domain-verification=x']],
  resolveNs: async () => ['ada.ns.cloudflare.com'],
  resolveCname: async (host) => (host.startsWith('help.') ? ['acme.zendesk.com'] : []),
};

const ok = (url: string, body: string, headers: Record<string, string> = {}): PublicGetResponse => ({ url, status: 200, headers, body });

function fakeGet(overrides: Record<string, (url: string) => PublicGetResponse | Promise<PublicGetResponse>> = {}) {
  const calls: string[] = [];
  const get: PublicGet = async (url) => {
    calls.push(url);
    for (const [prefix, fn] of Object.entries(overrides)) if (url.startsWith(prefix)) return fn(url);
    if (url.startsWith('https://crt.sh/')) return ok(url, JSON.stringify([{ name_value: 'jira.acme.com' }, { name_value: 'sap.acme.com' }]));
    if (url.endsWith('/robots.txt')) return ok(url, 'User-agent: *\nDisallow: /private\n');
    if (url.startsWith('https://api.github.com/orgs/acme-labs/repos')) return ok(url, JSON.stringify([{ language: 'TypeScript' }, { language: 'Go' }]));
    if (url === 'https://acme.com/') return ok(url, '<script src="https://www.googletagmanager.com/gtm.js"></script><a href="https://github.com/acme-labs">code</a>', { 'x-azure-ref': 'abc' });
    return { url, status: 404, headers: {}, body: '' };
  };
  return { get, calls };
}

const subject = {
  name: 'Acme',
  domain: 'acme.com',
  website: 'https://acme.com/',
  postings: [{ title: 'Snowflake Data Engineer', department: null, skills: ['Snowflake', 'Python'], url: null, fetchedAt: NOW }],
};

describe('detectOpenTechStack', () => {
  it('runs every lane and reports real per lane counts', async () => {
    const { get } = fakeGet();
    const run = await detectOpenTechStack(subject, { resolver, get, now: () => NOW, sleep: async () => {}, ct: createCrtShState() });
    const counts = Object.fromEntries(run.lanes.map((l) => [l.lane, [l.status, l.count]]));
    expect(counts).toEqual({ dns: ['found', 4], ct: ['found', 2], web: ['found', 2], jobs: ['found', 2], github: ['found', 2] });
    expect(run.githubOrg).toBe('acme-labs');
    expect(run.items.every((i) => i.source === `open_data:${i.lane}` && i.evidence.observedAt === NOW.toISOString())).toBe(true);
  });

  it('skips the homepage when robots.txt disallows it', async () => {
    const { get, calls } = fakeGet({ 'https://acme.com/robots.txt': (u) => ok(u, 'User-agent: *\nDisallow: /\n') });
    const run = await detectOpenTechStack(subject, { resolver, get, now: () => NOW, sleep: async () => {}, ct: createCrtShState() });
    expect(run.lanes.find((l) => l.lane === 'web')).toMatchObject({ status: 'skipped', detail: 'robots.txt disallows the homepage' });
    expect(calls).not.toContain('https://acme.com/');
  });

  it('names bot protection when the homepage refuses', async () => {
    const { get } = fakeGet({ 'https://acme.com/': (u) => ({ url: u, status: 403, headers: {}, body: '' }) });
    const run = await detectOpenTechStack({ ...subject, website: null }, { resolver, get, now: () => NOW, sleep: async () => {}, ct: createCrtShState() });
    expect(run.lanes.find((l) => l.lane === 'web')).toMatchObject({ status: 'failed', detail: 'Homepage answered HTTP 403, likely bot protection' });
  });

  it('tolerates a crt.sh outage and cools down instead of retrying', async () => {
    const ct = createCrtShState();
    const { get, calls } = fakeGet({ 'https://crt.sh/': (u) => ({ url: u, status: 503, headers: {}, body: '' }) });
    const first = await detectOpenTechStack(subject, { resolver, get, now: () => NOW, sleep: async () => {}, ct });
    expect(first.lanes.find((l) => l.lane === 'ct')).toMatchObject({ status: 'failed', detail: 'crt.sh answered HTTP 503' });
    const before = calls.filter((c) => c.startsWith('https://crt.sh/')).length;
    const second = await detectOpenTechStack(subject, { resolver, get, now: () => NOW, sleep: async () => {}, ct });
    expect(second.lanes.find((l) => l.lane === 'ct')!.detail).toContain('cooling down');
    expect(calls.filter((c) => c.startsWith('https://crt.sh/')).length).toBe(before);
    expect(second.lanes.find((l) => l.lane === 'dns')!.status).toBe('found');
  });

  it('caches crt.sh answers and paces requests', async () => {
    const ct = createCrtShState();
    const sleep = vi.fn(async () => {});
    const { get, calls } = fakeGet();
    await detectOpenTechStack(subject, { resolver, get, now: () => NOW, sleep, ct });
    await detectOpenTechStack(subject, { resolver, get, now: () => NOW, sleep, ct });
    expect(calls.filter((c) => c.startsWith('https://crt.sh/'))).toEqual([
      'https://crt.sh/?q=%25.acme.com&output=json&exclude=expired',
      'https://crt.sh/?q=acme.%25&output=json&exclude=expired',
    ]);
    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it('runs only the jobs lane when network lanes are off', async () => {
    const get = vi.fn<PublicGet>();
    const run = await detectOpenTechStack(subject, { network: false, get, now: () => NOW });
    expect(run.lanes.map((l) => [l.lane, l.status])).toEqual([
      ['dns', 'skipped'],
      ['ct', 'skipped'],
      ['web', 'skipped'],
      ['jobs', 'found'],
      ['github', 'skipped'],
    ]);
    expect(get).not.toHaveBeenCalled();
  });

  it('skips network lanes without a domain', async () => {
    const run = await detectOpenTechStack({ ...subject, domain: null, website: null }, { resolver, get: fakeGet().get, now: () => NOW });
    expect(run.lanes.find((l) => l.lane === 'dns')).toMatchObject({ status: 'skipped', detail: 'No domain on the account' });
  });

  it('reports a lane timeout as a failure, not a crash', async () => {
    const slow: DnsResolverLike = { ...resolver, resolveMx: () => new Promise(() => {}) };
    const run = await detectOpenTechStack(subject, { resolver: slow, get: fakeGet().get, now: () => NOW, sleep: async () => {}, laneTimeoutMs: 50, ct: createCrtShState() });
    expect(run.lanes.find((l) => l.lane === 'dns')).toMatchObject({ status: 'failed', detail: 'dns timed out after 50 ms' });
  });
});

describe('SSRF guard', () => {
  it('refuses internal URLs before any request', async () => {
    await expect(publicGet('http://127.0.0.1/')).rejects.toThrow();
    await expect(publicGet('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(publicGet('file:///etc/passwd')).rejects.toThrow();
  });

  it('refuses at connect time when a name resolves to loopback', async () => {
    const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup('localhost', {}, (e) => resolve(e)));
    expect(err?.code).toBe('EBLOCKED');
  });
});

describe('robots.txt', () => {
  it('applies the longest match and the named group', () => {
    const body = 'User-agent: *\nDisallow: /\nAllow: /$\n\nUser-agent: badbot\nDisallow: /\n';
    expect(robotsTxtAllows(body, 'poloopentech', '/')).toBe(true);
    expect(robotsTxtAllows(body, 'poloopentech', '/about')).toBe(false);
    expect(robotsTxtAllows(body, 'badbot', '/')).toBe(false);
    expect(robotsTxtAllows('', 'poloopentech', '/')).toBe(true);
  });
});
