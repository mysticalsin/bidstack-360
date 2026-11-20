import { afterEach, describe, expect, it, vi } from 'vitest';

import { onAccountActivityCreated, runAccountActivityBatch } from '@bidstack/db';

import { relayAccountActivityDigests } from './account-activity-alerts.js';

const log = { warn: vi.fn() };
const offs: Array<() => void> = [];

afterEach(() => {
  for (const off of offs.splice(0)) off();
  vi.clearAllMocks();
});

describe('MCP account activity alert relay', () => {
  it('queues one job per account for one ingest call', async () => {
    const add = vi.fn(async () => 'job');
    offs.push(relayAccountActivityDigests(add, log));
    await runAccountActivityBatch(async () => {
      await onAccountActivityCreated('org', 'co-1', 'a-1', null);
      await onAccountActivityCreated('org', 'co-1', 'a-2', null);
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith({
      orgId: 'org',
      companyId: 'co-1',
      activityIds: ['a-1', 'a-2'],
      actorUserId: null,
      excludeUserIds: [],
    });
  });

  it('a queue outage is logged and never fails the tool call', async () => {
    offs.push(
      relayAccountActivityDigests(async () => {
        throw new Error('redis down');
      }, log),
    );
    await onAccountActivityCreated('org', 'co-1', 'a-1', null);
    expect(log.warn).toHaveBeenCalled();
  });
});
