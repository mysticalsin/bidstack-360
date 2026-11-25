import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { searchNoteSubtitle } from './search-note-subtitle.js';

const MAHLE_BODY =
  'Akkodis was slow to ramp up the validation team. Our engineers delivered faster than Akkodis on the thermal test bench.';

const ACCOUNT_ID = '4ef00000-0000-4000-8000-0000000000aa';

describe('searchNoteSubtitle', () => {
  it('puts the matching sentence on the line under a demo note, not the account id', () => {
    // WHY: a search for "thermal" finds "Sample: MAHLE test bench review" because
    // the sentence is in the body. The row used the account id as the line under
    // the title, so the hit did not show the words that matched.
    const line = searchNoteSubtitle(MAHLE_BODY, 'thermal', ACCOUNT_ID);
    expect(line.toLowerCase()).toContain('thermal');
    expect(line.indexOf('thermal')).toBeLessThan(48);
    expect(line).not.toContain(ACCOUNT_ID);
    expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('keeps a blank body blank instead of printing the account id', () => {
    // WHY: a title-only note has no sentence to show. The id is not a subtitle.
    expect(searchNoteSubtitle('   ', 'MAHLE', ACCOUNT_ID)).toBe('');
    expect(searchNoteSubtitle(null, 'MAHLE', ACCOUNT_ID)).toBe('');
  });

  it('wires the search route to that line', () => {
    const apiSrc = readFileSync(path.resolve(process.cwd(), 'src/routes/search.ts'), 'utf8');
    const noteBlock = apiSrc.slice(apiSrc.indexOf("requestedTypes.includes('note')"));
    expect(noteBlock).toMatch(/subtitle:\s*searchNoteSubtitle\(n\.bodyMd,\s*q,\s*n\.accountId\)/);
    expect(noteBlock).not.toMatch(/subtitle:\s*n\.accountId/);
  });
});
