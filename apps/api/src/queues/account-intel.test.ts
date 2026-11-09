import { createServer, type Server, type Socket } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// WHY: POST /companies awaits queueFirstAccountIntel, which promises account
// creation never depends on Redis. With Redis absent the BullMQ add waited
// for a connection forever, so the request hung after the company row was
// committed and a client retry created a second company.
const ORG = '00000000-0000-4000-8000-000000000001';
const COMPANY = '00000000-0000-4000-8000-000000000002';

const previous = {
  redisUrl: process.env.REDIS_URL,
  enable: process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS,
};

let silent: Server | null = null;
const sockets = new Set<Socket>();

async function loadWithRedis(url: string) {
  process.env.REDIS_URL = url;
  process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = 'true';
  vi.resetModules();
  return import('./account-intel.js');
}

/** Accepts TCP connections and never answers, like a wedged Redis. */
async function startSilentServer(): Promise<number> {
  silent = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => silent!.listen(0, '127.0.0.1', resolve));
  const address = silent.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('account intel enqueue without a usable Redis', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    process.env.REDIS_URL = previous.redisUrl;
    if (previous.redisUrl === undefined) delete process.env.REDIS_URL;
    process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS = previous.enable;
    if (previous.enable === undefined) delete process.env.BIDSTACK_ENABLE_QUEUE_IN_TESTS;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => (silent ? silent.close(() => resolve()) : resolve()));
    silent = null;
  });

  it('gives up within a bound when nothing listens on the Redis port', async () => {
    const { queueFirstAccountIntel } = await loadWithRedis('redis://127.0.0.1:1');
    const createMany = vi.fn();
    const started = Date.now();

    const jobId = await queueFirstAccountIntel(
      { intelSourceRun: { createMany } },
      { orgId: ORG, companyId: COMPANY, requestedBy: null },
    );

    expect(jobId).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    // No job, so no "queued" run rows that would never progress.
    expect(createMany).not.toHaveBeenCalled();
  }, 15_000);

  it('gives up within a bound when Redis accepts the connection but never answers', async () => {
    const port = await startSilentServer();
    const { enqueueAccountIntel } = await loadWithRedis(`redis://127.0.0.1:${port}`);
    const started = Date.now();

    const jobId = await enqueueAccountIntel({
      kind: 'refresh',
      orgId: ORG,
      companyId: COMPANY,
      requestedBy: null,
      sources: ['registry'],
    });

    expect(jobId).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 15_000);
});
