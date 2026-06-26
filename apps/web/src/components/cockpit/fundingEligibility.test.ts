import { describe, expect, it } from 'vitest';

import type { TechnicalStackCategory } from '@bidstack/shared';

import { deriveFundingPrograms } from './fundingEligibility';

const cat = (label: string, ...names: string[]): TechnicalStackCategory => ({
  label,
  items: names.map((name) => ({ name, source: 'manual', confidence: 1 })),
});

describe('deriveFundingPrograms', () => {
  // WHY: a Microsoft shop must clearly surface ECIF as the headline funding lever.
  it('flags ECIF (primary) for a Microsoft stack', () => {
    const programs = deriveFundingPrograms([cat('Cloud', 'Azure', 'Microsoft 365'), cat('Data', 'Power BI')]);
    expect(programs[0]?.key).toBe('ecif');
    expect(programs[0]?.primary).toBe(true);
    expect(programs[0]?.matched).toEqual(expect.arrayContaining(['Azure', 'Microsoft 365', 'Power BI']));
  });

  it('detects AWS MAP and Google PSF, with ECIF ordered first when all present', () => {
    const programs = deriveFundingPrograms([cat('Cloud', 'AWS', 'Google Cloud', 'Azure')]);
    expect(programs.map((p) => p.key)).toEqual(['ecif', 'aws-map', 'gcp-psf']);
  });

  it('returns nothing for a stack with no funding-vendor signal', () => {
    expect(deriveFundingPrograms([cat('Security', 'Okta', 'CrowdStrike'), cat('Cloud', 'VMware')])).toEqual([]);
  });
});
