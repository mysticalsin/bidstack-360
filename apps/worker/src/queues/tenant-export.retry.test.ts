/**
 * Tenant export retries. TENANT_EXPORT allows 3 attempts, so a transient
 * storage or database failure on attempt 1 must leave the row retryable:
 * marking it `failed` straight away made every BullMQ retry a silent no-op
 * (the claim only accepts pending|running) and the requester got a failed
 * export for a blip. Only the final attempt may mark the row failed.
 *
 * The sweeper can also fail a `running` export while its job is still
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
const upload = vi.hoisted(() => ({
  fail: true,
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
    if (upload.fail) throw new Error('storage unavailable');
    upload.onUpload();
    return { bytes: 42 };
  }),
  deleteExportArchive: vi.fn(async (key: string) => {
    upload.deleted.push(key);
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
  upload.fail = true;
  upload.onUpload = () => undefined;
  upload.deleted = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('tenant export retries', () => {
  it('keeps the row retryable when a non-final attempt fails', async () => {
    await expect(
      processTenantExportJob({ data, attemptsMade: 0, opts: { attempts: 3 } }, log),
    ).rejects.toThrow('storage unavailable');
    expect(db.status).toBe('running');
    expect(db.updates.some((u) => u.status === 'failed')).toBe(false);
  });

  it('a retry after a transient failure completes the export', async () => {
    await expect(
      processTenantExportJob({ data, attemptsMade: 0, opts: { attempts: 3 } }, log),
    ).rejects.toThrow();
    upload.fail = false;
    await processTenantExportJob({ data, attemptsMade: 1, opts: { attempts: 3 } }, log);
    expect(db.status).toBe('ready');
    expect(upload.deleted).toEqual([]);
  });

  it('marks the row failed on the final attempt', async () => {
    await expect(
      processTenantExportJob({ data, attemptsMade: 2, opts: { attempts: 3 } }, log),
    ).rejects.toThrow('storage unavailable');
    expect(db.status).toBe('failed');
  });

  it('treats a job without retry metadata as final', async () => {
    await expect(processTenantExportJob({ data }, log)).rejects.toThrow();
    expect(db.status).toBe('failed');
  });
});

describe('tenant export swept while running', () => {
  it('deletes the uploaded archive and fails the job without a retry', async () => {
    upload.fail = false;
    upload.onUpload = () => {
      db.status = 'failed';
    };
    const err = await processTenantExportJob(
      { data, attemptsMade: 0, opts: { attempts: 3 } },
      log,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnrecoverableError);
    expect(upload.deleted).toEqual([key]);
    expect(db.status).toBe('failed');
    expect(db.updates.some((u) => u.status === 'ready')).toBe(false);
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
