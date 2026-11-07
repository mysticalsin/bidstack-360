/**
 * The sweeper can fail a `running` export while its BullMQ job is still
 * uploading. The worker must notice that its final write matched no row,
 * remove the archive it just uploaded, and fail the job instead of logging
 * `ready` over a row that says `failed` and leaving an orphaned object.
 */
import pino from 'pino';
import { UnrecoverableError } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  status: 'pending' as string,
  updates: [] as Array<Record<string, unknown>>,
}));
const storage = vi.hoisted(() => ({
  onUpload: (() => undefined) as () => void,
  deleted: [] as string[],
}));

vi.mock('@bidstack/db', () => ({
  prisma: {
    tenantExport: {
      updateMany: vi.fn(async (args: { where: { status: unknown }; data: Record<string, unknown> }) => {
        const allowed = args.where.status as string | { in: string[] };
        const matches =
          typeof allowed === 'string' ? allowed === db.status : allowed.in.includes(db.status);
        if (!matches) return { count: 0 };
        db.updates.push(args.data);
        if (args.data.status) db.status = String(args.data.status);
        return { count: 1 };
      }),
    },
  },
}));

vi.mock('../lib/tenant-export-registry.js', () => ({
  TENANT_EXPORT_ENTITIES: [],
  safeSelectForModel: () => ({}),
}));

vi.mock('../lib/tenant-export-storage.js', () => ({
  uploadExportArchive: vi.fn(async ({ body }: { body: NodeJS.ReadableStream }) => {
    body.resume();
    storage.onUpload();
    return { bytes: 42 };
  }),
  deleteExportArchive: vi.fn(async (key: string) => {
    storage.deleted.push(key);
  }),
}));

const { processTenantExportJob, startExportHeartbeat, HEARTBEAT_EVERY_MS } = await import(
  './tenant-export.js'
);
const log = pino({ level: 'silent' });
const data = {
  exportId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
};
const key = `orgs/${data.orgId}/exports/${data.exportId}.ndjson.gz`;

beforeEach(() => {
  db.status = 'pending';
  db.updates = [];
  storage.deleted = [];
  storage.onUpload = () => undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tenant export swept while running', () => {
  it('deletes the uploaded archive and fails the job without a retry', async () => {
    storage.onUpload = () => {
      db.status = 'failed';
    };
    const err = await processTenantExportJob(
      { data, attemptsMade: 0, opts: { attempts: 3 } },
      log,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(storage.deleted).toEqual([key]);
    expect(db.status).toBe('failed');
    expect(db.updates.some((u) => u.status === 'ready')).toBe(false);
  });

  it('keeps the archive when the row is still running', async () => {
    await processTenantExportJob({ data, attemptsMade: 0, opts: { attempts: 3 } }, log);
    expect(db.status).toBe('ready');
    expect(storage.deleted).toEqual([]);
  });
});

describe('export heartbeat', () => {
  it('refreshes the row while running and reports when the row is gone', async () => {
    vi.useFakeTimers();
    db.status = 'running';
    const onLost = vi.fn();
    const stop = startExportHeartbeat(data, onLost, log);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_EVERY_MS);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toHaveProperty('updatedAt');
    expect(onLost).not.toHaveBeenCalled();

    db.status = 'failed';
    await vi.advanceTimersByTimeAsync(HEARTBEAT_EVERY_MS);
    expect(onLost).toHaveBeenCalledTimes(1);
    stop();
  });
});
