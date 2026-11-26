import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@bidstack/db', () => ({
  prisma: {
    orgSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('../redis.js', () => ({
  redis: {
    mget: vi.fn(),
  },
}));

import { redis } from '../redis.js';
import {
  AI_BUDGET_UNAVAILABLE_REASON,
  checkDailyCap,
  noteWhenDailyCapDenies,
} from './ai-assistant.helpers.js';

const mget = vi.mocked(redis.mget);
const log = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

describe('checkDailyCap', () => {
  beforeEach(() => {
    mget.mockReset();
    log.warn.mockReset();
  });

  it('denies paid AI work when the budget store is unavailable', async () => {
    // WHY: the previous catch returned allowed:true. A Redis outage then let
    // paid model calls run with no recorded daily cap.
    mget.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkDailyCap('org', 'user', log as never);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(AI_BUDGET_UNAVAILABLE_REASON);
    // WHY: Jarvis puts this sentence in "Missing data". Calling a store miss
    // "budget reached" tells the reader the quota is zero when it was not read.
    expect(noteWhenDailyCapDenies(result)).toBe(
      'AI budget could not be read. Answered from records only.',
    );
  });

  it('still calls a real session cap reached', () => {
    expect(
      noteWhenDailyCapDenies({
        allowed: false,
        reason: 'Daily AI session limit of 100 reached.',
      }),
    ).toBe('AI budget reached, answered from records only.');
  });

  it('still allows a call when the store shows the cap has not been reached', async () => {
    mget.mockResolvedValue(['0', '0']);
    const result = await checkDailyCap('org', 'user', log as never);
    expect(result.allowed).toBe(true);
  });
});
