// The cockpit key-contact link is the contact id. The displayed name is
// never written into the address.
import { describe, expect, it } from 'vitest';

import { keyContactHref } from './key-contact-href';

const MICHAEL = '00000000-0000-4000-8000-000000000001';

describe('key contact href', () => {
  it('opens the contact page for a contact id', () => {
    // WHY: the account cockpit already stores the person. That id is the record.
    expect(keyContactHref(MICHAEL)).toBe(`/contacts/${MICHAEL}`);
    expect(keyContactHref(MICHAEL.toUpperCase())).toBe(`/contacts/${MICHAEL.toUpperCase()}`);
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A row without a real contact id has no page to open.
    expect(keyContactHref('Michael Johnson')).toBeNull();
    expect(keyContactHref('CI Financial')).toBeNull();
    expect(keyContactHref('p2')).toBeNull();
    expect(keyContactHref('javascript:alert(1)')).toBeNull();
    expect(keyContactHref('../admin')).toBeNull();
    expect(keyContactHref('https://evil.example/phish')).toBeNull();
    expect(keyContactHref(`${MICHAEL}/extra`)).toBeNull();
    expect(keyContactHref(` ${MICHAEL}`)).toBeNull();
    expect(keyContactHref('')).toBeNull();
    expect(keyContactHref(null)).toBeNull();
    expect(keyContactHref(undefined)).toBeNull();
  });
});
