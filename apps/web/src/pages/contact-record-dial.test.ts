import { describe, expect, it } from 'vitest';

import { contactRecordDialHref } from './contact-record-dial';

describe('contactRecordDialHref', () => {
  it('dials the spaced phones the demo book stores', () => {
    // Klaus Vogt, Michael Johnson, and Giulia Ferrari are printed with spaces.
    // The record has to dial the digits and keep the printed form for the label.
    expect(contactRecordDialHref('+49 30 1234 5670')).toBe('tel:+493012345670');
    expect(contactRecordDialHref('+1 416 555 0142')).toBe('tel:+14165550142');
    expect(contactRecordDialHref('+39 02 1234 567')).toBe('tel:+39021234567');
    expect(contactRecordDialHref('  +46 8 555 0102  ')).toBe('tel:+4685550102');
  });

  it('leaves a fragment, a word, a scheme, and a blank as text', () => {
    // Those values are not numbers. Turning them into tel: would dial the wrong thing.
    expect(contactRecordDialHref('ext 12')).toBeNull();
    expect(contactRecordDialHref('n/a')).toBeNull();
    expect(contactRecordDialHref('tel:+493012345670')).toBeNull();
    expect(contactRecordDialHref('+123')).toBeNull();
    expect(contactRecordDialHref('+1234567890123456')).toBeNull();
    expect(contactRecordDialHref(null)).toBeNull();
    expect(contactRecordDialHref(undefined)).toBeNull();
    expect(contactRecordDialHref('')).toBeNull();
    expect(contactRecordDialHref('   ')).toBeNull();
  });
});
