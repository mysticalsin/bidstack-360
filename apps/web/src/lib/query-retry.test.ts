import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';

import { retryMutationOnce, retryQueryOnce } from './query-retry';

describe('query retry', () => {
  it('retries a server failure once, then stops so the panel can show the error', () => {
    const down = new ApiError('down', 500, null);

    // failureCount is how many failures already happened. 0 means "retry this
    // first failure"; 1 means the retry already failed.
    expect(retryQueryOnce(0, down)).toBe(true);
    expect(retryQueryOnce(1, down)).toBe(false);
    expect(retryMutationOnce(0, down)).toBe(true);
    expect(retryMutationOnce(1, down)).toBe(false);
  });

  it('does not retry a 4xx', () => {
    const rejected = new ApiError('nope', 400, null);
    expect(retryQueryOnce(0, rejected)).toBe(false);
  });
});
