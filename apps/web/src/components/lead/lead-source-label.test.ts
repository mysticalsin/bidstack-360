// Polar Foods is stored as cold_outreach. The words on the lead list and
// the record must match the new-lead form, including a translated catalog.
// A key the form does not offer stays as stored.
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { LeadSource } from '@bidstack/shared';

import { leadSourceLabel } from './lead-source-label';

function english(_key: string, fallback: string): string {
  return fallback;
}

describe('leadSourceLabel', () => {
  const t = english as unknown as TFunction;

  it('names cold_outreach Cold outreach, the new-lead words for Polar Foods', () => {
    let usedKey = '';
    const translate = ((key: string, fallback: string) => {
      usedKey = key;
      return fallback;
    }) as unknown as TFunction;

    expect(leadSourceLabel('cold_outreach', translate)).toBe('Cold outreach');
    expect(usedKey).toBe('newLead.sourceColdOutreach');
  });

  it('uses the translated catalog when the form has one', () => {
    const translate = ((key: string, fallback: string) =>
      key === 'newLead.sourceColdOutreach' ? 'Prospection à froid' : fallback) as unknown as TFunction;

    expect(leadSourceLabel('cold_outreach', translate)).toBe('Prospection à froid');
  });

  it('names every catalog source, and leaves an unknown key as stored', () => {
    expect(leadSourceLabel('website', t)).toBe('Website');
    expect(leadSourceLabel('referral', t)).toBe('Referral');
    expect(leadSourceLabel('event', t)).toBe('Event');
    expect(leadSourceLabel('partner', t)).toBe('Partner');
    expect(leadSourceLabel('social', t)).toBe('Social');
    expect(leadSourceLabel('other', t)).toBe('Other');
    expect(LeadSource.options).toHaveLength(7);
    expect(leadSourceLabel('zz_custom', t)).toBe('zz_custom');
    expect(leadSourceLabel('', t)).toBe('');
  });
});
