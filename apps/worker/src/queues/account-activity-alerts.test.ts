import type pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { onAccountActivityCreated, runAccountActivityBatch } from '@bidstack/db';

import { relayAccountActivityDigests } from './account-activity-alerts.js';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as pino.Logger;
const offs: Array<() => void> = [];

afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.clearAllMocks();
});

describe('account activity alert relay', () => {
  it('queues one job per account for a whole sync run', async () => {
    const add = vi.fn(async () => 'job');
    offs.push(relayAccountActivityDigests(add, log));
    await runAccountActivityBatch(async () => {
      await onAccountActivityCreated('org', 'co-1', 'a-1', null, ['owner']);
      await onAccountActivityCreated('org', 'co-1', 'a-2', null, ['owner', 'colleague']);
      await onAccountActivityCreated('org', 'co-2', 'a-3', null, ['owner']);
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenNthCalledWith(1, {
      orgId: 'org',
      companyId: 'co-1',
      activityIds: ['a-1', 'a-2'],
      actorUserId: 'owner',
      excludeUserIds: ['owner', 'colleague'],
    });
  });

  it('a queue outage is logged and never fails the sync', async () => {
    const add = vi.fn(async () => {
      throw new Error('redis down');
    });
    offs.push(relayAccountActivityDigests(add, log));
    await expect(
      runAccountActivityBatch(async () => onAccountActivityCreated('org', 'co-1', 'a-1', null, ['owner'])),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
