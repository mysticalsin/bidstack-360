import { describe, expect, it } from 'vitest';

import { contactListDialHref } from './contact-list-dial';

describe('contacts list dial target', () => {
  it('dials the spaced phones the demo book prints', () => {
    // WHY: every seeded contact phone has spaces. The row has to call the
    // digits. The printed form stays on the cell.
    expect(contactListDialHref('+49 30 1234 5670')).toBe('tel:+493012345670');
    expect(contactListDialHref('+49 30 1234 5671')).toBe('tel:+493012345671');
    expect(contactListDialHref('+46 8 555 0102')).toBe('tel:+4685550102');
    expect(contactListDialHref('+33 1 4455 6677')).toBe('tel:+33144556677');
    expect(contactListDialHref('+44 20 7946 0102')).toBe('tel:+442079460102');
    expect(contactListDialHref('+33 4 7200 0100')).toBe('tel:+33472000100');
    expect(contactListDialHref('+39 02 1234 567')).toBe('tel:+39021234567');
    expect(contactListDialHref('  +49 30 1234 5670  ')).toBe('tel:+493012345670');
  });

  it('does not dial a fragment, a word, or a scheme', () => {
    // WHY: "12" is not Klaus Vogt's number. A scheme must not become a link.
    for (const bad of [null, undefined, '', '12', 'erased', 'javascript:alert(1)', '+12', 'ext 5670']) {
      expect(contactListDialHref(bad)).toBeNull();
    }
  });
});
