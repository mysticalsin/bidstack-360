import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { makeApiProxy, rejectUpgrade, upstreamHeaders } from './container-proxy.js';

const servers: http.Server[] = [];
const agents: http.Agent[] = [];

function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

afterEach(async () => {
  for (const agent of agents.splice(0)) agent.destroy();
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise((resolve) => {
          s.closeAllConnections();
          s.close(resolve);
        }),
    ),
  );
});

async function apiLikeUpstream(): Promise<number> {
  const api = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, connection: req.headers.connection ?? null, upgrade: req.headers.upgrade ?? null }));
  });
  api.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nconnection: upgrade\r\nupgrade: websocket\r\n\r\n');
  });
  return listen(api);
}

async function frontServer(apiPort: number, { handleUpgrade = true } = {}): Promise<number> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  agents.push(agent);
  const proxyApi = makeApiProxy({ port: apiPort, agent });
  const front = http.createServer((req, res) => proxyApi(req, res));
  if (handleUpgrade) front.on('upgrade', rejectUpgrade);
  return listen(front);
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers, agent: false, timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('timeout', () => req.destroy(new Error(`timed out: ${path}`)));
    req.on('error', reject);
  });
}

describe('container front proxy', () => {
  it('drops hop-by-hop and internal headers before forwarding', () => {
    expect(
      upstreamHeaders({
        connection: 'Upgrade',
        upgrade: 'websocket',
        'keep-alive': 'timeout=5',
        'x-polo-internal-key': 'k',
        'x-forwarded-for': '1.2.3.4',
        'cf-access-authenticated-user-email': 'a@b.c',
        cookie: 'sid=1',
      }),
    ).toEqual({ 'cf-access-authenticated-user-email': 'a@b.c', cookie: 'sid=1' });
  });

  it('keeps serving API requests after a client sends upgrade headers on a plain request', async () => {
    const front = await frontServer(await apiLikeUpstream(), { handleUpgrade: false });
    const first = await get(front, '/api/v1/realtime', { connection: 'Upgrade', upgrade: 'websocket' });
    expect(JSON.parse(first.body)).toMatchObject({ upgrade: null });
    for (let i = 0; i < 3; i++) {
      const next = await get(front, `/api/v1/companies?i=${i}`);
      expect(next.status).toBe(200);
      expect(JSON.parse(next.body).path).toBe(`/api/v1/companies?i=${i}`);
    }
  });

  it('answers a WebSocket handshake with 501 instead of leaving the socket open', async () => {
    const front = await frontServer(await apiLikeUpstream());
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(front, '127.0.0.1', () => {
        socket.write(
          'GET /api/v1/realtime HTTP/1.1\r\nhost: x\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        );
      });
      let data = '';
      socket.on('data', (c) => (data += c));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
      socket.setTimeout(2000, () => reject(new Error('socket left open')));
    });
    expect(reply).toMatch(/^HTTP\/1\.1 501/);
    expect((await get(front, '/api/v1/me')).status).toBe(200);
  });
});
