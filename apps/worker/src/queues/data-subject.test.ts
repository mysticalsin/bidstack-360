import { describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  runDataSubjectRequest: vi.fn(),
}));
vi.mock('@bidstack/db', () => ({ prisma: {}, runDataSubjectRequest: dbMocks.runDataSubjectRequest }));

import { processDataSubjectJob } from './data-subject.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as never;

// WHY: the worker is the only writer that runs an erasure for real. It must run
// exactly the request it was handed (by id) and must refuse a malformed job
// instead of guessing a subject.
describe('processDataSubjectJob', () => {
  it('runs the request by id and returns the outcome counts', async () => {
    dbMocks.runDataSubjectRequest.mockResolvedValueOnce({
      id: 'r1',
      status: 'done',
      kind: 'erase',
      dryRun: false,
    });
    const out = await processDataSubjectJob(
      { data: { requestId: '11111111-1111-4111-8111-111111111111', orgId: '22222222-2222-4222-8222-222222222222' } },
      log,
    );
    expect(dbMocks.runDataSubjectRequest).toHaveBeenCalledWith(
      {},
      '11111111-1111-4111-8111-111111111111',
    );
    expect(out.status).toBe('done');
  });

  it('rejects a job without a valid request id', async () => {
    await expect(processDataSubjectJob({ data: { requestId: 'nope' } }, log)).rejects.toThrow(
      /invalid job data/,
    );
    expect(dbMocks.runDataSubjectRequest).not.toHaveBeenCalledWith({}, 'nope');
  });
});
