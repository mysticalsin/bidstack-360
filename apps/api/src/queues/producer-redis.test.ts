// The company-create hang was Queue.add() sitting on ioredis' offline queue.
// These cases lock the producer budget: a refused port, a socket that starts
// listening during the budget, and a reply just inside and just outside
// commandTimeout.
import net from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  QUEUE_PRODUCER_TIMEOUT_MS,
  openQueueProducer,
  queueProducerRedisOptions,
  whenProducerReady,
} from './producer-redis.js';

const openSockets = new Set<net.Socket>();
const servers: net.Server[] = [];

function listen(server: net.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await listen(probe, 0);
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  await close(probe);
  return address.port;
}

function takeCommand(buf: Buffer): { argv: string[]; rest: Buffer } | null {
  if (buf.length === 0 || buf[0] !== 0x2a) return null;
  const line = buf.indexOf(0x0a);
  if (line < 1) return null;
  const count = Number(buf.toString('utf8', 1, line - 1));
  if (!Number.isInteger(count) || count < 0) return null;
  let offset = line + 1;
  const argv: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (buf[offset] !== 0x24) return null;
    const end = buf.indexOf(0x0a, offset);
    if (end < 0) return null;
    const len = Number(buf.toString('utf8', offset + 1, end - 1));
    if (!Number.isInteger(len) || len < 0) return null;
    const start = end + 1;
    const stop = start + len;
    if (buf.length < stop + 2) return null;
    argv.push(buf.toString('utf8', start, stop));
    offset = stop + 2;
  }
  return { argv, rest: buf.subarray(offset) };
}

function reply(argv: string[]): string {
  const cmd = (argv[0] ?? '').toUpperCase();
  if (cmd === 'PING') return '+PONG\r\n';
  if (cmd === 'INFO') {
    const body = 'redis_version:7.2.0\r\nloading:0\r\n';
    return `$${Buffer.byteLength(body)}\r\n${body}\r\n`;
  }
  if (cmd === 'COMMAND') return '*0\r\n';
  return '+OK\r\n';
}

function speak(socket: net.Socket, pingDelayMs: number): void {
  openSockets.add(socket);
  socket.on('close', () => openSockets.delete(socket));
  socket.on('error', () => socket.destroy());
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const parsed = takeCommand(buf);
      if (!parsed) return;
      buf = parsed.rest;
      const payload = reply(parsed.argv);
      const cmd = (parsed.argv[0] ?? '').toUpperCase();
      if (cmd === 'PING' && pingDelayMs > 0) {
        setTimeout(() => socket.write(payload), pingDelayMs);
      } else {
        socket.write(payload);
      }
    }
  });
}

function fakeRedis(pingDelayMs: number): net.Server {
  const server = net.createServer((socket) => speak(socket, pingDelayMs));
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
  await Promise.all(servers.splice(0).map((server) => (server.listening ? close(server) : Promise.resolve())));
});

describe('queue producer redis options', () => {
  it('rejects commands while offline and bounds each command', () => {
    const options = queueProducerRedisOptions();
    expect(options.enableOfflineQueue).toBe(false);
    expect(options.connectTimeout).toBe(QUEUE_PRODUCER_TIMEOUT_MS);
    expect(options.commandTimeout).toBe(QUEUE_PRODUCER_TIMEOUT_MS);
    // BullMQ Queue refuses a positive maxRetriesPerRequest on the client it is given.
    expect(options.maxRetriesPerRequest).toBeNull();
  });
});

describe('queue producer timing', () => {
  it('reports not ready within the budget when the port refuses', async () => {
    const client = openQueueProducer('redis://127.0.0.1:1', 400);
    const started = Date.now();
    try {
      await expect(whenProducerReady(client, 400)).resolves.toBe(false);
      expect(Date.now() - started).toBeLessThan(1_200);
    } finally {
      client.disconnect();
    }
  });

  it('accepts a ping when Redis starts listening during the connect budget', async () => {
    const port = await freePort();
    const server = fakeRedis(0);
    const client = openQueueProducer(`redis://127.0.0.1:${port}`, 1_000);
    const started = Date.now();
    const opened = setTimeout(() => {
      void listen(server, port);
    }, 200);
    try {
      await expect(whenProducerReady(client, 1_000)).resolves.toBe(true);
      expect(Date.now() - started).toBeGreaterThanOrEqual(150);
      await expect(client.ping()).resolves.toBe('PONG');
      expect(Date.now() - started).toBeLessThan(1_500);
    } finally {
      clearTimeout(opened);
      client.disconnect();
    }
  });

  it('returns a ping that arrives just under the command timeout', async () => {
    const timeoutMs = 500;
    const port = await freePort();
    const server = fakeRedis(timeoutMs - 150);
    await listen(server, port);
    const client = openQueueProducer(`redis://127.0.0.1:${port}`, timeoutMs);
    try {
      await expect(whenProducerReady(client, timeoutMs)).resolves.toBe(true);
      const started = Date.now();
      await expect(client.ping()).resolves.toBe('PONG');
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 200);
      expect(elapsed).toBeLessThan(timeoutMs);
    } finally {
      client.disconnect();
    }
  });

  it('fails a ping that arrives just over the command timeout', async () => {
    const timeoutMs = 400;
    const port = await freePort();
    const server = fakeRedis(timeoutMs + 1_500);
    await listen(server, port);
    const client = openQueueProducer(`redis://127.0.0.1:${port}`, timeoutMs);
    try {
      await expect(whenProducerReady(client, timeoutMs)).resolves.toBe(true);
      const started = Date.now();
      await expect(client.ping()).rejects.toThrow(/timed out/i);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
      expect(elapsed).toBeLessThan(timeoutMs + 800);
    } finally {
      client.disconnect();
    }
  });
});
