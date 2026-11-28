import { describe, expect, it } from 'vitest';

import { contactDialHref, contactMailHref } from './contact-method-href';

describe('account contact mail and call targets', () => {
  it('keeps a full address as a mailto and drops a fragment', () => {
    // WHY: the roster prints klaus.vogt.demo@example.com. That is the mail
    // action. "vogt@" is not an address and must not become one.
    expect(contactMailHref('  klaus.vogt.demo@example.com  ')).toBe(
      'mailto:klaus.vogt.demo@example.com',
    );
    expect(contactMailHref('mjohnson@ci.com')).toBe('mailto:mjohnson@ci.com');
    for (const bad of [null, undefined, '', 'vogt@', 'vogt@example', 'not an email']) {
      expect(contactMailHref(bad)).toBeNull();
    }
  });

  it('dials the spaced demo phones and refuses a fragment', () => {
    // WHY: every seeded contact phone has spaces. Stripping them is the
    // call. "12" and a word are not phone numbers.
    expect(contactDialHref('+49 30 1234 5670')).toBe('tel:+493012345670');
    expect(contactDialHref('+1 416 555 0142')).toBe('tel:+14165550142');
    expect(contactDialHref('+39 02 1234 567')).toBe('tel:+39021234567');
    expect(contactDialHref('+46 8 555 0102')).toBe('tel:+4685550102');
    for (const bad of [null, undefined, '', '12', 'erased', 'javascript:alert(1)', '+12']) {
      expect(contactDialHref(bad)).toBeNull();
    }
  });
});
