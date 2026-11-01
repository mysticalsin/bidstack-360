// Signal-coverage scoring + field-override tests (M1/M2).
// WHY these matter: the score drives manager action — a hardcoded or
// mis-banded score sends teams chasing the wrong accounts, and an override
// that silently stays "external" violates the account-view data contract.
import { describe, expect, it } from 'vitest';

import type { CrmCompany } from '@bidstack/shared';

import {
  applyFieldOverrides,
  buildCockpit,
  computeSignalCoverage,
  registerDealsAreCapped,
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
    // No tasks is not partial engagement coverage. The old +25 treated
    // an empty follow-up list as a score.
    expect(health.factors?.find((factor) => factor.key === 'engagement')?.score).toBe(0);
    expect(health.factors).toHaveLength(4);
    // Every factor must explain itself — a bare number is useless to a manager.
    for (const factor of health.factors ?? []) {
      expect(factor.whatItMeasures.length).toBeGreaterThan(10);
      expect(factor.recommendedAction.length).toBeGreaterThan(10);
    }
  });

  it('names a coverage factor when its list is only a page', () => {
    // WHY: the latest 100 opportunities and the 20 highest-influence contacts were scored as the whole account.
    const health = computeSignalCoverage(
      {
        company: company(),
        contacts: [{ influence: 5, email: 'a@x.com' }],
        openDeals: [{ probability: 40, dueDate: new Date(), owner: { email: 'o@x.com' } }],
        tasks: [],
      },
      { contactsCapped: true, dealsCapped: true, tasksCapped: true },
    );
    expect(health.factors?.find((factor) => factor.key === 'contacts')?.whatItMeasures).toContain(
      '20 highest-influence contacts',
    );
    expect(health.factors?.find((factor) => factor.key === 'pipeline')?.whatItMeasures).toContain(
      'latest 100 opportunities',
    );
    expect(health.factors?.find((factor) => factor.key === 'engagement')?.whatItMeasures).toContain(
      'latest 50 tasks',
    );
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

  it('names only the firmographic fields that are missing', () => {
    const health = computeSignalCoverage({
      company: company({ industry: 'financial_services' }),
      contacts: [],
      openDeals: [],
      tasks: [],
    });
    const action = health.factors?.find((factor) => factor.key === 'firmographics')?.recommendedAction ?? '';
    expect(action).toContain('headcount');
    expect(action).not.toMatch(/missing: industry|fill industry/i);
  });

  it('does not call a recent task an empty activity list', () => {
    const health = computeSignalCoverage({
      company: company(),
      contacts: [],
      openDeals: [],
      tasks: [
        { status: 'open', dueDate: new Date(Date.now() - 86_400_000), createdAt: new Date() },
      ],
    });
    const action = health.factors?.find((factor) => factor.key === 'engagement')?.recommendedAction ?? '';
    expect(action).toContain('1 task in the last 30 days');
    expect(action).not.toMatch(/No recent activity/i);
  });

  it('does not tell the seller to confirm a champion that was not recorded', () => {
    // Why: a full contact list used to say the map was healthy and to confirm
    // the champion. Influence and email are not a decision role.
    const health = computeSignalCoverage({
      company: company(),
      contacts: [
        { influence: 5, email: 'a@x.com' },
        { influence: 4, email: 'b@x.com' },
        { influence: 3, email: 'c@x.com' },
        { influence: 2, email: 'd@x.com' },
      ],
      openDeals: [],
      tasks: [],
    });
    const action = health.factors?.find((factor) => factor.key === 'contacts')?.recommendedAction ?? '';
    expect(action).toContain('4 linked contacts');
    expect(action).toContain('4 have an influence rating');
    expect(action).not.toMatch(/champion/i);
  });

  it('does not score an incomplete open deal as pipeline coverage', () => {
    // Why: an open deal used to add 40 points before owner, date, or probability existed.
    const missing = computeSignalCoverage({
      company: company(),
      contacts: [],
      openDeals: [{ probability: 0, dueDate: null, owner: null }],
      tasks: [],
    });
    const complete = computeSignalCoverage({
      company: company(),
      contacts: [],
      openDeals: [{ probability: 40, dueDate: new Date('2026-09-15'), owner: { name: 'Jane' } }],
      tasks: [],
    });
    expect(missing.factors?.find((factor) => factor.key === 'pipeline')?.score).toBe(0);
    expect(complete.factors?.find((factor) => factor.key === 'pipeline')?.score).toBe(100);
    const missingAction =
      missing.factors?.find((factor) => factor.key === 'pipeline')?.recommendedAction ?? '';
    expect(missingAction).toContain('without a probability above 0');
    expect(missingAction).toContain('without an owner');
    expect(missingAction).toContain('without a close date');
    expect(missingAction).not.toMatch(/missing stage/i);
    const completeAction =
      complete.factors?.find((factor) => factor.key === 'pipeline')?.recommendedAction ?? '';
    expect(completeAction).toContain('probability above 0');
    expect(completeAction).not.toMatch(/records are complete/i);
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

  it('keeps a large revenue override exact on the annual revenue kpi', () => {
    // WHY: the editor multiplied the typed number by 1e6, so the cockpit showed the wrong cent.
    const micros = '8598204328457184962';
    const { overriddenKeys } = applyFieldOverrides(company(), [
      { fieldKey: 'annualRevenueMicros', value: micros },
    ]);
    expect(overriddenKeys.has('annualRevenueMicros')).toBe(true);
    const cockpit = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [{ fieldKey: 'annualRevenueMicros', value: micros }],
    });
    expect(cockpit.kpis.find((kpi) => kpi.label === 'Annual revenue')?.value).toBe(
      '8,598,204,328,457.18 unspecified',
    );
  });

  it('uses the exact open-deal count when the opportunity page is full', () => {
    // WHY: the latest 100 updated opportunities can be closed while older deals are still open.
    const cockpit = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [],
      risks: [],
      compliance: [],
      openDealCount: 40,
      coveragePages: { dealsCapped: true },
    });
    expect(cockpit.kpis.find((kpi) => kpi.label === 'Open deals')?.value).toBe('40');
    expect(cockpit.health.factors?.find((factor) => factor.key === 'pipeline')?.whatItMeasures).toContain(
      'latest 100 opportunities',
    );
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

describe('buildCockpit recorded facts only', () => {
  it('does not invent a technology catalog, compliance status, risk, or roadmap', () => {
    const cockpit = buildCockpit({
      company: company({ name: 'Acme', technicalStack: [] }),
      companies: [],
      opportunities: [],
      contacts: [
        {
          id: 'c1',
          customer: 'Acme',
          companyId: 'mantu',
          name: 'Ada',
          role: 'CIO',
          email: 'ada@acme.com',
          phone: null,
          influence: 5,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
      ],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
    });

    expect(cockpit.technicalStack).toEqual([]);
    expect(cockpit.risks).toEqual([]);
    expect(cockpit.compliance).toEqual([]);
    expect(cockpit.roadmap).toEqual([]);
    expect(cockpit.keyContacts[0]?.roleInDecision).toBeNull();
    expect(cockpit.keyContacts[0]?.companyId).toBe('mantu');
    expect(JSON.stringify(cockpit)).not.toContain('Microsoft 365');
    expect(JSON.stringify(cockpit)).not.toContain('SOC 2');
  });

  it('fills a buying role from one accepted fact and ignores a job title', () => {
    const now = new Date('2026-10-31T00:00:00.000Z');
    const contact = {
      id: 'c1',
      customer: 'Acme',
      companyId: 'mantu',
      name: 'Ada',
      role: 'Chief Information Officer',
      email: null,
      phone: null,
      influence: 5,
      createdAt: now,
    };
    const opportunity = {
      id: 'deal-1',
      customer: 'Acme',
      companyId: 'mantu',
      name: 'Platform',
      stage: 'proposal',
      pipelineStage: null,
      valueMicros: 0,
      probability: 0,
      dueDate: null,
      owner: null,
    };
    const cockpit = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [opportunity],
      contacts: [contact],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      now,
      buyingRoleFacts: [
        {
          contactId: 'c1',
          status: 'accepted',
          linkLabel: 'Buyer',
          opportunityId: 'deal-1',
          observedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
    });
    expect(cockpit.keyContacts[0]?.title).toBe('Chief Information Officer');
    expect(cockpit.keyContacts[0]?.roleInDecision).toBe('buyer');
    const capped = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [opportunity],
      contacts: [contact],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      now,
      buyingRoleFacts: [
        {
          contactId: 'c1',
          status: 'accepted',
          linkLabel: 'Buyer',
          opportunityId: 'deal-1',
          observedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
      buyingRolesCapped: true,
    });
    // WHY: a page of 200 accepted facts can hide a second role, so one label is not the champion.
    expect(capped.keyContacts[0]?.roleInDecision).toBeNull();
    const olderDeal = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [opportunity],
      contacts: [contact],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      now,
      buyingRoleFacts: [
        {
          contactId: 'c1',
          status: 'accepted',
          linkLabel: 'champion',
          opportunityId: 'older-deal',
          observedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
    });
    // WHY: the latest 100 deals must not hide a champion on an older deal.
    expect(olderDeal.keyContacts[0]?.roleInDecision).toBe('champion');

    const titledOnly = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [opportunity],
      contacts: [contact],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      now,
      buyingRoleFacts: [
        {
          contactId: 'c1',
          status: 'accepted',
          linkLabel: 'Economic buyer',
          opportunityId: 'deal-1',
          observedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
    });
    expect(titledOnly.keyContacts[0]?.roleInDecision).toBeNull();
  });

  it('links a person only through companyId, never a matching customer string', () => {
    // Why: a shared display name used to stamp this account's id onto an
    // unlinked contact, so the cockpit and the people map disagreed.
    const contact = {
      name: 'Ada',
      role: 'CIO',
      email: null,
      phone: null,
      influence: 4,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const cockpit = buildCockpit({
      company: company({ id: 'co-dnb', name: 'DNB' }),
      companies: [],
      opportunities: [],
      contacts: [
        { ...contact, id: 'linked', customer: 'DNB Bank ASA', companyId: 'co-dnb' },
        { ...contact, id: 'name-only', customer: 'DNB', companyId: null },
        { ...contact, id: 'other-company', customer: 'DNB', companyId: 'co-other' },
      ],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
    });

    expect(cockpit.keyContacts.map((person) => person.id)).toEqual(['linked']);
    expect(cockpit.keyContacts[0]?.companyId).toBe('co-dnb');
  });

  it('orders linked people by recorded influence, with no influence last', () => {
    // Why: the card says these are the key people. Alphabetical order would
    // present a low-influence name as more important than a recorded 5.
    const contact = {
      customer: 'DNB',
      companyId: 'co-dnb',
      role: null,
      email: null,
      phone: null,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const cockpit = buildCockpit({
      company: company({ id: 'co-dnb', name: 'DNB' }),
      companies: [],
      opportunities: [],
      contacts: [
        { ...contact, id: 'ada', name: 'Ada', influence: 1 },
        { ...contact, id: 'no-score', name: 'Bea', influence: null },
        { ...contact, id: 'cio', name: 'Cara', influence: 5 },
      ],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
    });

    expect(cockpit.keyContacts.map((person) => person.id)).toEqual(['cio', 'ada', 'no-score']);
  });

  it('keeps an accepted role holder in the key people ahead of louder names', () => {
    // WHY: five seats ordered by influence used to hide the champion when
    // louder people on the account had no recorded buying role.
    const now = new Date('2026-10-31T00:00:00.000Z');
    const base = {
      customer: 'Acme',
      companyId: 'mantu',
      role: null,
      email: null,
      phone: null,
      createdAt: now,
    };
    const opportunity = {
      id: 'deal-1',
      customer: 'Acme',
      companyId: 'mantu',
      name: 'Platform',
      stage: 'proposal',
      pipelineStage: null,
      valueMicros: 0,
      probability: 0,
      dueDate: null,
      owner: null,
    };
    const louder = ['Ann', 'Bea', 'Cal', 'Dee', 'Eve'].map((name, index) => ({
      ...base,
      id: `loud-${index}`,
      name,
      influence: 9 - index,
    }));
    const cockpit = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [opportunity],
      contacts: [...louder, { ...base, id: 'champion', name: 'Fay', influence: 1 }],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      now,
      buyingRoleFacts: [
        {
          contactId: 'champion',
          status: 'accepted',
          linkLabel: 'champion',
          opportunityId: 'deal-1',
          observedAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
    });
    expect(cockpit.keyContacts.map((person) => person.id)).toEqual([
      'champion',
      'loud-0',
      'loud-1',
      'loud-2',
      'loud-3',
    ]);
    expect(cockpit.keyContacts[0]?.roleInDecision).toBe('champion');

    const holders = [6, 5, 4, 3, 2, 1].map((influence) => ({
      ...base,
      id: `role-${influence}`,
      name: `Role ${influence}`,
      influence,
    }));
    const manyRoles = buildCockpit({
      company: company({ name: 'Acme' }),
      companies: [],
      opportunities: [opportunity],
      contacts: [...holders, { ...base, id: 'loud', name: 'Zoe', influence: 100 }],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      now,
      buyingRoleFacts: holders.map((holder) => ({
        contactId: holder.id,
        status: 'accepted',
        linkLabel: 'champion',
        opportunityId: 'deal-1',
        observedAt: new Date('2026-10-01T00:00:00.000Z'),
      })),
    });
    // WHY: more than five role holders still compete by influence. A louder
    // name with no role does not take a seat from them.
    expect(manyRoles.keyContacts.map((person) => person.id)).toEqual([
      'role-6',
      'role-5',
      'role-4',
      'role-3',
      'role-2',
    ]);
  });

  it('counts a deal and its tasks only when the opportunity companyId matches', () => {
    // Why: a shared customer string used to pull another company's deal and
    // its tasks onto this account, and the activity then wore this account's id.
    const cockpit = buildCockpit({
      company: company({ id: 'co-dnb', name: 'DNB' }),
      companies: [],
      opportunities: [
        {
          id: 'linked',
          customer: 'DNB Bank ASA',
          companyId: 'co-dnb',
          name: 'Treasury',
          stage: 's2_sent',
          pipelineStage: null,
          valueMicros: 1n,
          probability: 40,
          dueDate: null,
          owner: null,
        },
        {
          id: 'name-only',
          customer: 'DNB',
          companyId: null,
          name: 'Unlinked',
          stage: 's2_sent',
          pipelineStage: null,
          valueMicros: 1n,
          probability: 40,
          dueDate: null,
          owner: null,
        },
      ],
      contacts: [],
      tasks: [
        {
          id: 'task-linked',
          title: 'Call the treasurer',
          status: 'open',
          dueDate: null,
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          opportunity: { id: 'linked', customer: 'Other label', companyId: 'co-dnb', name: 'Treasury' },
          assignee: null,
        },
        {
          id: 'task-name',
          title: 'Chase the name match',
          status: 'open',
          dueDate: null,
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
          opportunity: { id: 'name-only', customer: 'DNB', companyId: null, name: 'Unlinked' },
          assignee: null,
        },
      ],
      risks: [],
      compliance: [],
      fieldOverrides: [],
    });

    const projects = cockpit.kpis.find((kpi) => kpi.label === 'Projects');
    expect(projects?.value).toBe('1');
    expect(cockpit.recentActivity.map((activity) => activity.dealId)).toEqual(['linked']);
    expect(cockpit.recentActivity[0]?.companyId).toBe('co-dnb');
  });

  it('keeps a risk or compliance row only when its opportunity is linked to the account', () => {
    // Why: a company name, including one buried in attribution metadata, used
    // to put another account's issue on this cockpit.
    const cockpit = buildCockpit({
      company: company({ id: 'co-dnb', name: 'DNB' }),
      companies: [],
      opportunities: [
        {
          id: 'linked-deal',
          customer: 'DNB Bank ASA',
          companyId: 'co-dnb',
          name: 'Treasury',
          stage: 's2_sent',
          pipelineStage: null,
          valueMicros: 1n,
          probability: 40,
          dueDate: null,
          owner: null,
        },
      ],
      contacts: [],
      tasks: [],
      risks: [
        {
          id: 'risk-linked',
          opportunityId: 'linked-deal',
          title: 'Data residency',
          severity: 'high',
          owner: null,
          mitigation: null,
          dueDate: null,
          status: 'open',
          companyName: 'Someone else',
        },
        {
          id: 'risk-name',
          opportunityId: null,
          title: 'Name match',
          severity: 'critical',
          owner: null,
          mitigation: null,
          dueDate: null,
          status: 'open',
          companyName: 'DNB',
        },
      ],
      compliance: [
        {
          id: 'check-name',
          opportunityId: null,
          label: 'SOC 2',
          status: 'blocked',
          owner: null,
          sourceAttribution: [{ providerMetadata: { companyName: 'DNB' } }],
        },
        {
          id: 'check-linked',
          opportunityId: 'linked-deal',
          label: 'DPA',
          status: 'in_progress',
          owner: null,
          sourceAttribution: [],
        },
      ],
      fieldOverrides: [],
    });

    expect(cockpit.risks.map((risk) => risk.id)).toEqual(['risk-linked']);
    expect(cockpit.compliance.map((check) => check.id)).toEqual(['check-linked']);
    expect(JSON.stringify(cockpit)).not.toContain('SOC 2');
    expect(JSON.stringify(cockpit)).not.toContain('Name match');

    const older = buildCockpit({
      company: company({ id: 'co-dnb', name: 'DNB' }),
      companies: [],
      opportunities: [
        {
          id: 'linked-deal',
          customer: 'DNB Bank ASA',
          companyId: 'co-dnb',
          name: 'Treasury',
          stage: 's2_sent',
          pipelineStage: null,
          valueMicros: 1n,
          probability: 40,
          dueDate: null,
          owner: null,
        },
      ],
      contacts: [],
      tasks: [],
      risks: [
        {
          id: 'older',
          opportunityId: 'older-deal',
          title: 'Legacy residency',
          severity: 'critical',
          owner: null,
          mitigation: null,
          dueDate: null,
          status: 'open',
          companyName: 'DNB',
        },
        {
          id: 'stranger',
          opportunityId: 'other-co-deal',
          title: 'Not ours',
          severity: 'high',
          owner: null,
          mitigation: null,
          dueDate: null,
          status: 'open',
          companyName: 'Other',
        },
      ],
      compliance: [
        {
          id: 'older-check',
          opportunityId: 'older-deal',
          label: 'Legacy DPA',
          status: 'blocked',
          owner: null,
          sourceAttribution: [],
        },
      ],
      fieldOverrides: [],
      registerDealIds: ['linked-deal', 'older-deal'],
    });
    // WHY: the register includes deals past the 100 on the card. Filtering
    // again with the card hid this risk and this blocked check.
    expect(older.risks.map((risk) => risk.id)).toEqual(['older']);
    expect(older.compliance.map((check) => check.id)).toEqual(['older-check']);
  });

  it('does not turn an unrecognized risk status into open', () => {
    // WHY: a stored word such as closed used to become open, so the card
    // escalated a risk the register does not count as open.
    const cockpit = buildCockpit({
      company: company(),
      companies: [],
      opportunities: [
        {
          id: 'deal-1',
          customer: 'Acme',
          companyId: 'mantu',
          name: 'Platform',
          stage: 'proposal',
          pipelineStage: null,
          valueMicros: 0,
          probability: 0,
          dueDate: null,
          owner: null,
        },
      ],
      contacts: [],
      tasks: [],
      risks: [
        {
          id: 'r-closed',
          opportunityId: 'deal-1',
          title: 'Old plant',
          severity: 'critical',
          owner: null,
          mitigation: null,
          dueDate: null,
          status: 'closed',
          companyName: null,
        },
      ],
      compliance: [],
      fieldOverrides: [],
    });
    expect(cockpit.risks[0]?.status).toBe('unspecified');
  });

  it('keeps a follow-up stored on the account when it has no deal', () => {
    // WHY: a meeting import links the task by company id. The cockpit used
    // to keep only tasks hanging off a deal, so that follow-up disappeared.
    const cockpit = buildCockpit({
      company: company(),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [
        {
          id: 'task-account',
          title: 'Send the deployment plan',
          status: 'open',
          dueDate: null,
          accountId: 'mantu',
          opportunity: null,
          assignee: null,
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          id: 'task-other',
          title: 'Someone else',
          status: 'open',
          dueDate: null,
          accountId: 'other-co',
          opportunity: null,
          assignee: null,
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
        },
      ],
      risks: [],
      compliance: [],
      fieldOverrides: [],
    });
    expect(cockpit.recentActivity.map((item) => item.subject)).toEqual(['Send the deployment plan']);
    expect(cockpit.recentActivity[0]?.companyId).toBe('mantu');
  });

  it('keeps register counts that the six cards do not show', () => {
    // WHY: readiness was reading the visible cards. The counts have to survive
    // onto the snapshot or the share collapses back to those six rows.
    const cockpit = buildCockpit({
      company: company(),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      openRiskSeverity: { critical: 10, high: 0, medium: 0, low: 1 },
      compliantCount: 40,
      complianceTotal: 46,
      blockedCount: 3,
      registerDealsCapped: true,
    });
    expect(cockpit.openRiskSeverity).toEqual({ critical: 10, high: 0, medium: 0, low: 1 });
    expect(cockpit.compliantCount).toBe(40);
    expect(cockpit.complianceTotal).toBe(46);
    expect(cockpit.blockedCount).toBe(3);
    expect(cockpit.registerDealsCapped).toBe(true);
  });

  it('does not treat the 100-deal card as a partial register', () => {
    // WHY: the card shows 100 deals. A risk on deal 101 still belongs in the
    // register until the deal-id page of 1,000 is full.
    expect(registerDealsAreCapped(100, 150)).toBe(false);
    expect(registerDealsAreCapped(1000, 1000)).toBe(false);
    expect(registerDealsAreCapped(1000, 1001)).toBe(true);
    const cockpit = buildCockpit({
      company: company(),
      companies: [],
      opportunities: [],
      contacts: [],
      tasks: [],
      risks: [],
      compliance: [],
      fieldOverrides: [],
      coveragePages: { dealsCapped: true },
    });
    expect(cockpit.registerDealsCapped).toBe(false);
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
      companyId: 'mantu',
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

  it('keeps a large won total as the exact micros string', () => {
    // WHY: Number(bigint) moved this won book off the cent before the card printed it.
    const cockpit = buildCockpit(
      baseArgs([
        opp({
          stage: 'closed_won',
          valueMicros: 8_598_204_328_457_184_962n,
          dueDate: new Date('2026-04-01'),
        }),
      ]),
    );
    expect(cockpit.winLoss?.wonValueMicros).toBe('8598204328457184962');
    expect(cockpit.revenueEvolution).toEqual([
      { period: '2026-04', revenueMicros: '8598204328457184962' },
    ]);
  });

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
      wonValueMicros: '800000000000',
      lostValueMicros: '200000000000',
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
      { period: '2026-01', revenueMicros: '100000000000' },
      { period: '2026-02', revenueMicros: '750000000000' },
    ]);
  });

  it('emits empty revenue and no win rate for an account with no closed deals', () => {
    const cockpit = buildCockpit(baseArgs([opp({ stage: 'qualified' })]));
    expect(cockpit.revenueEvolution).toEqual([]);
    expect(cockpit.winLoss?.winRate).toBeNull();
    expect(cockpit.winLoss?.wonCount).toBe(0);
  });

  it('counts a deal once when it is both won and lost, and lost wins', () => {
    // WHY: the fallback counted the same deal in won and in lost, so the
    // win rate and the revenue month both included a loss.
    const cockpit = buildCockpit(
      baseArgs([
        opp({
          stage: 'closed_won',
          pipelineStage: { isWon: true, isLost: true },
          valueMicros: 400_000_000_000n,
          dueDate: new Date('2026-03-01'),
        }),
        opp({
          stage: 's2_sent',
          pipelineStage: { isWon: true, isLost: false },
          valueMicros: 100_000_000_000n,
          dueDate: new Date('2026-03-15'),
        }),
      ]),
    );
    expect(cockpit.winLoss).toEqual({
      wonCount: 1,
      lostCount: 1,
      wonValueMicros: '100000000000',
      lostValueMicros: '400000000000',
      winRate: 50,
    });
    expect(cockpit.revenueEvolution).toEqual([
      { period: '2026-03', revenueMicros: '100000000000' },
    ]);
  });

  it('keeps a deleted lost stage in the open count', () => {
    // WHY: a removed stage row was still a loss, so the bid left the open book.
    const cockpit = buildCockpit(
      baseArgs([
        opp({
          stage: 's2_sent',
          pipelineStage: { isWon: false, isLost: true, deletedAt: new Date('2026-02-01') },
        }),
      ]),
    );
    expect(cockpit.kpis.find((kpi) => kpi.label === 'Open deals')?.value).toBe('1');
    expect(cockpit.winLoss?.lostCount).toBe(0);
    expect(cockpit.winLoss?.wonCount).toBe(0);
  });
});
