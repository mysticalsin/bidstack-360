import { describe, expect, it } from 'vitest';

import { companyNoteTabLabel } from './company-notes';

describe('company note tab', () => {
  it('does not describe a full note page as every note', () => {
    // WHY: company detail counted the loaded note page as every note on the
    // company. notesTruncated means another note exists past the limit. A
    // shorter page is the whole match and keeps the old tab label.
    expect(companyNoteTabLabel(20, true)).toBe('Notes (20 in the latest 20, not every note)');
    expect(companyNoteTabLabel(20, true)).not.toBe('Notes (20)');
    expect(companyNoteTabLabel(2, true)).toMatch(/not every note/i);
    expect(companyNoteTabLabel(2, true)).not.toBe('Notes (2)');

    expect(companyNoteTabLabel(2, false)).toBe('Notes (2)');
    expect(companyNoteTabLabel(0, false)).toBe('Notes (0)');
    expect(companyNoteTabLabel(1, false)).toBe('Notes (1)');
    expect(companyNoteTabLabel(20, false)).toBe('Notes (20)');
    expect(companyNoteTabLabel(2, false)).not.toMatch(/not every/i);
  });
});
