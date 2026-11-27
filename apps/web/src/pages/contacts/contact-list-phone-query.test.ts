import { describe, expect, it } from 'vitest';

import { contactListPhoneQuery, contactPhoneMatches } from './contact-list-phone-query';

describe('contacts list phone query', () => {
  it('reads the spaced numbers the demo book prints', () => {
    // WHY: every seeded contact phone has spaces. The search box has to
    // recognize that printed form as one number, not as a name.
    expect(contactListPhoneQuery('+49 30 1234 5670')).toBe('493012345670');
    expect(contactListPhoneQuery('+49 30 1234 5671')).toBe('493012345671');
    expect(contactListPhoneQuery('+46 8 555 0102')).toBe('4685550102');
    expect(contactListPhoneQuery('+33 1 4455 6677')).toBe('33144556677');
    expect(contactListPhoneQuery('+44 20 7946 0102')).toBe('442079460102');
    expect(contactListPhoneQuery('+33 4 7200 0100')).toBe('33472000100');
    expect(contactListPhoneQuery('+39 02 1234 567')).toBe('39021234567');
    expect(contactListPhoneQuery('  +49 30 1234 5670  ')).toBe('493012345670');
  });

  it('leaves a name, a fragment, and a scheme as text search', () => {
    // WHY: "Siemens" is a customer. "12" is not Klaus Vogt's number.
    // A scheme must not become a phone lookup.
    for (const text of ['', 'Siemens', 'Klaus', '12', 'vogt@', 'ext 5670', 'javascript:alert(1)', '+12']) {
      expect(contactListPhoneQuery(text)).toBeNull();
    }
  });

  it('matches the printed phone and not a different number', () => {
    // WHY: +49 30 1234 5670 is Klaus. The next digit is Lena. A fragment
    // stored as text is not that number.
    expect(contactPhoneMatches('+49 30 1234 5670', '493012345670')).toBe(true);
    expect(contactPhoneMatches('  +49 30 1234 5670  ', '493012345670')).toBe(true);
    expect(contactPhoneMatches('+49 30 1234 5671', '493012345670')).toBe(false);
    expect(contactPhoneMatches('ext 5670', '493012345670')).toBe(false);
    expect(contactPhoneMatches(null, '493012345670')).toBe(false);
  });
});
