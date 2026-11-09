import { describe, expect, it, vi } from 'vitest';

import { discardFailedStart } from './failed-start-cleanup.js';

// WHY: when the cleanup of a failed start threw, its error replaced the
// start's own error: a retryable 503 became a 500, and the remaining cleanup
// never ran. The original error must reach the client, every step must run,
// and a failing step must be logged with the original as its cause.
describe('discardFailedStart', () => {
  it('runs every step, logs a failing one with the original error as cause, and never throws', async () => {
    const original = new Error('queue unavailable');
    const cleanupFailure = new Error('database unavailable');
    const log = { error: vi.fn() };
    const later = vi.fn(async () => undefined);

    await expect(
      discardFailedStart(original, log, [
        ['delete job row', async () => Promise.reject(cleanupFailure)],
        ['remove stored rows', later],
      ]),
    ).resolves.toBeUndefined();

    expect(later).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledWith(
      { err: cleanupFailure, cause: original, step: 'delete job row' },
      'could not clean up a failed migration start',
    );
  });

  it('logs nothing when every step succeeds', async () => {
    const log = { error: vi.fn() };
    await discardFailedStart(new Error('x'), log, [['delete job row', async () => 1]]);
    expect(log.error).not.toHaveBeenCalled();
  });
});
