import { describe, expect, it } from 'vitest';

import {
  PAGE_LEVERAGE_UNREAD,
  SAMPLE_LEVERAGE_UNREAD,
  leverageFilterHold,
} from './leverage-filter-read';

// WHY: The Under-leveraged filter on /agreements runs on rows already in
// hand. The Sample stand-in never ran the leverage read. A page that
// continues has not loaded later agreements. Neither result is a settled
// zero, so the copy must not say 0, none, or empty. A finished page with
// no flag stays unset here so the library can keep its real empty sentence.
// Reference NW-61520 is an agreement id, not a euro amount (#804).

const BANNED = /\b0\b|none|empty|no agreements|€|EUR|euros|[\u2014\u2013]/i;

describe('agreements leverage filter hold', () => {
  it('does not call a Sample stand-in a settled zero', () => {
    expect(leverageFilterHold({
      leverageOn: true,
      matchCount: 0,
      pageContinues: false,
      sample: true,
    })).toBe(SAMPLE_LEVERAGE_UNREAD);
    expect(SAMPLE_LEVERAGE_UNREAD).not.toMatch(BANNED);
  });

  it('prefers the Sample hold when the stand-in also continues', () => {
    // The Sample rows were never annotated. "Past this page" would still
    // pretend a leverage read had started.
    expect(leverageFilterHold({
      leverageOn: true,
      matchCount: 0,
      pageContinues: true,
      sample: true,
    })).toBe(SAMPLE_LEVERAGE_UNREAD);
  });

  it('does not call an unfinished page a settled zero', () => {
    expect(leverageFilterHold({
      leverageOn: true,
      matchCount: 0,
      pageContinues: true,
      sample: false,
    })).toBe(PAGE_LEVERAGE_UNREAD);
    expect(PAGE_LEVERAGE_UNREAD).not.toMatch(BANNED);
  });

  it('leaves a finished page with no flag as a real empty result', () => {
    expect(leverageFilterHold({
      leverageOn: true,
      matchCount: 0,
      pageContinues: false,
      sample: false,
    })).toBeNull();
  });

  it('leaves a loaded flag alone, including one the page has not finished', () => {
    expect(leverageFilterHold({
      leverageOn: true,
      matchCount: 1,
      pageContinues: true,
      sample: false,
    })).toBeNull();
    expect(leverageFilterHold({
      leverageOn: false,
      matchCount: 0,
      pageContinues: true,
      sample: true,
    })).toBeNull();
  });
});
