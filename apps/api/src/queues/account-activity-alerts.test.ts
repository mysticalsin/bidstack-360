import { beforeEach, describe, expect, it, vi } from 'vitest';

const emit = vi.hoisted(() => vi.fn());
vi.mock('../services/account-events.service.js', () => ({ emitActivitiesAccountEvents: emit }));

import { handleAccountActivityAlertJob } from './account-activity-alerts.js';

beforeEach(() => {
  emit.mockReset();
  emit.mockResolvedValue(undefined);
});

describe('account-activity-alerts consumer', () => {
  it('sends one digest through the account events service with its exclusions', async () => {
    await handleAccountActivityAlertJob({
      orgId: 'org',
      companyId: 'c1',
      activityIds: ['a1', 'a2'],
      actorUserId: 'owner',
      excludeUserIds: ['owner', 'colleague'],
    });
    expect(emit).toHaveBeenCalledWith({
      orgId: 'org',
      activityIds: ['a1', 'a2'],
      actorUserId: 'owner',
      excludeUserIds: ['owner', 'colleague'],
    });
  });

  it('ignores an empty or malformed job', async () => {
    await handleAccountActivityAlertJob({
      orgId: 'org',
      companyId: 'c1',
      activityIds: [],
      actorUserId: null,
      excludeUserIds: [],
    });
    await handleAccountActivityAlertJob({ orgId: 'org' } as never);
    expect(emit).not.toHaveBeenCalled();
  });

  it('lets a failure surface so BullMQ retries the job', async () => {
    emit.mockRejectedValueOnce(new Error('db down'));
    await expect(
      handleAccountActivityAlertJob({
        orgId: 'org',
        companyId: 'c1',
        activityIds: ['a1'],
        actorUserId: null,
        excludeUserIds: [],
      }),
    ).rejects.toThrow('db down');
  });
});
