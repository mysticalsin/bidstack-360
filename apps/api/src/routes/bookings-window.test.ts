/**
 * WHY: Public availability anchors the requested day at noon UTC, but
 * computeSlots still emits morning slots. The blocker query has to include
 * those hours. If it starts at the anchor, a confirmed 09:00 booking stays
 * on the page and the create call rejects it.
 */
import { describe, expect, it } from 'vitest';
import { blockingLookupBounds } from './bookings.helpers.js';

describe('blockingLookupBounds', () => {
  it('includes a morning booking when the day anchor is noon UTC', () => {
    const rangeStart = new Date('2026-11-24T12:00:00.000Z');
    const rangeEnd = new Date('2026-11-24T23:59:59.000Z');
    const { fetchStart, fetchEnd } = blockingLookupBounds(rangeStart, rangeEnd, 0);
    const bookedStart = new Date('2026-11-24T09:00:00.000Z');
    const bookedEnd = new Date('2026-11-24T09:30:00.000Z');

    const overlapsLookup = bookedStart <= fetchEnd && bookedEnd >= fetchStart;
    expect(overlapsLookup).toBe(true);
  });
});
