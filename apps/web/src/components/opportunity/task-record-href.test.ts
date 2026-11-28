// The deal Tasks tab opens a follow-up only through the task id. The title
// is not an address: a search on it can match a different follow-up.
import { describe, expect, it } from 'vitest';

import { taskRecordHref } from './task-record-href';

const PRICING = '00000000-0000-4000-8000-000000010001';

describe('deal task record href', () => {
  it('opens the follow-up page for a task id', () => {
    // WHY: the deal already stores the follow-up. That id is the record.
    expect(taskRecordHref(PRICING)).toBe(`/tasks/${PRICING}`);
    expect(taskRecordHref(PRICING.toUpperCase())).toBe(`/tasks/${PRICING.toUpperCase()}`);
  });

  it('refuses a title, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A row without a real task id has no page to open.
    expect(taskRecordHref('Submit revised pricing & SoW v2')).toBeNull();
    expect(taskRecordHref('javascript:alert(1)')).toBeNull();
    expect(taskRecordHref('../admin')).toBeNull();
    expect(taskRecordHref('https://evil.example/phish')).toBeNull();
    expect(taskRecordHref(`${PRICING}/extra`)).toBeNull();
    expect(taskRecordHref(` ${PRICING}`)).toBeNull();
    expect(taskRecordHref('')).toBeNull();
    expect(taskRecordHref(null)).toBeNull();
    expect(taskRecordHref(undefined)).toBeNull();
  });
});
