// The contacts list keeps its search box in component state. A URL query
// named `search` is ignored, so `/contacts?search=Michael%20Johnson` opens
// the unfiltered book. The palette has to address the contact record.
import { describe, expect, it } from 'vitest';

import { contactRecordPath } from './contact-record-path';

const MICHAEL = '00000000-0000-4000-8000-000000000001';

describe('contactRecordPath', () => {
  it('opens the demo contact on /contacts/:id, not a search the list ignores', () => {
    // WHY: Michael Johnson is a synthetic CI Financial contact. Choosing him
    // from the palette must land on his record. A name search is not an address.
    expect(contactRecordPath(MICHAEL)).toBe(`/contacts/${MICHAEL}`);
    expect(contactRecordPath(MICHAEL)).not.toContain('search=');
  });

  it('keeps a slash inside one path segment', () => {
    // WHY: the id is data. A raw slash would address a different route.
    expect(contactRecordPath('a/b')).toBe('/contacts/a%2Fb');
  });
});
