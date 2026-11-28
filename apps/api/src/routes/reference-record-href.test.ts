// Workspace search opened a case study at /references?search=<title>. The
// library reads `q`, not `search`, so "CI Financial — Core banking platform
// modernization" lands on the whole library. The case study opens as the
// expanded row. A title can match a different case study. The id is the
// record, and the title is not an address.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { referenceRecordHref } from './reference-record-href.js';

const CORE_BANKING = '4ef00000-0000-4000-8000-000000000001';

describe('workspace search reference href', () => {
  it('opens the demo case study on its row and never puts the title in the address', () => {
    // WHY: a title search is a contains match, and this page does not read
    // `search`. The seeded CI Financial case study already has an id. Opening
    // that id expands the row. A title, a path, or a blank must not become a URL.
    expect(referenceRecordHref(CORE_BANKING)).toBe(`/references?expand=${CORE_BANKING}`);
    expect(referenceRecordHref(CORE_BANKING)).not.toContain('search=');
    expect(referenceRecordHref('CI Financial — Core banking platform modernization')).toBeNull();
    expect(referenceRecordHref('../admin')).toBeNull();
    expect(referenceRecordHref('javascript:alert(1)')).toBeNull();
    expect(referenceRecordHref('')).toBeNull();
    expect(referenceRecordHref('   ')).toBeNull();
    expect(referenceRecordHref(null)).toBeNull();
    expect(referenceRecordHref(undefined)).toBeNull();
  });

  it('the search route uses that href for a reference', () => {
    // WHY: /references?search=<title> does not open the case study. The
    // library ignores `search` and reads `q` plus `expand`.
    const src = readFileSync(new URL('./search.ts', import.meta.url), 'utf8');
    expect(src).toContain('referenceRecordHref(r.id)');
    expect(src).not.toContain('/references?search=');
  });
});
