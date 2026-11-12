// After Redis has been down long enough for the client to give up, the client
// is `end` and stays that way. Redis can be back for a full minute and
// start-csv still returns 500. The next start has to succeed on this process.

import { spawnSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@bidstack/db';
import type { FastifyInstance } from 'fastify';

import { buildServer } from '../server.js';
import {
  createIsolatedOrg,
  dropIsolatedOrg,
  useIsolatedOrgAuth,
  type IsolatedOrg,
} from '../test-support/isolated-org.js';

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('migration-recover');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReachable) throw new Error(`[skip] ${name} — DATABASE_URL not reachable`);
    await fn();
  });

describe('csv start after redis gives up', () => {
  t('returns 201 once redis is back, instead of 500', async () => {
    // WHY: a 5s or 15s outage exhausts the five reconnect tries. The client
    // is ended. Restoring Redis does not help until something connects again,
    // so every start for the next minute is 500.
    const start = (name: string) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/migrations/start-csv',
        payload: {
          source: 'CSV',
          entityType: 'company',
          rows: [{ name }],
          mappings: { name: 'company.name' },
        },
      });

    const before = await start('Before outage');
    expect(before.statusCode).toBe(201);

    server.redis.disconnect();
    if (server.redis.status !== 'end') {
      await new Promise<void>((resolve) => {
        server.redis.once('end', () => resolve());
      });
    }
    expect(server.redis.status).toBe('end');

    const after = await start('After restore');
    expect(after.statusCode).not.toBe(500);
    expect(after.statusCode).toBe(201);
    expect(after.json()).toMatchObject({ status: 'RUNNING' });
  });

  const redisTools =
    spawnSync('redis-cli', ['--version']).status === 0 &&
    spawnSync('redis-server', ['--version']).status === 0;

  // A real outage, not only a manual disconnect. CI's Redis is a service
  // container without redis-server in the job, so this case runs where the
  // binary can restart the port. The ended-client case above is the 500.
  (redisTools ? it : it.skip)(
    'returns 201 after redis has been down for 6 seconds',
    async () => {
      if (!dbReachable) throw new Error('[skip] redis outage — DATABASE_URL not reachable');
      const port = Number(new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380').port || 6379);
      const start = (name: string) =>
        server.inject({
          method: 'POST',
          url: '/api/v1/migrations/start-csv',
          payload: {
            source: 'CSV',
            entityType: 'company',
            rows: [{ name }],
            mappings: { name: 'company.name' },
          },
        });
      try {
        spawnSync('redis-cli', ['-p', String(port), 'shutdown', 'nosave']);
        await new Promise((resolve) => setTimeout(resolve, 6_000));
        const started = spawnSync(
          'redis-server',
          [
            '--port',
            String(port),
            '--bind',
            '127.0.0.1',
            '--protected-mode',
            'no',
            '--save',
            '',
            '--appendonly',
            'no',
            '--daemonize',
            'yes',
            '--dir',
            '/tmp',
            '--dbfilename',
            'polo-outage.rdb',
            '--logfile',
            '/tmp/polo-outage-redis.log',
          ],
          { encoding: 'utf8' },
        );
        if (started.status !== 0) {
          throw new Error(started.stderr || started.stdout || 'redis did not restart');
        }
        let status = 0;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const res = await start(`After six seconds ${attempt}`);
          status = res.statusCode;
          if (status === 201) break;
          expect(status).not.toBe(500);
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(status).toBe(201);
      } finally {
        const ping = spawnSync('redis-cli', ['-p', String(port), 'ping'], { encoding: 'utf8' });
        if (!ping.stdout?.includes('PONG')) {
          spawnSync('redis-server', [
            '--port',
            String(port),
            '--bind',
            '127.0.0.1',
            '--protected-mode',
            'no',
            '--save',
            '',
            '--appendonly',
            'no',
            '--daemonize',
            'yes',
            '--dir',
            '/tmp',
            '--dbfilename',
            'polo-outage.rdb',
          ]);
        }
      }
    },
    30_000,
  );
});
