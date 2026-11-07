/**
 * The API writes a `pending` TenantExport row and then enqueues. When Redis is
 * down the enqueue fails and nothing ever picks the row up; when a worker dies
 * mid-export the row sits `running` forever. The sweeper recovers both.
 */
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  id: string;
  orgId: string;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
}

const store = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(row: Row, where: Record<string, unknown>): boolean {
  if (where.status && row.status !== where.status) return false;
  if ('deletedAt' in where && row.deletedAt !== where.deletedAt) return false;
  for (const key of ['createdAt', 'startedAt'] as const) {
    const bound = where[key] as { lt: Date } | undefined;
    if (bound && !(row[key] && row[key]! < bound.lt)) return false;
  }
  return true;
}

vi.mock('@bidstack/db', () => ({
  prisma: {
    tenantExport: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = store.rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      }),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
        store.rows
          .filter((r) => matches(r, where))
          .slice(0, take)
          .map((r) => ({ id: r.id, orgId: r.orgId })),
      ),
    },
  },
}));

const { makeRedrive, sweepTenantExports, PENDING_GRACE_MS, RUNNING_SLA_MS } = await import(
  './tenant-export-sweeper.js'
);
const log = pino({ level: 'silent' });
const now = new Date('2026-11-07T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

function row(id: string, status: string, ageMs: number, startedAgoMs: number | null = null): Row {
  return {
    id,
    orgId: 'org-1',
    status,
    deletedAt: null,
    createdAt: ago(ageMs),
    startedAt: startedAgoMs === null ? null : ago(startedAgoMs),
  };
}

beforeEach(() => {
  store.rows = [];
});

describe('sweepTenantExports', () => {
  it('re-enqueues pending rows past the grace period and leaves fresh ones alone', async () => {
    store.rows = [row('old', 'pending', PENDING_GRACE_MS + 1_000), row('fresh', 'pending', 1_000)];
    const enqueue = vi.fn(async () => true);
    const result = await sweepTenantExports(enqueue, log, now);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({ exportId: 'old', orgId: 'org-1' });
    expect(result.requeued).toBe(1);
  });

  it('fails running rows past the SLA and keeps live ones running', async () => {
    store.rows = [
      row('dead', 'running', RUNNING_SLA_MS * 2, RUNNING_SLA_MS + 1_000),
      row('live', 'running', 60_000, 60_000),
    ];
    const result = await sweepTenantExports(vi.fn(), log, now);
    expect(result.failed).toBe(1);
    expect(store.rows.find((r) => r.id === 'dead')?.status).toBe('failed');
    expect(store.rows.find((r) => r.id === 'live')?.status).toBe('running');
  });

  it('never touches terminal or deleted rows', async () => {
    const deleted = row('gone', 'pending', PENDING_GRACE_MS * 3);
    deleted.deletedAt = ago(1_000);
    store.rows = [row('done', 'ready', RUNNING_SLA_MS * 3, RUNNING_SLA_MS * 3), deleted];
    const enqueue = vi.fn(async () => true);
    const result = await sweepTenantExports(enqueue, log, now);
    expect(enqueue).not.toHaveBeenCalled();
    expect(result).toEqual({ requeued: 0, failed: 0 });
    expect(store.rows[0]?.status).toBe('ready');
  });

  it('keeps sweeping when one re-enqueue fails (Redis still flaky)', async () => {
    store.rows = [
      row('a', 'pending', PENDING_GRACE_MS * 2),
      row('b', 'pending', PENDING_GRACE_MS * 2),
    ];
    const enqueue = vi
      .fn<(job: { exportId: string }) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(true);
    const result = await sweepTenantExports(enqueue, log, now);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(result.requeued).toBe(1);
  });
});

// jobId = exportId, and removeOnFail keeps failed jobs for 30 days, so a plain
// add would be a silent no-op for exactly the rows that need a re-drive.
describe('makeRedrive', () => {
  function fakeQueue(state: string | null) {
    const job = state
      ? { getState: vi.fn(async () => state), retry: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
      : undefined;
    const queue = { getJob: vi.fn(async () => job), add: vi.fn(async () => ({})) };
    return { queue, job };
  }
  const data = { exportId: 'e1', orgId: 'org-1' };

  it('adds a job when none exists', async () => {
    const { queue } = fakeQueue(null);
    await expect(makeRedrive(queue as never)(data)).resolves.toBe(true);
    expect(queue.add).toHaveBeenCalledWith('tenant.export', data, { jobId: 'e1' });
  });

  it('retries a kept failed job instead of a no-op add', async () => {
    const { queue, job } = fakeQueue('failed');
    await expect(makeRedrive(queue as never)(data)).resolves.toBe(true);
    expect(job!.retry).toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('leaves a waiting or active job alone and does not count it', async () => {
    for (const state of ['waiting', 'active', 'delayed']) {
      const { queue, job } = fakeQueue(state);
      await expect(makeRedrive(queue as never)(data)).resolves.toBe(false);
      expect(job!.retry).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    }
  });
});
