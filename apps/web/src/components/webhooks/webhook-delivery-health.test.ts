import { describe, expect, it } from 'vitest';

import { webhookDeliveryHealth } from './webhook-delivery-health';

describe('webhookDeliveryHealth', () => {
  it('does not treat open retries as an empty window', () => {
    // WHY: the deliveries panel used a null success rate as "no messages".
    // A window of only retries has no settled rate and is not an empty book.
    expect(webhookDeliveryHealth({ succeeded: 0, failed: 0, pending: 3 })).toEqual({
      kind: 'retrying',
      pending: 3,
    });
  });

  it('keeps a window with no messages empty', () => {
    // WHY: a finished read with nothing delivered, failed, or retrying is a
    // real empty book. That is the only case that may say there is no activity.
    expect(webhookDeliveryHealth({ succeeded: 0, failed: 0, pending: 0 })).toEqual({
      kind: 'empty',
    });
  });

  it('keeps open retries on a settled rate', () => {
    // WHY: a settled success rate that drops the pending count reads as all
    // clear. The retries have to stay beside the settled failure count.
    expect(webhookDeliveryHealth({ succeeded: 1, failed: 0, pending: 2 })).toEqual({
      kind: 'settled',
      failed: 0,
      settled: 1,
      pending: 2,
    });
  });

  it('counts a settled failure without inventing retries', () => {
    // WHY: a window that has finished failing stays a settled count. Zero
    // pending must not grow a retry line.
    expect(webhookDeliveryHealth({ succeeded: 6, failed: 1, pending: 0 })).toEqual({
      kind: 'settled',
      failed: 1,
      settled: 7,
      pending: 0,
    });
  });
});
