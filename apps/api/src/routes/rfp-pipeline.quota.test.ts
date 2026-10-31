import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../redis.js', () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

import { redis } from '../redis.js';
import { checkRfpUploadRateLimit, RFP_UPLOAD_RATE_LIMIT_MAX } from './rfp-pipeline.helpers.js';

const incr = vi.mocked(redis.incr);
const expire = vi.mocked(redis.expire);

describe('checkRfpUploadRateLimit', () => {
  beforeEach(() => {
    incr.mockReset();
    expire.mockReset();
  });

  it('refuses the upload when the quota store is down in production', async () => {
    // WHY: a Redis outage used to return allowed. An RFP upload then bypassed
    // the hourly org cap, which is the quota this route exists to enforce.
    incr.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkRfpUploadRateLimit('org-1', { NODE_ENV: 'production' });
    expect(result).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('still allows a development upload when the quota store is down', async () => {
    incr.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkRfpUploadRateLimit('org-1', { NODE_ENV: 'development' });
    expect(result).toEqual({ allowed: true });
  });

  it('counts an upload inside the hourly cap', async () => {
    incr.mockResolvedValue(1);
    expire.mockResolvedValue(1);
    const result = await checkRfpUploadRateLimit('org-1', { NODE_ENV: 'production' });
    expect(result).toEqual({ allowed: true });
    expect(expire).toHaveBeenCalledOnce();
  });

  it('refuses the upload on the request past the hourly cap', async () => {
    incr.mockResolvedValue(RFP_UPLOAD_RATE_LIMIT_MAX + 1);
    const result = await checkRfpUploadRateLimit('org-1', { NODE_ENV: 'production' });
    expect(result).toEqual({ allowed: false, reason: 'limit' });
  });
});
