import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { hopCountTrust, parseTrustProxy } from './trust-proxy.js';

async function ipSeen(trustProxy: string, remoteAddress: string, xff?: string): Promise<string> {
  const app = Fastify({ trustProxy: parseTrustProxy(trustProxy) });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  const res = await app.inject({
    method: 'GET',
    url: '/ip',
    remoteAddress,
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
  await app.close();
  return (res.json() as { ip: string }).ip;
}

describe('parseTrustProxy', () => {
  it('parses disabled, all, list and hop count forms', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8, 127.0.0.1')).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(typeof parseTrustProxy('2')).toBe('function');
  });

  it('hop count trusts hops only behind an internal peer', () => {
    const fn = hopCountTrust(2);
    expect(fn('10.1.2.3', 0)).toBe(true);
    expect(fn('::ffff:10.1.2.3', 0)).toBe(true);
    expect(fn('100.100.0.7', 0)).toBe(true);
    expect(fn('8.8.8.8', 0)).toBe(false);
    expect(fn('20.1.1.1', 1)).toBe(true);
    expect(fn('20.1.1.1', 2)).toBe(false);
  });
});

describe('Fastify trustProxy with TRUSTED_PROXIES=2 (production setting)', () => {
  // Regression: fastify >= 5.12 turns a numeric trustProxy into "trust nothing",
  // which made req.ip the ingress address for every client.
  it('resolves the real client behind Front Door + Envoy', async () => {
    // XFF as appended by Front Door (client) then Envoy (Front Door edge).
    expect(await ipSeen('2', '10.0.0.5', '203.0.113.9, 20.50.1.1')).toBe('203.0.113.9');
  });

  it('ignores X-Forwarded-For from a public peer that bypassed the ingress', async () => {
    expect(await ipSeen('2', '52.10.0.20', '1.2.3.4, 5.6.7.8')).toBe('52.10.0.20');
  });

  it('never trusts more than the configured hops', async () => {
    expect(await ipSeen('2', '10.0.0.5', '9.9.9.9, 203.0.113.9, 20.50.1.1')).toBe('203.0.113.9');
  });

  it('trusts nothing when unset', async () => {
    expect(await ipSeen('', '10.0.0.5', '203.0.113.9')).toBe('10.0.0.5');
  });
});
