import { describe, expect, it } from 'vitest';

import { webhookDeliveryStatusCopy } from './webhook-delivery-status';

describe('webhookDeliveryStatusCopy', () => {
  it('does not name a missing HTTP status a timeout', () => {
    // WHY: the history cell used a null statusCode as "timeout". Unsafe URLs,
    // policy denials, and dropped connections store the same null. None of
    // those is a receiver-budget timeout.
    expect(webhookDeliveryStatusCopy(null)).toEqual({ kind: 'no-response' });
  });

  it('keeps a real HTTP status as that code', () => {
    // WHY: a 404 is a response. The history row must still show 404, and a
    // 204 must not become "No response".
    expect(webhookDeliveryStatusCopy(404)).toEqual({ kind: 'http', statusCode: 404 });
    expect(webhookDeliveryStatusCopy(204)).toEqual({ kind: 'http', statusCode: 204 });
  });
});
