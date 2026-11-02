import { describe, expect, it } from 'vitest';

import { opportunityNoteCaption } from './opportunity-notes';

describe('opportunity note caption', () => {
  it('does not describe a full note page as every note', () => {
    // WHY: the opportunity brief quoted five account notes and stopped. That
    // page is not every note when the route read one more and dropped it.
    // A shorter page is the whole match and keeps the old brief, with no
    // extra caption.
    expect(opportunityNoteCaption(5, true)).toBe('5 in the latest 5, not every note');
    expect(opportunityNoteCaption(5, true)).not.toBe('');
    expect(opportunityNoteCaption(5, true)).not.toBe('5 notes');
    expect(opportunityNoteCaption(2, true)).toMatch(/not every note/i);
    expect(opportunityNoteCaption(2, true)).not.toBe('');

    expect(opportunityNoteCaption(2, false)).toBe('');
    expect(opportunityNoteCaption(0, false)).toBe('');
    expect(opportunityNoteCaption(1, false)).toBe('');
    expect(opportunityNoteCaption(5, false)).toBe('');
    expect(opportunityNoteCaption(2, false)).not.toMatch(/not every/i);
  });
});
