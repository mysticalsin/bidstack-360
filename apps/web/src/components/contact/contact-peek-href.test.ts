import { describe, expect, it } from 'vitest';

import {
  contactPeekDialHref,
  contactPeekMailHref,
  contactPeekRecordPath,
} from './contact-peek-href';

describe('contact quick look reach targets', () => {
  it('opens only a contact id', () => {
    // WHY: the peek's name is the way onto the record. A scheme or a
    // relative path is not an id and must not become a route.
    expect(contactPeekRecordPath('00000000-0000-4000-8000-000000000001')).toBe(
      '/contacts/00000000-0000-4000-8000-000000000001',
    );
    expect(contactPeekRecordPath('00000000-0000-4000-8000-000000000021')).toBe(
      '/contacts/00000000-0000-4000-8000-000000000021',
    );
    for (const bad of [
      '',
      'not-a-contact',
      '../contacts',
      'javascript:alert(1)',
      'http://example.com',
    ]) {
      expect(contactPeekRecordPath(bad)).toBeNull();
    }
  });

  it('keeps a full address as a mailto and drops a fragment', () => {
    // WHY: the peek prints mjohnson@ci.com. That is the mail action.
    // "vogt@" is not an address and must not become one.
    expect(contactPeekMailHref('  mjohnson@ci.com  ')).toBe('mailto:mjohnson@ci.com');
    expect(contactPeekMailHref('klaus.vogt.demo@example.com')).toBe(
      'mailto:klaus.vogt.demo@example.com',
    );
    for (const bad of [
      null,
      undefined,
      '',
      'vogt@',
      'vogt@example',
      'not an email',
      'javascript:alert(1)',
    ]) {
      expect(contactPeekMailHref(bad)).toBeNull();
    }
  });

  it('dials the spaced demo phones and refuses a fragment', () => {
    // WHY: every seeded contact phone has spaces. Stripping them is the
    // call. "12" and a word are not phone numbers.
    expect(contactPeekDialHref('+1 416 555 0142')).toBe('tel:+14165550142');
    expect(contactPeekDialHref('+49 30 1234 5670')).toBe('tel:+493012345670');
    expect(contactPeekDialHref('+46 8 555 0102')).toBe('tel:+4685550102');
    expect(contactPeekDialHref('+39 02 1234 567')).toBe('tel:+39021234567');
    expect(contactPeekDialHref('+33 1 55 00 0100')).toBe('tel:+33155000100');
    for (const bad of [null, undefined, '', '12', 'erased', 'javascript:alert(1)', '+12']) {
      expect(contactPeekDialHref(bad)).toBeNull();
    }
  });
});
