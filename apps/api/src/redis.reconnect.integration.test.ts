// A socket that stays down past the old five-attempt budget used to end the
// client. The process delay and the duplicate the queue opens must both come
// back when the socket accepts connections again, without a manual connect().

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

describe('redis reconnects after an outage', () => {
  it('answers after the socket is down longer than the old five-attempt budget', async () => {
    const retryStrategy = redis.options.retryStrategy;
    expect(typeof retryStrategy).toBe('function');

    const upstream = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380');
    const upstreamPort = Number(upstream.port || 6379);
    const port = await freePort();
    const sockets = new Set<net.Socket>();
    const proxy = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      const remote = net.connect(upstreamPort, '127.0.0.1');
      sockets.add(remote);
      remote.on('close', () => sockets.delete(remote));
      socket.pipe(remote);
      remote.pipe(socket);
      const drop = (): void => {
        socket.destroy();
        remote.destroy();
      };
      socket.on('error', drop);
      remote.on('error', drop);
    });

    let client: Redis | undefined;
    let duplicate: Redis | undefined;

    try {
      await listen(proxy, port);
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

      for (const socket of sockets) socket.destroy();
      await close(proxy);
      // The old budget was five delays of 200ms, 400ms, 600ms, 800ms, and
      // 1000ms, about three seconds, and then the client stopped.
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      expect(client.status).not.toBe('end');
      expect(duplicate.status).not.toBe('end');

      await listen(proxy, port);
      const pong = async (connection: Redis): Promise<void> => {
        const started = Date.now();
        let last = connection.status;
        while (Date.now() - started < 6_000) {
          try {
            if ((await connection.ping()) === 'PONG') return;
          } catch (err) {
            last = err instanceof Error ? `${connection.status}:${err.message}` : connection.status;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`no pong from ${last}`);
      };
      await pong(client);
      await pong(duplicate);
    } finally {
      client?.disconnect();
      duplicate?.disconnect();
      if (proxy.listening) await close(proxy);
    }
  }, 20_000);
});
