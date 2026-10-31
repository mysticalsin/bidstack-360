/**
 * The mcp-server must read TRUSTED_PROXIES exactly like the api. A bare hop
 * count (production sets TRUSTED_PROXIES=2) used to be split into the
 * allowlist ['2'], which trusts no proxy: req.ip became the ingress address
 * and every client shared one rate-limit bucket.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildMcpServer } from './server.js';

let server: FastifyInstance | null = null;
const previous = process.env.TRUSTED_PROXIES;

afterEach(async () => {
  await server?.close();
  server = null;
  if (previous === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = previous;
});

async function ipSeen(trusted: string | undefined, remoteAddress: string, xff: string) {
  if (trusted === undefined) delete process.env.TRUSTED_PROXIES;
  else process.env.TRUSTED_PROXIES = trusted;
  server = await buildMcpServer();
  server.get('/__trust-proxy-probe', { config: { rateLimit: false } }, async (req) => ({ ip: req.ip }));
  const res = await server.inject({
    method: 'GET',
    url: '/__trust-proxy-probe',
    remoteAddress,
    headers: { 'x-forwarded-for': xff },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { ip: string }).ip;
}

describe('mcp-server TRUSTED_PROXIES', () => {
  it('a hop count trusts the in-cluster ingress and reads the client from X-Forwarded-For', async () => {
    // client -> Front Door (203.0.113.9) -> Envoy (10.0.0.5) -> container
    expect(await ipSeen('2', '10.0.0.5', '198.51.100.7, 203.0.113.9')).toBe('198.51.100.7');
  });

  it('a hop count never trusts a public peer, so a direct caller cannot spoof its IP', async () => {
    expect(await ipSeen('2', '8.8.4.4', '1.2.3.4')).toBe('8.8.4.4');
  });

  it('an IP allowlist still works', async () => {
    expect(await ipSeen('10.0.0.5', '10.0.0.5', '198.51.100.7')).toBe('198.51.100.7');
  });

  it('unset means no proxy is trusted', async () => {
    expect(await ipSeen(undefined, '10.0.0.5', '198.51.100.7')).toBe('10.0.0.5');
  });
});
