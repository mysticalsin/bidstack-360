import { describe, expect, it } from 'vitest';

import { keyContactCaption } from './key-contacts';

describe('key contact caption', () => {
  it('does not describe a full contact page as every linked contact', () => {
    // WHY: the key-contact card showed five names and the caption treated
    // that page as the people on the account. contactCount, or one name past
    // the page, means those rows are not every contact. A page that matches
    // the total keeps the old wording.
    expect(keyContactCaption(5, true)).toBe('5 in the latest 5, not every contact');
    expect(keyContactCaption(5, true)).not.toBe(
      'Up to 5 people linked to this account, highest recorded influence first.',
    );
    expect(keyContactCaption(2, true)).toMatch(/not every contact/i);
    expect(keyContactCaption(2, true)).not.toBe(
      'Up to 5 people linked to this account, highest recorded influence first.',
    );

    expect(keyContactCaption(5, false)).toBe(
      'Up to 5 people linked to this account, highest recorded influence first.',
    );
    expect(keyContactCaption(2, false)).toBe(
      'Up to 5 people linked to this account, highest recorded influence first.',
    );
    expect(keyContactCaption(1, false)).toBe(
      'Up to 5 people linked to this account, highest recorded influence first.',
    );
    expect(keyContactCaption(2, false)).not.toMatch(/not every/i);
  });
});
