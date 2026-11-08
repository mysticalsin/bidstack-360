// Signal-coverage scoring + field-override tests (M1/M2).
// WHY these matter: the score drives manager action — a hardcoded or
// mis-banded score sends teams chasing the wrong accounts, and an override
// that silently stays "external" violates the account-view data contract.
import { describe, expect, it } from 'vitest';

import { AccountCockpitMaybeScored, AccountCockpitSnapshot, type CrmCompany } from '@bidstack/shared';

import {
  applyFieldOverrides,
  buildCockpit,
  buildCockpitFromCompany,
  computeSignalCoverage,
} from './dashboard.cockpit.js';

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

describe('buildCockpit technical stack overrides', () => {
  it('uses the saved manual tech stack instead of provider/default rows', () => {
    const cockpit = buildCockpit({
      company: company({
        name: 'Acme',
        technicalStack: [
          {
            label: 'Cloud',
            items: [{ name: 'Azure', source: 'enrichment:apollo', confidence: 0.91 }],
          },
        ],
      }),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [
        {
          fieldKey: 'technicalStack',
          value: {
            stack: [
              {
                label: 'Data',
                items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }],
              },
            ],
            dismissedSuggestionIds: [],
          },
        },
      ],
    });

    expect(cockpit.technicalStack).toEqual([
      {
        label: 'Data',
        items: [{ name: 'Snowflake', source: 'manual', confidence: 1 }],
      },
    ]);
  });
});

describe('buildCockpit win/loss + revenue derivation', () => {
  const baseArgs = (opps: unknown[]) => ({
    company: company({ name: 'Acme' }),
    companies: [],
    opportunities: opps as never,
    contacts: [],
    tasks: [],
    risks: [],
    compliance: [],
    fieldOverrides: [],
    winLossAvailable: true,
  });

  function opp(over: Record<string, unknown>) {
    return {
      id: 'o',
      customer: 'Acme',
      name: 'deal',
      stage: 'qualified',
      pipelineStage: null,
      valueMicros: 1_000_000n,
      probability: 50,
      dueDate: null,
      owner: null,
      ...over,
    };
  }

  it('derives win/loss from the canonical stage column (no pipelineStage FK needed)', () => {
    const cockpit = buildCockpit(
      baseArgs([
        opp({ stage: 'closed_won', valueMicros: 500_000_000_000n, dueDate: new Date('2026-01-15') }),
        opp({ stage: 'closed_won', valueMicros: 300_000_000_000n, dueDate: new Date('2026-02-15') }),
        opp({ stage: 'closed_lost', valueMicros: 200_000_000_000n, dueDate: new Date('2026-02-20') }),
        opp({ stage: 'qualified' }),
      ]),
    );
    expect(cockpit.winLoss).toEqual({
      wonCount: 2,
      lostCount: 1,
      wonValueMicros: 800_000_000_000,
      lostValueMicros: 200_000_000_000,
      winRate: 67,
    });
  });

  it('builds revenue evolution from won deals grouped by close month, ascending', () => {
    const cockpit = buildCockpit(
      baseArgs([
        opp({ stage: 'closed_won', valueMicros: 500_000_000_000n, dueDate: new Date('2026-02-10') }),
        opp({ stage: 'closed_won', valueMicros: 250_000_000_000n, dueDate: new Date('2026-02-25') }),
        opp({ stage: 'closed_won', valueMicros: 100_000_000_000n, dueDate: new Date('2026-01-05') }),
        // lost + open contribute nothing to revenue
        opp({ stage: 'closed_lost', valueMicros: 900_000_000_000n, dueDate: new Date('2026-02-01') }),
        opp({ stage: 'qualified', dueDate: new Date('2026-03-01') }),
      ]),
    );
    expect(cockpit.revenueEvolution).toEqual([
      { period: '2026-01', revenueMicros: 100_000_000_000 },
      { period: '2026-02', revenueMicros: 750_000_000_000 },
    ]);
  });

  it('emits empty revenue + zero win rate for an account with no closed deals', () => {
    const cockpit = buildCockpit(baseArgs([opp({ stage: 'qualified' })]));
    expect(cockpit.revenueEvolution).toEqual([]);
    expect(cockpit.winLoss?.winRate).toBe(0);
    expect(cockpit.winLoss?.wonCount).toBe(0);
  });
});

describe('buildCockpit risks are scoped to the account', () => {
  // WHY: the account header and open-risk count read cockpit.risks. A canned
  // fallback showed "Security scope needs final sign-off" (owner Sarah
  // Bennett) and "Open risks 2" on every account that had no risk of its own.
  const risk = (over: Record<string, unknown>) => ({
    id: 'r1',
    title: 'Data residency clause not agreed',
    severity: 'high',
    owner: 'Ana Lopez',
    mitigation: null,
    dueDate: null,
    status: 'open',
    companyName: 'Acme',
    ...over,
  });
  const args = (risks: unknown[]) => ({
    company: company({ id: 'acme', name: 'Acme' }),
    companies: [],
    opportunities: [],
    contacts: [],
    tasks: [],
    risks: risks as never,
    compliance: [],
    fieldOverrides: [],
  });

  it('returns no risks for an account with none in the register', () => {
    const cockpit = buildCockpit(args([risk({ id: 'other', companyName: 'Globex' })]));
    expect(cockpit.risks).toEqual([]);
    expect(JSON.stringify(cockpit.risks)).not.toContain('Sarah Bennett');
  });

  it('returns only the account own risks', () => {
    const cockpit = buildCockpit(args([risk({}), risk({ id: 'r2', title: 'Globex budget freeze', companyName: 'Globex' })]));
    expect(cockpit.risks.map((r) => r.title)).toEqual(['Data residency clause not agreed']);
    expect(cockpit.risks[0]!.owner).toBe('Ana Lopez');
  });
});

