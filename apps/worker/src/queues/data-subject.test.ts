import { DelayedError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  runDataSubjectRequest: vi.fn(),
}));
vi.mock('@bidstack/db', () => ({ prisma: {}, runDataSubjectRequest: dbMocks.runDataSubjectRequest }));

import { processDataSubjectJob } from './data-subject.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never;
const REQUEST = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

// WHY: the worker is the only writer that runs an erasure for real. It must run
// exactly the request it was handed (by id, inside its org) and must refuse a
// malformed job instead of guessing a subject.
describe('processDataSubjectJob', () => {
  it('runs the request by id inside the job org and returns the outcome counts', async () => {
    dbMocks.runDataSubjectRequest.mockResolvedValueOnce({
      id: 'r1',
      status: 'done',
      kind: 'erase',
      dryRun: false,
    });
    const out = await processDataSubjectJob({ data: { requestId: REQUEST, orgId: ORG } }, log);
    expect(dbMocks.runDataSubjectRequest).toHaveBeenCalledWith(
      {},
      REQUEST,
      ORG,
      expect.objectContaining({ deleteObjects: expect.any(Function) }),
    );
    expect(out.status).toBe('done');
  });

  it('rejects a job without a valid request id', async () => {
    await expect(processDataSubjectJob({ data: { requestId: 'nope' } }, log)).rejects.toThrow(
      /invalid job data/,
    );
    expect(dbMocks.runDataSubjectRequest).not.toHaveBeenCalledWith({}, 'nope', expect.anything(), expect.anything());
  });

  it('delays a busy request until its claim goes stale instead of completing the job', async () => {
    const retryAt = new Date('2026-11-08T12:15:01Z');
    dbMocks.runDataSubjectRequest.mockResolvedValueOnce({ id: 'r1', status: 'busy', kind: 'erase', dryRun: false, retryAt });
    const moveToDelayed = vi.fn(async () => undefined);
    await expect(
      processDataSubjectJob({ data: { requestId: REQUEST, orgId: ORG }, moveToDelayed }, log, 'tok'),
    ).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(retryAt.getTime(), 'tok');
  });
});
