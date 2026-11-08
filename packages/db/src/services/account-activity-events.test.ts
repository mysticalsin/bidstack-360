import { afterEach, describe, expect, it } from 'vitest';

import {
  digestAccountActivity,
  onAccountActivityCreated,
  runAccountActivityBatch,
  subscribeAccountActivityDigest,
  type AccountActivityDigest,
} from './account-activity-events.js';

const ORG = 'org-1';
const offs: Array<() => void> = [];

function collect(): AccountActivityDigest[] {
  const seen: AccountActivityDigest[] = [];
  offs.push(
    subscribeAccountActivityDigest((d) => {
      seen.push(d);
    }),
  );
  return seen;
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('account activity digests', () => {
  it('emits a digest of one per item outside a batch', async () => {
    const seen = collect();
    await onAccountActivityCreated(ORG, 'co-1', 'a-1', 'u-1');
    expect(seen).toEqual([
      { orgId: ORG, companyId: 'co-1', activityIds: ['a-1'], actorUserId: 'u-1', excludeUserIds: ['u-1'] },
    ]);
  });

  it('holds items for the run and emits one digest per account at the end', async () => {
    const seen = collect();
    await runAccountActivityBatch(async () => {
      await onAccountActivityCreated(ORG, 'co-1', 'a-1', null, ['owner']);
      await onAccountActivityCreated(ORG, 'co-2', 'a-2', null, ['owner']);
      await onAccountActivityCreated(ORG, 'co-1', 'a-3', null, ['owner', 'colleague']);
      expect(seen).toEqual([]);
    });
    expect(seen).toEqual([
      { orgId: ORG, companyId: 'co-1', activityIds: ['a-1', 'a-3'], actorUserId: 'owner', excludeUserIds: ['owner', 'colleague'] },
      { orgId: ORG, companyId: 'co-2', activityIds: ['a-2'], actorUserId: 'owner', excludeUserIds: ['owner'] },
    ]);
  });

  it('still flushes what landed when the run throws, and nested runs join the outer one', async () => {
    const seen = collect();
    await expect(
      runAccountActivityBatch(async () => {
        await runAccountActivityBatch(async () => {
          await onAccountActivityCreated(ORG, 'co-1', 'a-1', null, ['owner']);
        });
        expect(seen).toEqual([]);
        await onAccountActivityCreated(ORG, 'co-1', 'a-2', null, ['owner']);
        throw new Error('provider down');
      }),
    ).rejects.toThrow('provider down');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.activityIds).toEqual(['a-1', 'a-2']);
  });

  it('names no actor when different people are behind the items, and excludes them all', () => {
    const [digest] = digestAccountActivity([
      { orgId: ORG, companyId: 'co-1', activityId: 'a-1', actorUserId: 'alice' },
      { orgId: ORG, companyId: 'co-1', activityId: 'a-2', actorUserId: null, involvedUserIds: ['bob'] },
    ]);
    expect(digest?.actorUserId).toBeNull();
    expect(digest?.excludeUserIds).toEqual(['alice', 'bob']);
  });

  it('keeps a failing digest subscriber from failing the run', async () => {
    offs.push(
      subscribeAccountActivityDigest(() => {
        throw new Error('queue down');
      }),
    );
    await expect(
      runAccountActivityBatch(async () => onAccountActivityCreated(ORG, 'co-1', 'a-1', null)),
    ).resolves.toBeUndefined();
  });
});
