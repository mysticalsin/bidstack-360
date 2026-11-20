// WHY: a real deadlock must fail the chunk, BullMQ must run it again, and the
// job the API returns — including the error file — must not carry process
// ids, transaction ids, driver text, or a source path.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
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

const RAW_PG =
  /40P01|40001|P2034|ShareLock|ConnectorError|PostgresError|deadlock detected|Process \d+|transaction \d+|apps\/worker\/src\/queues\/migration\.ts/;

let server: FastifyInstance;
let org: IsolatedOrg;
let restoreAuth: () => void;
let dbReachable = false;
let userId = '';

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  org = await createIsolatedOrg('migration-deadlock');
  restoreAuth = useIsolatedOrgAuth(org.clerkOrg);
  const user = await prisma.user.findFirst({
    where: { orgId: org.orgId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!user) throw new Error('isolated org has no user');
  userId = user.id;
  server = await buildServer();
  await server.ready();
}, 120_000);

afterAll(async () => {
  if (server) await server.close();
  restoreAuth?.();
  if (org) await dropIsolatedOrg(org.orgId);
});

function redisDb15(raw: string): string {
  const url = new URL(raw);
  url.pathname = '/15';
  return url.toString();
}

describe('a real import deadlock', () => {
  it(
    'retries the chunk and keeps driver text out of the job and the error file',
    async () => {
      if (!dbReachable) throw new Error('[skip] deadlock — DATABASE_URL not reachable');
      const redisRaw = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
      const redisUrl = redisDb15(redisRaw);
      const ping = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      try {
        if ((await ping.ping()) !== 'PONG') throw new Error('redis did not answer');
      } finally {
        ping.disconnect();
      }
      const timeout = await prisma.$queryRaw<Array<{ deadlock_timeout: string }>>`
        SHOW deadlock_timeout
      `;
      expect(timeout[0]?.deadlock_timeout).toBe('1s');

      const ns = randomUUID().slice(0, 8);
      const names = [1, 2, 3, 4].map((n) => `dlk-${ns}-${n}`);
      const attemptA = randomUUID();
      const attemptB = randomUUID();
      const failLog = join(mkdtempSync(join(tmpdir(), 'deadlock-')), 'failed.txt');
      writeFileSync(failLog, '');
      const childPath = new URL(
        '../../../worker/src/queues/migration.deadlock.worker.ts',
        import.meta.url,
      ).pathname;
      const tsxPath = new URL('../../../worker/node_modules/.bin/tsx', import.meta.url).pathname;
      let child: ChildProcess | undefined;
      const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      const queue = new Queue('migration', { connection: redis });
      try {
        await prisma.$executeRawUnsafe(`
          CREATE OR REPLACE FUNCTION bidstack_stall_deadlock_name() RETURNS trigger
          LANGUAGE plpgsql AS $fn$
          BEGIN
            IF NEW.name LIKE 'dlk-%' THEN
              PERFORM pg_sleep(0.25);
            END IF;
            RETURN NEW;
          END;
          $fn$
        `);
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS bidstack_stall_deadlock_name ON companies`,
        );
        await prisma.$executeRawUnsafe(`
          CREATE TRIGGER bidstack_stall_deadlock_name
          BEFORE INSERT ON companies
          FOR EACH ROW
          EXECUTE FUNCTION bidstack_stall_deadlock_name()
        `);

        async function job(attemptId: string) {
          return prisma.migrationJob.create({
            data: {
              orgId: org.orgId,
              userId,
              source: 'CSV',
              status: 'RUNNING',
              totalRows: names.length,
              processedRows: 0,
              startedAt: new Date(),
              meta: { entityType: 'companies', attemptId },
            },
          });
        }
        const forward = await job(attemptA);
        const backward = await prisma.migrationJob.create({
          data: {
            orgId: org.orgId,
            userId,
            source: 'SALESFORCE_CSV',
            status: 'RUNNING',
            totalRows: names.length,
            processedRows: 0,
            startedAt: new Date(),
            meta: { entityType: 'companies', attemptId: attemptB },
          },
        });
        await redis.set(`migration:${forward.id}:rows`, JSON.stringify(names.map((name) => ({ Name: name }))));
        await redis.set(
          `migration:${backward.id}:rows`,
          JSON.stringify([...names].reverse().map((name) => ({ Name: name }))),
        );

        child = spawn(tsxPath, [childPath], {
          env: {
            ...process.env,
            DEADLOCK_REDIS_URL: redisUrl,
            DEADLOCK_FAIL_LOG: failLog,
            ACCOUNT_INTEL_IMPORT_ENRICH: 'false',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let childOut = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          childOut += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          childOut += chunk.toString();
        });
        const ready = Date.now() + 15_000;
        while (!childOut.includes('READY') && Date.now() < ready) {
          if (child.exitCode !== null) throw new Error(`worker exited: ${childOut}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!childOut.includes('READY')) throw new Error(`worker did not start: ${childOut}`);

        const payload = (row: { id: string }, attemptId: string, key: string) => ({
          migrationJobId: row.id,
          orgId: org.orgId,
          userId,
          source: 'CSV',
          entityType: 'companies',
          chunkOffset: 0,
          chunkSize: 100,
          totalRows: names.length,
          redisKey: key,
          mappings: { Name: 'company.name' },
          dedupStrategy: 'skip',
          attemptId,
        });
        await queue.add('chunk', payload(forward, attemptA, `migration:${forward.id}:rows`), {
          jobId: `${forward.id}-chunk-0`,
          attempts: 3,
          backoff: { type: 'fixed', delay: 500 },
        });
        await queue.add('chunk', payload(backward, attemptB, `migration:${backward.id}:rows`), {
          jobId: `${backward.id}-chunk-0`,
          attempts: 3,
          backoff: { type: 'fixed', delay: 500 },
        });

        async function finished(id: string) {
          const deadline = Date.now() + 30_000;
          let body = '';
          while (Date.now() < deadline) {
            const res = await server.inject({ method: 'GET', url: `/api/v1/migrations/${id}` });
            body = res.body;
            expect(res.statusCode).toBe(200);
            const parsed = JSON.parse(body) as { status: string };
            if (parsed.status === 'COMPLETE' || parsed.status === 'FAILED') return body;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          throw new Error(`import did not finish: ${body}`);
        }

        const forwardBody = await finished(forward.id);
        const backwardBody = await finished(backward.id);
        const forwardCsv = await server.inject({
          method: 'GET',
          url: `/api/v1/migrations/${forward.id}/errors.csv`,
        });
        const backwardCsv = await server.inject({
          method: 'GET',
          url: `/api/v1/migrations/${backward.id}/errors.csv`,
        });
        expect(forwardCsv.statusCode).toBe(200);
        expect(backwardCsv.statusCode).toBe(200);
        const failed = readFileSync(failLog, 'utf8');
        const surfaced = `${forwardBody}\n${backwardBody}\n${forwardCsv.body}\n${backwardCsv.body}\n${failed}`;
        expect(surfaced).not.toMatch(RAW_PG);
        expect(failed.length).toBeGreaterThan(0);
        expect(await prisma.company.count({
          where: { orgId: org.orgId, name: { startsWith: `dlk-${ns}-` }, deletedAt: null },
        })).toBe(names.length);
      } finally {
        if (child && child.exitCode === null) {
          child.kill('SIGTERM');
          await new Promise((resolve) => child?.once('exit', resolve));
        }
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS bidstack_stall_deadlock_name ON companies`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS bidstack_stall_deadlock_name()`);
        await queue.obliterate({ force: true }).catch(() => undefined);
        await queue.close();
        redis.disconnect();
        if (org) {
          const finished = org;
          org = undefined as unknown as IsolatedOrg;
          await dropIsolatedOrg(finished.orgId);
        }
      }
    },
    60_000,
  );
});
