// A socket that stays down past the old five-attempt budget used to end the
// client. The process delay and the duplicate the queue opens must both come
// back when the socket accepts connections again, without a manual connect().
//
// The socket answers PING itself. Proxying that to REDIS_URL left the client
// in `reconnecting` whenever the upstream refused or stalled, and the poll
// then threw `no pong from reconnecting`.

import net from 'node:net';

import Redis from 'ioredis';
import { describe, expect, it } from 'vitest';

import { redis } from './redis.js';

function listen(server: net.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
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

function speakRedis(socket: net.Socket): void {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const parsed = takeCommand(buf);
      if (!parsed) return;
      buf = parsed.rest;
      socket.write(reply(parsed.argv));
    }
  });
}

describe('redis reconnects after an outage', () => {
  it('answers after the socket is down longer than the old five-attempt budget', async () => {
    const retryStrategy = redis.options.retryStrategy;
    expect(typeof retryStrategy).toBe('function');

    const port = await freePort();
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
      speakRedis(socket);
    });

    let client: Redis | undefined;
    let duplicate: Redis | undefined;

    try {
      await listen(server, port);
      client = new Redis({
        host: '127.0.0.1',
        port,
        connectTimeout: 500,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy,
      });
      duplicate = client.duplicate();
      client.on('error', () => undefined);
      duplicate.on('error', () => undefined);
      const ready = (connection: Redis) =>
        new Promise<void>((resolve, reject) => {
          if (connection.status === 'ready') {
            resolve();
            return;
          }
          const timer = setTimeout(
            () => reject(new Error(`not ready: ${connection.status}`)),
            2_000,
          );
          connection.once('ready', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      await ready(client);
      await ready(duplicate);
      expect(await client.ping()).toBe('PONG');
      expect(await duplicate.ping()).toBe('PONG');

      // Stop accepting before the sockets drop, so a reconnect that wins the
      // race cannot sit in close() until the test clock expires.
      const stopped = close(server);
      for (const socket of sockets) socket.destroy();
      await stopped;
      // The old budget was five delays of 200ms, 400ms, 600ms, 800ms, and
      // 1000ms, about three seconds, and then the client stopped.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      expect(client.status).not.toBe('end');
      expect(duplicate.status).not.toBe('end');

      await listen(server, port);
      const pong = async (connection: Redis): Promise<void> => {
        if (connection.status !== 'ready') {
          await new Promise<void>((resolve, reject) => {
            const onReady = (): void => {
              clearTimeout(timer);
              resolve();
            };
            const timer = setTimeout(() => {
              connection.off('ready', onReady);
              reject(new Error(`no pong from ${connection.status}`));
            }, 6_000);
            connection.once('ready', onReady);
          });
        }
        if ((await connection.ping()) !== 'PONG') {
          throw new Error(`no pong from ${connection.status}`);
        }
      };
      await pong(client);
      await pong(duplicate);
    } finally {
      client?.disconnect();
      duplicate?.disconnect();
      if (server.listening) await close(server);
    }
  }, 20_000);
});
