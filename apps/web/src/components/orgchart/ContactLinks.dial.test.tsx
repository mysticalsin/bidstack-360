// The org chart reads a linked contact's phone when the node itself has none
// (apps/api/src/org-chart/access.ts). Demo contacts store that phone with
// spaces, including Klaus Vogt at Siemens ("+49 30 1234 5670"). A digit-only
// check drops the call, so the person looks like they have no phone.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ContactLinks, contactHrefs } from './ContactLinks';

const DEMO_PHONES: ReadonlyArray<readonly [string, string]> = [
  ['+49 30 1234 5670', 'tel:+493012345670'],
  ['+49 30 1234 5671', 'tel:+493012345671'],
  ['+46 8 555 0102', 'tel:+4685550102'],
  ['+33 1 4455 6677', 'tel:+33144556677'],
  ['+44 20 7946 0102', 'tel:+442079460102'],
  ['+33 4 7200 0100', 'tel:+33472000100'],
  ['+39 02 1234 567', 'tel:+39021234567'],
];

describe('org chart call link for a contact phone', () => {
  afterEach(() => cleanup());

  it('dials the digits of a demo contact phone and keeps the printed number', () => {
    for (const [printed, href] of DEMO_PHONES) {
      expect(contactHrefs({ email: null, phone: printed, linkedinUrl: null }).phone).toBe(href);
    }

    render(
      <ContactLinks
        node={{ name: 'Klaus Vogt', email: null, phone: '+49 30 1234 5670', linkedinUrl: null }}
      />,
    );
    const link = screen.getByRole('link', { name: '+49 30 1234 5670' });
    expect(link.getAttribute('href')).toBe('tel:+493012345670');
    expect(link.getAttribute('href')).not.toContain(' ');
  });

  it('leaves a fragment, a short number, or a missing phone as text', () => {
    expect(contactHrefs({ email: null, phone: 'ext 12', linkedinUrl: null }).phone).toBeNull();
    expect(contactHrefs({ email: null, phone: '12', linkedinUrl: null }).phone).toBeNull();
    expect(contactHrefs({ email: null, phone: '   ', linkedinUrl: null }).phone).toBeNull();
    expect(contactHrefs({ email: null, phone: null, linkedinUrl: null }).phone).toBeNull();
    expect(contactHrefs({ email: null, phone: 'javascript:alert(1)', linkedinUrl: null }).phone).toBeNull();

    render(<ContactLinks node={{ name: 'Klaus Vogt', email: null, phone: 'ext 12', linkedinUrl: null }} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
