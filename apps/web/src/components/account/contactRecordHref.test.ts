// The relationship-map link is the contact id. The displayed name is never
// written into the address.
import { describe, expect, it } from 'vitest';

import { contactRecordHref } from './contactRecordHref';

const ADA = '11111111-1111-4111-8111-111111111111';

describe('relationship map contact href', () => {
  it('opens the contact page for a contact id', () => {
    // WHY: the map already stores the person. That id is the record.
    expect(contactRecordHref(ADA)).toBe(`/contacts/${ADA}`);
    expect(contactRecordHref(ADA.toUpperCase())).toBe(`/contacts/${ADA.toUpperCase()}`);
  });

  it('refuses a name, a script, a path, and a blank', () => {
    // WHY: those values would send the click to a search, another site, or a
    // script. A node without a real contact id has no page to open.
    expect(contactRecordHref('Ada North')).toBeNull();
    expect(contactRecordHref('Globex Labs')).toBeNull();
    expect(contactRecordHref('javascript:alert(1)')).toBeNull();
    expect(contactRecordHref('../admin')).toBeNull();
    expect(contactRecordHref('https://evil.example/phish')).toBeNull();
    expect(contactRecordHref(`${ADA}/extra`)).toBeNull();
    expect(contactRecordHref(` ${ADA}`)).toBeNull();
    expect(contactRecordHref('')).toBeNull();
    expect(contactRecordHref(null)).toBeNull();
    expect(contactRecordHref(undefined)).toBeNull();
  });
});
