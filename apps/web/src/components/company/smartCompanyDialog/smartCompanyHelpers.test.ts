import { describe, expect, it } from 'vitest';

import {
  logoProxyPath,
  recordedConfidencePercent,
  recordedFill,
  resolveCompanyDraft,
} from './smartCompanyHelpers';

describe('recordedConfidencePercent', () => {
  it('does not turn a typed domain into a confidence score', () => {
    expect(recordedConfidencePercent(undefined)).toBeNull();
    expect(recordedConfidencePercent(null)).toBeNull();
    expect(recordedConfidencePercent(Number.NaN)).toBeNull();
  });

  it('shows a stored company confidence as a percent', () => {
    expect(recordedConfidencePercent(0.55)).toBe(55);
  });
});

describe('recordedFill', () => {
  it('fills the bar only when the field is actually recorded', () => {
    expect(recordedFill(true)).toBe(100);
    expect(recordedFill(false)).toBe(0);
  });
});

const preview = {
  name: 'Microsoft',
  legalName: 'Microsoft Corporation',
  domain: 'microsoft.com',
  website: 'https://www.microsoft.com/',
  description: 'American multinational technology corporation',
  headquarters: 'Redmond, United States',
  employeeCount: 228000,
  revenueLabel: '281.7 billion USD',
  industry: 'software industry',
};

describe('resolveCompanyDraft', () => {
  it('fills the official name, domain, and website from a public preview', () => {
    // WHY: typing a company name is the whole input. The seller should not
    // have to look up the domain before the logo and the account can exist.
    const draft = resolveCompanyDraft({
      typed: 'microsoft',
      domainTouched: false,
      websiteTouched: false,
      domainDraft: '',
      websiteDraft: '',
      company: null,
      preview,
    });
    expect(draft.name).toBe('Microsoft');
    expect(draft.domain).toBe('microsoft.com');
    expect(draft.website).toBe('https://www.microsoft.com/');
    expect(draft.employeeCount).toBe(228000);
  });

  it('keeps a domain the seller already edited', () => {
    const draft = resolveCompanyDraft({
      typed: 'microsoft',
      domainTouched: true,
      websiteTouched: true,
      domainDraft: 'example.test',
      websiteDraft: 'https://example.test/about',
      company: null,
      preview,
    });
    expect(draft.name).toBe('Microsoft');
    expect(draft.domain).toBe('example.test');
    expect(draft.website).toBe('https://example.test/about');
  });

  it('prefers the saved account over a public lookalike', () => {
    const draft = resolveCompanyDraft({
      typed: 'Mantu',
      domainTouched: false,
      websiteTouched: false,
      domainDraft: '',
      websiteDraft: '',
      company: {
        ...preview,
        name: 'Mantu',
        legalName: null,
        domain: 'mantu.com',
        website: 'https://mantu.com/',
      },
      preview,
    });
    expect(draft.name).toBe('Mantu');
    expect(draft.domain).toBe('mantu.com');
  });
});

describe('logoProxyPath', () => {
  it('points a real domain at the same-origin logo proxy', () => {
    expect(logoProxyPath('https://www.microsoft.com/')).toBe('/api/v1/logo?domain=microsoft.com');
  });

  it('does not request a logo for a reserved domain', () => {
    expect(logoProxyPath('example.com')).toBeNull();
  });
});
