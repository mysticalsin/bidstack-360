import { describe, expect, it } from 'vitest';

import { renewalDaysOut, renewalTrigger } from './index.js';

describe('renewalDaysOut', () => {
  it('keeps a renewal 30 UTC days out in the 30-day bucket in the afternoon', () => {
    // WHY: ceil of the clock turned 30 days plus a few hours into 31, and the
    // nightly job opened the 60-day renewal instead of the 30-day one.
    const now = Date.parse('2026-11-01T15:00:00.000Z');
    const renewal = new Date('2026-12-01T18:00:00.000Z');
    expect(renewalDaysOut(renewal, now)).toBe(30);
    expect(renewalTrigger(renewalDaysOut(renewal, now))).toBe(30);
  });

  it('counts today as the 30-day bucket and day 90 as the 90-day bucket', () => {
    // WHY: the window is calendar dates. A renewal earlier today is still today,
    // and a renewal on the 90th UTC date is still inside the 90-day bucket.
    const now = Date.parse('2026-11-01T15:00:00.000Z');
    expect(renewalDaysOut(new Date('2026-11-01T08:00:00.000Z'), now)).toBe(0);
    expect(renewalTrigger(0)).toBe(30);
    expect(renewalDaysOut(new Date('2027-01-30T23:00:00.000Z'), now)).toBe(90);
    expect(renewalTrigger(90)).toBe(90);
    expect(renewalTrigger(91)).toBeNull();
    expect(renewalTrigger(60)).toBe(60);
    expect(renewalTrigger(61)).toBe(90);
  });
});
