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
import { checkDailyCap } from './ai-assistant.helpers.js';

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
    expect(result.reason).toMatch(/budget state is unavailable/i);
  });

  it('still allows a call when the store shows the cap has not been reached', async () => {
    mget.mockResolvedValue(['0', '0']);
    const result = await checkDailyCap('org', 'user', log as never);
    expect(result.allowed).toBe(true);
  });
});
