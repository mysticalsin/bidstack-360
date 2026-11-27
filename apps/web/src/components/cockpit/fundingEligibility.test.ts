import { describe, expect, it } from 'vitest';

import type { TechnicalStackCategory } from '@bidstack/shared';

import { deriveFundingPrograms, fundingRead } from './fundingEligibility';

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

  it('does not treat a demo sample Microsoft or Google stack as co-funding', () => {
    // WHY: seeded accounts such as DNB Bank and MAPFRE store Microsoft 365 and
    // Google Workspace with sample: true. Those rows are fixtures. Recommending
    // ECIF or Google PSF from them tells a bid lead the vendor will co-fund a
    // deal the stack never observed.
    const dnb = sampleCat('Collaboration', 'Microsoft 365', 'Microsoft Azure');
    const mapfre = sampleCat('Collaboration', 'Google Workspace');
    expect(deriveFundingPrograms([dnb])).toEqual([]);
    expect(deriveFundingPrograms([mapfre])).toEqual([]);
    expect(fundingRead([dnb, mapfre])).toEqual({ kind: 'sample' });
  });

  it('keeps a recorded Azure when the Microsoft 365 beside it is only a sample', () => {
    const programs = deriveFundingPrograms([
      {
        label: 'Cloud',
        items: [
          { name: 'Azure', source: 'open_data:dns', confidence: 0.9, sample: false },
          { name: 'Microsoft 365', source: 'open_data:dns', confidence: 0.95, sample: true },
        ],
      },
    ]);
    expect(programs.map((program) => program.key)).toEqual(['ecif']);
    expect(programs[0]?.matched).toEqual(['Azure']);
    expect(fundingRead([
      {
        label: 'Cloud',
        items: [
          { name: 'Azure', source: 'open_data:dns', confidence: 0.9 },
          { name: 'Microsoft 365', source: 'open_data:dns', confidence: 0.95, sample: true },
        ],
      },
    ])).toEqual({ kind: 'programs', programs });
  });

  it('treats a sample snapshot as sample even when the item flag was dropped', () => {
    // WHY: coverage.sample is the snapshot-level fact. A demo stack can lose
    // the per-item flag and still be a fixture. That must not become ECIF.
    const stack = [cat('Collaboration', 'Microsoft 365')];
    expect(deriveFundingPrograms(stack).map((program) => program.key)).toEqual(['ecif']);
    expect(fundingRead(stack, true)).toEqual({ kind: 'sample' });
  });

  it('does not call an Okta-only sample a funding vendor gap of Microsoft', () => {
    const stack = [sampleCat('Identity', 'Okta')];
    expect(fundingRead(stack, true)).toEqual({ kind: 'none' });
  });
});

function sampleCat(label: string, ...names: string[]): TechnicalStackCategory {
  return {
    label,
    items: names.map((name) => ({ name, source: 'open_data:dns', confidence: 0.95, sample: true })),
  };
}
