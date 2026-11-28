// The relationship-map link is the contact id. The displayed name is never
// written into the address.
import { describe, expect, it } from 'vitest';

import { relationshipPersonHref } from './relationship-person-href';

const MICHAEL = '11111111-1111-4111-8111-111111111111';

describe('relationship person href', () => {
  it('opens the contact page for a contact id', () => {
    // WHY: the account cockpit already stores the person. That id is the record.
    expect(relationshipPersonHref(MICHAEL)).toBe(`/contacts/${MICHAEL}`);
    expect(relationshipPersonHref(MICHAEL.toUpperCase())).toBe(`/contacts/${MICHAEL.toUpperCase()}`);
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A node without a real contact id has no page to open.
    expect(relationshipPersonHref('Michael Johnson')).toBeNull();
    expect(relationshipPersonHref('CI Financial')).toBeNull();
    expect(relationshipPersonHref('javascript:alert(1)')).toBeNull();
    expect(relationshipPersonHref('../admin')).toBeNull();
    expect(relationshipPersonHref('https://evil.example/phish')).toBeNull();
    expect(relationshipPersonHref(`${MICHAEL}/extra`)).toBeNull();
    expect(relationshipPersonHref(` ${MICHAEL}`)).toBeNull();
    expect(relationshipPersonHref('')).toBeNull();
    expect(relationshipPersonHref(null)).toBeNull();
    expect(relationshipPersonHref(undefined)).toBeNull();
  });
});
