import { describe, it, expect } from 'vitest';

import { fallbackExtract } from './rfp-requirement-extract.helpers.js';

// fallbackExtract is the deterministic no-LLM path. These tests pin the
// behaviour that real RFPs (numbered / bulleted requirements) actually extract —
// the regression that previously yielded ZERO requirements for any numbered doc.
describe('fallbackExtract', () => {
  it('extracts numbered requirements with the leading marker stripped', () => {
    const text = [
      'RFP: Cloud Migration & Managed Services',
      '',
      '1. The vendor must provide 24/7 support with a one-hour response SLA.',
      '2. The solution shall comply with ISO 27001 and SOC 2 Type II controls.',
      '3. The system must support single sign-on via SAML 2.0 provisioning.',
    ].join('\n');

    const out = fallbackExtract(text);

    expect(out).toHaveLength(3);
    expect(out[0]?.text).toBe('The vendor must provide 24/7 support with a one-hour response SLA.');
    expect(out[0]?.externalRef).toBe('REQ-0001');
    expect(out[2]?.text).toBe('The system must support single sign-on via SAML 2.0 provisioning.');
  });

  it('extracts bulleted requirements', () => {
    const text = [
      '- The supplier shall encrypt all data at rest and in transit.',
      '* Bidder must provide a fixed-price commercial model with no hidden fees.',
      '• The contractor is responsible for end-user training and documentation.',
    ].join('\n');

    const out = fallbackExtract(text);

    expect(out).toHaveLength(3);
    expect(out[0]?.text).toBe('The supplier shall encrypt all data at rest and in transit.');
  });

  it('skips prose without an obligation and lines that are too short', () => {
    const text = [
      'This section describes the background and context of the project.',
      'Hello.',
      'The vendor must deliver a detailed migration plan within two weeks of award.',
    ].join('\n');

    const out = fallbackExtract(text);

    expect(out).toHaveLength(1);
    expect(out[0]?.text).toContain('migration plan');
  });

  it('de-duplicates repeated lines (e.g. page headers/footers)', () => {
    const line = 'The system must retain an immutable audit log of every user action.';
    expect(fallbackExtract([line, line, line].join('\n'))).toHaveLength(1);
  });

  it('caps the result at 50 requirements', () => {
    const many = Array.from(
      { length: 80 },
      (_, i) => `The system must support configurable feature number ${i} for all users.`,
    ).join('\n');
    expect(fallbackExtract(many)).toHaveLength(50);
  });
});
