// A contact's follow-up opens its record only through the task id. The title
// is not an address: a search on it can match a different follow-up.
import { describe, expect, it } from 'vitest';

import { contactTaskHref } from './contact-task-href';

const PRICING = '00000000-0000-4000-8000-000000010001';

describe('contact follow-up href', () => {
  it('opens the follow-up page for a task id', () => {
    // WHY: the contact already lists this follow-up. That id is the record.
    expect(contactTaskHref(PRICING)).toBe(`/tasks/${PRICING}`);
    expect(contactTaskHref(PRICING.toUpperCase())).toBe(`/tasks/${PRICING.toUpperCase()}`);
  });

  it('refuses a title, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A row without a real task id has no page to open.
    expect(contactTaskHref('Submit revised pricing & SoW v2')).toBeNull();
    expect(contactTaskHref('javascript:alert(1)')).toBeNull();
    expect(contactTaskHref('../admin')).toBeNull();
    expect(contactTaskHref('https://evil.example/phish')).toBeNull();
    expect(contactTaskHref(`${PRICING}/extra`)).toBeNull();
    expect(contactTaskHref(` ${PRICING}`)).toBeNull();
    expect(contactTaskHref('')).toBeNull();
    expect(contactTaskHref(null)).toBeNull();
    expect(contactTaskHref(undefined)).toBeNull();
  });
});
