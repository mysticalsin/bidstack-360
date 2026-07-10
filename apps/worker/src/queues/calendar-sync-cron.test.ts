import type IORedis from 'ioredis';
import type pino from 'pino';
import type { Queue } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '@bidstack/db';

import {
  fanoutIncrementalPulls,
  fanoutWatchRenewals,
  sweepStrandedPushes,
} from './calendar-sync.js';
import { claimCalendarPush } from './calendar-sync-claim.js';

// WHY mock the DB: these are the cron fan-out / recovery paths. We drive the
// paginated reads and the enqueue side-effects; no real Postgres or Redis.
vi.mock('@bidstack/db', () => ({
  prisma: {
    integrationToken: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    calendarEvent: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// calendar-sync.js pulls in the Google/MS handlers, which import the SERUM
// runtime-policy module. Stub it so the import graph resolves without a DB. The
// worker vitest config runs with isolate:false, so this mock shares a registry
// with the sibling push tests — default it to "allowed" so if this fn wins the
// shared export it can never leave a co-running handler reading `.allowed` of
// undefined (these fan-out/sweep tests never exercise the connector-policy path).
vi.mock('@bidstack/db/serum-runtime-policy', () => ({
  SERUM_RUNTIME_CONFIG_KEYS: { connectors: 'registry' },
  checkSerumConnectorRuntimePolicy: vi
    .fn()
    .mockResolvedValue({ allowed: true, status: 'allowed', reason: 'allowed by test stub' }),
}));

const tokenFindMany = vi.mocked(prisma.integrationToken.findMany);
const eventFindMany = vi.mocked(prisma.calendarEvent.findMany);

const log = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
} as unknown as pino.Logger;

function makeFakeQueue() {
  const add = vi.fn().mockResolvedValue(undefined);
  return { queue: { add } as unknown as Queue, add };
}

/**
 * Minimal IORedis stub honoring the three ops the claim uses, with NX so a
 * second SET on an existing key returns null — the exact signal a stranded
 * 'pending' claim gives on a retry that reuses the same jobId.
 */
function makeFakeRedis(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const set = vi.fn(
    (key: string, val: string, _ex?: string, _ttl?: number, nx?: string): string | null => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, val);
      return 'OK';
    },
  );
  const get = vi.fn((key: string): string | null => store.get(key) ?? null);
  const del = vi.fn((key: string): number => (store.delete(key) ? 1 : 0));
  return { connection: { set, get, del } as unknown as IORedis, store };
}

function tokenRows(prefix: string, n: number): Array<{ id: string; orgId: string; userId: string }> {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${i}`,
    orgId: `org-${i}`,
    userId: `user-${i}`,
  }));
}

beforeEach(() => {
  (log.child as unknown as ReturnType<typeof vi.fn>).mockReturnValue(log);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('calendar cron fan-out is bounded (does not load every token in one job)', () => {
  it('pull fan-out cursor-paginates in bounded batches and enqueues one job per token', async () => {
    // 250 active tokens across two pages: a full 200-row batch then a 50-row tail.
    // WHY: proves the tick reads a bounded page (take:200) and cursors forward,
    // rather than a single unbounded findMany + inline per-token provider loop
    // that would overrun the 2-min repeat interval at deployment scale.
    tokenFindMany.mockResolvedValueOnce(tokenRows('tok', 200) as never);
    tokenFindMany.mockResolvedValueOnce(tokenRows('tok2', 50) as never);

    const { queue, add } = makeFakeQueue();
    await fanoutIncrementalPulls(queue, log);

    // Two bounded reads, each capped at 200 — never "load them all".
    expect(tokenFindMany).toHaveBeenCalledTimes(2);
    expect(tokenFindMany.mock.calls[0]![0]).toMatchObject({ take: 200 });
    expect(tokenFindMany.mock.calls[0]![0]).not.toHaveProperty('cursor');
    // Second page continues from the last id of the first batch.
    expect(tokenFindMany.mock.calls[1]![0]).toMatchObject({
      take: 200,
      skip: 1,
      cursor: { id: 'tok-199' },
    });

    // One lightweight per-token job enqueued for every token (200 + 50).
    expect(add).toHaveBeenCalledTimes(250);
    expect(add).toHaveBeenCalledWith(
      'calendar.pull-incremental',
      { orgId: 'org-0', userId: 'user-0', integrationTokenId: 'tok-0' },
      expect.objectContaining({ jobId: expect.stringMatching(/^calendar-pull:tok-0:\d+$/) }),
    );
  });

  it('watch-renew fan-out also cursor-paginates active Google tokens in bounded batches', async () => {
    tokenFindMany.mockResolvedValueOnce(tokenRows('g', 200) as never);
    tokenFindMany.mockResolvedValueOnce(tokenRows('g2', 3) as never);

    const { queue, add } = makeFakeQueue();
    await fanoutWatchRenewals(queue, log);

    expect(tokenFindMany).toHaveBeenCalledTimes(2);
    expect(tokenFindMany.mock.calls[0]![0]).toMatchObject({
      take: 200,
      where: { provider: 'google_workspace', status: 'active', deletedAt: null },
    });
    expect(add).toHaveBeenCalledTimes(203);
    expect(add).toHaveBeenCalledWith(
      'calendar.watch-renew',
      { integrationTokenId: 'g-0' },
      expect.objectContaining({ jobId: expect.stringMatching(/^calendar-watch:g-0:\d+$/) }),
    );
  });
});

describe('stranded-push recovery sweep', () => {
  const strandedEvent = {
    id: '00000000-0000-4000-8000-000000000010',
    orgId: '00000000-0000-4000-8000-000000000001',
    ownerId: '00000000-0000-4000-8000-000000000002',
  };

  it('re-enqueues a fresh push job only for locally-created, non-deleted PENDING_PUSH rows', async () => {
    eventFindMany.mockResolvedValueOnce([strandedEvent] as never);

    const { queue, add } = makeFakeQueue();
    await sweepStrandedPushes(queue, log);

    // The query is narrowed to the create-crash class: still PENDING_PUSH, never
    // reached the provider (externalId null), not soft-deleted, and old enough
    // that no legitimate in-flight create could still be retrying.
    const where = eventFindMany.mock.calls[0]![0]!.where;
    expect(where).toMatchObject({
      syncState: 'PENDING_PUSH',
      externalId: null,
      deletedAt: null,
    });
    expect(where.updatedAt.lt).toBeInstanceOf(Date);

    // Re-enqueued as a create push for the stranded event.
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'calendar.push',
      {
        orgId: strandedEvent.orgId,
        userId: strandedEvent.ownerId,
        calendarEventId: strandedEvent.id,
        operation: 'push',
      },
      expect.objectContaining({
        jobId: expect.stringMatching(new RegExp(`^calendar-push-sweep:${strandedEvent.id}:\\d+$`)),
      }),
    );
  });

  it('the fresh sweep job is claimable even while the crashed attempt\'s claim is stuck at "pending"', async () => {
    // WHY this is the whole point: a crash between the provider POST and the DB
    // commit leaves calendar:push:claim:<crashedJobId> = 'pending'. BullMQ's
    // stalled retry reuses that SAME jobId, re-hits the pending claim, and skips
    // forever — so the event can never be resent under the old job. The sweep
    // mints a NEW jobId; its claim key is absent, so the recovery attempt owns
    // the create and re-POSTs. Without the sweep, nothing ever mints that new id.
    const crashedJobId = 'job-crashed';
    const redis = makeFakeRedis({
      [`calendar:push:claim:${crashedJobId}`]: 'pending',
    });

    // The stranded attempt's own retry stays blocked — this is the bug the sweep exists to escape.
    await expect(
      claimCalendarPush(redis.connection, crashedJobId, strandedEvent.id, log),
    ).resolves.toBe(false);

    // Sweep discovers the stranded row and enqueues a fresh job with a new id.
    eventFindMany.mockResolvedValueOnce([strandedEvent] as never);
    const { queue, add } = makeFakeQueue();
    await sweepStrandedPushes(queue, log);
    const freshJobId = (add.mock.calls[0]![2] as { jobId: string }).jobId;
    expect(freshJobId).not.toBe(crashedJobId);

    // The recovery attempt owns the create (new claim key is free) → it will re-POST.
    await expect(
      claimCalendarPush(redis.connection, freshJobId, strandedEvent.id, log),
    ).resolves.toBe(true);
  });
});
