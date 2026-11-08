import { describe, expect, it } from 'vitest';

import {
  compareWebhookMessageTime,
  decodeWebhookMessageCursor,
  encodeWebhookMessageCursor,
} from './webhook-message-cursor.js';

const LATER = '2026-11-08T12:00:00.123789Z';
const EARLIER = '2026-11-08T12:00:00.123456Z';
const LATER_ID = '00000000-0000-4000-8000-0000000000b2';

describe('webhook message cursor', () => {
  it('keeps microseconds so a same-millisecond row stays on the next page', () => {
    // Date.toISOString() would store .123Z. The earlier row (.123456) is then
    // neither older than nor equal to that truncated cursor, so the page skips it.
    const decoded = decodeWebhookMessageCursor(encodeWebhookMessageCursor(LATER, LATER_ID));
    expect(decoded).toEqual({ createdAt: LATER, id: LATER_ID });
    expect(new Date(LATER).toISOString()).toBe('2026-11-08T12:00:00.123Z');
    expect(compareWebhookMessageTime(EARLIER, decoded!.createdAt)).toBeLessThan(0);
    expect(compareWebhookMessageTime(EARLIER, new Date(LATER).toISOString())).toBeGreaterThan(0);
  });

  it('still accepts a millisecond cursor from an older client', () => {
    const iso = '2026-11-08T12:00:00.123Z';
    const id = '00000000-0000-4000-8000-0000000000a1';
    expect(decodeWebhookMessageCursor(encodeWebhookMessageCursor(iso, id))).toEqual({ createdAt: iso, id });
  });

  it('rejects a cursor that is not a timestamp and an id', () => {
    expect(decodeWebhookMessageCursor('not-a-cursor')).toBeNull();
  });
});
