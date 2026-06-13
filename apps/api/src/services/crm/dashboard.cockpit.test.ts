// Signal-coverage scoring + field-override tests (M1/M2).
// WHY these matter: the score drives manager action — a hardcoded or
// mis-banded score sends teams chasing the wrong accounts, and an override
// that silently stays "external" violates the account-view data contract.
import { describe, expect, it } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import { applyFieldOverrides, computeSignalCoverage } from './dashboard.cockpit.js';

function company(partial: Partial<CrmCompany> = {}): CrmCompany {
  return {
    id: 'mantu',
    source: 'external_crm',
    name: 'Mantu',
    legalName: 'Mantu Group',
    domain: null,
    website: null,
    industry: null,
    employeeCount: null,
    annualRevenueMicros: null,
    status: 'active',
    registryIds: {},
    formerNames: [],
    incorporationDate: null,
    imageUrl: null,
    logo: null,
    confidence: 0.5,
    sourceAttribution: [],
    updatedAt: new Date().toISOString(),
    ...partial,
  } as CrmCompany;
}

describe('computeSignalCoverage', () => {
  it('scores an empty account critical with actionable factor guidance', () => {
    const health = computeSignalCoverage({
      company: company(),
      contacts: [],
      openDeals: [],
      tasks: [],
    });
    expect(health.score).toBeLessThan(25);
    expect(health.band).toBe('critical');
    expect(health.factors).toHaveLength(4);
    // Every factor must explain itself — a bare number is useless to a manager.
    for (const factor of health.factors ?? []) {
      expect(factor.whatItMeasures.length).toBeGreaterThan(10);
      expect(factor.recommendedAction.length).toBeGreaterThan(10);
    }
  });

  it('rewards a fully covered account with a strong composite', () => {
    const health = computeSignalCoverage({
      company: company({
        industry: 'technology',
        employeeCount: 5000,
        annualRevenueMicros: 2_000_000_000_000,
        technicalStack: [{ category: 'Cloud', items: ['AWS'] }] as never,
        strategicIntel: { freshness: 'fresh' } as never,
      }),
      contacts: [
        { influence: 5, email: 'a@x.com' },
        { influence: 3, email: 'b@x.com' },
        { influence: null, email: 'c@x.com' },
        { influence: 2, email: 'd@x.com' },
      ],
      openDeals: [{ probability: 60, dueDate: new Date(Date.now() + 86_400_000), owner: { name: 'o' } }],
      tasks: [
        { status: 'open', dueDate: new Date(Date.now() + 86_400_000), createdAt: new Date() },
        { status: 'open', dueDate: null, createdAt: new Date() },
        { status: 'done', dueDate: null, createdAt: new Date() },
      ],
    });
    expect(health.score).toBeGreaterThanOrEqual(75);
    expect(health.band).toBe('strong');
    // counts now mean factor-band counts — they must sum to the 4 factors.
    const total = Object.values(health.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  it('stale Apollo data scores firmographics lower than fresh data', () => {
    const base = {
      contacts: [],
      openDeals: [],
      tasks: [],
    };
    const fresh = computeSignalCoverage({
      ...base,
      company: company({ industry: 'tech', strategicIntel: { freshness: 'fresh' } as never }),
    });
    const stale = computeSignalCoverage({
      ...base,
      company: company({ industry: 'tech', strategicIntel: { freshness: 'stale' } as never }),
    });
    const f = (h: typeof fresh) => h.factors!.find((x) => x.key === 'firmographics')!.score;
    expect(f(fresh)).toBeGreaterThan(f(stale));
  });
});

describe('applyFieldOverrides', () => {
  it('moves overridden values onto the company and reports their keys', () => {
    const { company: next, overriddenKeys } = applyFieldOverrides(
      company({ industry: 'banking', employeeCount: 10 }),
      [
        { fieldKey: 'industry', value: 'aerospace' },
        { fieldKey: 'employeeCount', value: 2500 },
      ],
    );
    expect(next.industry).toBe('aerospace');
    expect(next.employeeCount).toBe(2500);
    expect(overriddenKeys.has('industry')).toBe(true);
    expect(overriddenKeys.has('employeeCount')).toBe(true);
    // Revenue untouched.
    expect(overriddenKeys.has('annualRevenueMicros')).toBe(false);
  });

  it('ignores malformed override values instead of corrupting the snapshot', () => {
    const original = company({ industry: 'banking' });
    const { company: next, overriddenKeys } = applyFieldOverrides(original, [
      { fieldKey: 'industry', value: 42 },
      { fieldKey: 'employeeCount', value: -5 },
      { fieldKey: 'unknown_field', value: 'x' },
    ]);
    expect(next.industry).toBe('banking');
    expect(overriddenKeys.size).toBe(0);
  });
});
