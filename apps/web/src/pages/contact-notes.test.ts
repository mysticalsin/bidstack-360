import { describe, expect, it } from 'vitest';

import { contactNoteCaption } from './contact-notes';

describe('contact note page', () => {
  it('does not describe a full note page as every note', () => {
    // WHY: the contact page counted the loaded note page as every note on
    // the account. truncated means another note exists past the limit. A
    // shorter page is the whole match and keeps the old sentence.
    expect(contactNoteCaption(100, true)).toBe(
      '100 related in the latest 100 notes, not every note',
    );
    expect(contactNoteCaption(100, true)).not.toBe('100 related');
    expect(contactNoteCaption(2, true)).toMatch(/not every note/i);
    expect(contactNoteCaption(2, true)).not.toBe('2 related');

    expect(contactNoteCaption(2, false)).toBe('2 related');
    expect(contactNoteCaption(0, false)).toBe('0 related');
    expect(contactNoteCaption(1, false)).toBe('1 related');
    expect(contactNoteCaption(2, false)).not.toMatch(/not every/i);
  });
});
