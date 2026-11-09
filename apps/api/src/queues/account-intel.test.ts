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

const READY_INFO = 'redis_version:7.0.15\r\nloading:0\r\nmaxmemory_policy:noeviction\r\n';

/** Parses RESP arrays of bulk strings, enough for ioredis requests. */
function takeCommands(buffer: string): { commands: string[][]; rest: string } {
  const commands: string[][] = [];
  let rest = buffer;
  for (;;) {
    const header = /^\*(\d+)\r\n/.exec(rest);
    if (!header) break;
    let pos = header[0].length;
    const parts: string[] = [];
    for (let i = 0; i < Number(header[1]); i++) {
      const len = /^\$(\d+)\r\n/.exec(rest.slice(pos));
      if (!len || rest.length < pos + len[0].length + Number(len[1]) + 2) return { commands, rest };
      pos += len[0].length;
      parts.push(rest.slice(pos, pos + Number(len[1])));
      pos += Number(len[1]) + 2;
    }
    commands.push(parts);
    rest = rest.slice(pos);
  }
  return { commands, rest };
}

/**
 * Answers the ioredis ready check so the connection reports 'ready', then
 * never replies to anything else: a Redis that froze after connecting.
 */
async function startFrozenAfterReadyServer(): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  silent = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (chunk) => {
      const parsed = takeCommands(buffer + chunk.toString('latin1'));
      buffer = parsed.rest;
      for (const [name = ''] of parsed.commands) {
        const command = name.toUpperCase();
        received.push(command);
        if (command === 'INFO') socket.write(`$${READY_INFO.length}\r\n${READY_INFO}\r\n`);
        else if (command === 'CLIENT' || command === 'SELECT') socket.write('+OK\r\n');
        else if (command === 'PING') socket.write('+PONG\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => silent!.listen(0, '127.0.0.1', resolve));
  const address = silent.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  return { port: address.port, received };
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
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const started = Date.now();

    const jobId = await queueFirstAccountIntel(
      { intelSourceRun: { createMany, deleteMany } },
      { orgId: ORG, companyId: COMPANY, requestedBy: null },
    );

    expect(jobId).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    // No job, so no "queued" run rows that would never progress.
    expect(deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG, companyId: COMPANY, source: { in: ['registry', 'financials'] }, status: 'queued' },
    });
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

  // A Redis that was already ready and then froze passed every readiness
  // check, so POST /companies hung after its rows committed (QA F1).
  it('gives up within a bound when a ready Redis stops answering the add', async () => {
    const { port, received } = await startFrozenAfterReadyServer();
    const { queueFirstAccountIntel } = await loadWithRedis(`redis://127.0.0.1:${port}`);
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const started = Date.now();

    const jobId = await queueFirstAccountIntel(
      { intelSourceRun: { createMany, deleteMany } },
      { orgId: ORG, companyId: COMPANY, requestedBy: null },
    );

    expect(jobId).toBeNull();
    expect(Date.now() - started).toBeLessThan(5_000);
    // The connection passed the ready check and the add script was sent, so
    // the wait that was cut short is the add itself.
    expect(received).toContain('INFO');
    expect(received.some((command) => command === 'EVALSHA' || command === 'EVAL')).toBe(true);
    // The account shows no first run instead of runs stuck at "queued".
    expect(deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG, companyId: COMPANY, source: { in: ['registry', 'financials'] }, status: 'queued' },
    });
  }, 15_000);
});

describe('first account intel run bookkeeping', () => {
  afterEach(async () => {
    const { __setAccountIntelEnqueueForTest } = await import('./account-intel.js');
    __setAccountIntelEnqueueForTest(null);
  });

  // The worker marks failures with updateMany on queued/running rows, so the
  // rows must exist before a worker can pick the job up (QA F2).
  it('writes the queued rows before the job is enqueued', async () => {
    vi.resetModules();
    const mod = await import('./account-intel.js');
    const order: string[] = [];
    const createMany = vi.fn(async () => {
      order.push('rows');
      return { count: 2 };
    });
    const deleteMany = vi.fn();
    mod.__setAccountIntelEnqueueForTest(async () => {
      order.push('enqueue');
      return 'job-1';
    });

    const jobId = await mod.queueFirstAccountIntel(
      { intelSourceRun: { createMany, deleteMany } },
      { orgId: ORG, companyId: COMPANY, requestedBy: null },
    );

    expect(jobId).toBe('job-1');
    expect(order).toEqual(['rows', 'enqueue']);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { orgId: ORG, companyId: COMPANY, source: 'registry', status: 'queued' },
        { orgId: ORG, companyId: COMPANY, source: 'financials', status: 'queued' },
      ],
      skipDuplicates: true,
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('removes its queued rows when the job was not queued', async () => {
    vi.resetModules();
    const mod = await import('./account-intel.js');
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    mod.__setAccountIntelEnqueueForTest(async () => null);

    const jobId = await mod.queueFirstAccountIntel(
      { intelSourceRun: { createMany, deleteMany } },
      { orgId: ORG, companyId: COMPANY, requestedBy: null },
    );

    expect(jobId).toBeNull();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG, companyId: COMPANY, source: { in: ['registry', 'financials'] }, status: 'queued' },
    });
  });

  it('never enqueues a job whose rows could not be written', async () => {
    vi.resetModules();
    const mod = await import('./account-intel.js');
    const enqueue = vi.fn(async () => 'job-1');
    mod.__setAccountIntelEnqueueForTest(enqueue);

    const jobId = await mod.queueFirstAccountIntel(
      { intelSourceRun: { createMany: vi.fn().mockRejectedValue(new Error('db down')), deleteMany: vi.fn() } },
      { orgId: ORG, companyId: COMPANY, requestedBy: null },
    );

    expect(jobId).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