describe('buildCockpit compliance is scoped to the account', () => {
  // WHY: an account with no compliance rows used to get the canned ISO 27001
  // and SOC 2 library rows, claiming checks nobody ran for it.
  const args = (compliance: unknown[]) => ({
    company: company({ id: 'acme', name: 'Acme' }),
    companies: [],
    opportunities: [],
    contacts: [],
    tasks: [],
    risks: [],
    compliance: compliance as never,
    fieldOverrides: [],
  });
  const check = (over: Record<string, unknown>) => ({
    id: 'c1',
    label: 'GDPR DPA signed',
    status: 'compliant',
    owner: 'Ana Lopez',
    sourceAttribution: [
      {
        source: 'manual',
        label: 'Compliance register',
        sourceUrl: null,
        fetchedAt: '2026-05-01T00:00:00.000Z',
        confidence: 0.9,
        providerMetadata: { companyName: over.companyName ?? 'Acme' },
      },
    ],
    ...over,
  });

  it('returns no compliance rows when the account has none', () => {
    const cockpit = buildCockpit(args([check({ id: 'other', companyName: 'Globex' })]));
    expect(cockpit.compliance).toEqual([]);
    expect(JSON.stringify(cockpit.compliance)).not.toMatch(/ISO 27001|SOC 2/);
  });

  it('returns only the account own compliance rows', () => {
    const cockpit = buildCockpit(
      args([check({}), check({ id: 'c2', label: 'Globex audit', companyName: 'Globex' })]),
    );
    expect(cockpit.compliance.map((c) => c.label)).toEqual(['GDPR DPA signed']);
  });
});

describe('buildCockpitFromCompany scopes the stored snapshot to its company', () => {
  // WHY: the snapshot holds one company's cockpit. Spreading it onto another
  // company showed that company's risks and compliance on every account.
  const risk = { id: 'r1', title: 'Security scope needs final sign-off', severity: 'high', owner: 'Sarah Bennett', status: 'open' };
  const snapshotCompany = company({ id: 'snap', name: 'Snap Co' });
  const snapshot = {
    cockpit: {
      company: snapshotCompany,
      kpis: [{ label: 'Revenue' }],
      technicalStack: [{ label: 'Cloud', items: [] }],
      health: { score: 80 },
      keyContacts: [
        { id: 'p1', companyId: 'snap', name: 'Sarah Bennett' },
        { id: 'p2', companyId: 'other', name: 'Ana Lopez' },
      ],
      recentActivity: [
        { id: 'a1', companyId: 'snap', title: 'Call with Snap' },
        { id: 'a2', companyId: 'other', title: 'Call with Other' },
      ],
      risks: [risk],
      compliance: [{ id: 'c1', label: 'ISO 27001', status: 'compliant' }],
      roadmap: [{ id: 'road-q1', title: 'Windows 11 migration' }],
      revenueEvolution: [{ period: '2026-01', revenueMicros: 1 }],
      winLoss: { wonCount: 1 },
      externalLastSyncedAt: '2026-05-01T00:00:00.000Z',
    },
  } as never;

  it('returns the snapshot untouched for the company it belongs to', () => {
    const cockpit = buildCockpitFromCompany(snapshot, snapshotCompany);
    expect(cockpit.risks).toHaveLength(1);
    expect(cockpit.compliance).toHaveLength(1);
    expect(cockpit.health).toEqual({ score: 80 });
  });

  it('is accepted by the shared maybe-scored schema, and rejected by the scored one', () => {
    const other = company({ id: 'other', name: 'Other' });
    const cockpit = buildCockpitFromCompany(snapshot, other);
    expect(AccountCockpitMaybeScored.shape.health.safeParse(cockpit.health).success).toBe(true);
    expect(AccountCockpitSnapshot.shape.health.safeParse(cockpit.health).success).toBe(false);
  });

  it('carries no risks, compliance or other-account data onto a different company', () => {
    const other = company({ id: 'other', name: 'Other' });
    const cockpit = buildCockpitFromCompany(snapshot, other);
    expect(cockpit.company.id).toBe('other');
    expect(cockpit.risks).toEqual([]);
    expect(cockpit.compliance).toEqual([]);
    expect(cockpit.kpis).toEqual([]);
    expect(cockpit.technicalStack).toEqual([]);
    expect(cockpit.roadmap).toEqual([]);
    expect(cockpit.health).toBeNull();
    expect(cockpit).not.toHaveProperty('revenueEvolution');
    expect(cockpit).not.toHaveProperty('winLoss');
    expect(cockpit).not.toHaveProperty('externalLastSyncedAt');
    expect(cockpit.keyContacts.map((c) => c.id)).toEqual(['p2']);
    expect(cockpit.recentActivity.map((a) => a.id)).toEqual(['a2']);
    expect(JSON.stringify(cockpit)).not.toContain('Sarah Bennett');
  });
});

describe('buildCockpit roadmap is scoped to the account', () => {
  // WHY: four canned quarters (Windows 11 migration, Zero Trust, ...) were
  // returned for every account. There is no per-account roadmap source, so an
  // account has no roadmap items until one exists.
  it('returns no roadmap items and never the canned quarters', () => {
    const cockpit = buildCockpit({
      company: company({ id: 'acme', name: 'Acme' }),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
    });
    expect(cockpit.roadmap).toEqual([]);
    expect(JSON.stringify(cockpit)).not.toMatch(/Windows 11 migration|Zero Trust initiative/);
  });
});
