/**
 * Tenant export retries. TENANT_EXPORT allows 3 attempts, so a transient
 * storage or database failure on attempt 1 must leave the row retryable:
 * marking it `failed` straight away made every BullMQ retry a silent no-op
 * (the claim only accepts pending|running) and the requester got a failed
 * export for a blip. Only the final attempt may mark the row failed.
 */
import pino from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  status: 'pending' as string,
  updates: [] as Array<Record<string, unknown>>,
}));
const upload = vi.hoisted(() => ({ fail: true }));

vi.mock('@bidstack/db', () => ({
  prisma: {
    tenantExport: {
      updateMany: vi.fn(async (args: { where: { status: unknown }; data: Record<string, unknown> }) => {
        const allowed = args.where.status as string | { in: string[] };
        const matches =
          typeof allowed === 'string' ? allowed === db.status : allowed.in.includes(db.status);
        if (!matches) return { count: 0 };
        db.updates.push(args.data);
        db.status = String(args.data.status);
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
    return { bytes: 42 };
  }),
}));

const { processTenantExportJob } = await import('./tenant-export.js');
const log = pino({ level: 'silent' });
const data = {
  exportId: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
};

beforeEach(() => {
  db.status = 'pending';
  db.updates = [];
  upload.fail = true;
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
