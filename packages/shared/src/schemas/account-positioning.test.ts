import { describe, expect, it } from 'vitest';

import {
  buildGaps,
  buildPlays,
  composeBrief,
  dealRangeFor,
  pickApproach,
  seniorityFromTitle,
  type BriefFacts,
  type KnownPerson,
} from './account-positioning.js';
import { themeForText, type Initiative } from './account-signals.js';

const now = new Date('2026-11-01T12:00:00Z');
const person = (name: string, title: string, met = false, lastMetAt: string | null = null): KnownPerson => ({ name, title, seniority: seniorityFromTitle(title), met, lastMetAt, source: 'contact' });

const initiative = (over: Partial<Initiative> = {}): Initiative => ({
  id: 'i1',
  title: 'Cloud migration programme',
  theme: 'cloud',
  themeLabel: 'Cloud',
  rationale: 'Hiring and news',
  confidence: 'medium',
  confidenceScore: 0.6,
  firstSeen: '2026-08-01T00:00:00Z',
  lastSeen: '2026-10-01T00:00:00Z',
  evidence: [{ kind: 'hiring', title: 'Cloud architect', url: null, at: '2026-10-01T00:00:00Z', source: 'Job board', sample: false }],
  hook: { offering: 'x', pitch: 'Pitch.', nextStep: 'Book a workshop.', alreadySold: false },
  sample: false,
  ...over,
});

describe('seniorityFromTitle', () => {
  it('reads levels from free text', () => {
    expect(seniorityFromTitle('Chief Financial Officer')).toBe('c_level');
    expect(seniorityFromTitle('VP Engineering')).toBe('vp');
    expect(seniorityFromTitle('Head of Data')).toBe('vp');
    expect(seniorityFromTitle('IT Director')).toBe('director');
    expect(seniorityFromTitle('Procurement Manager')).toBe('manager');
    expect(seniorityFromTitle('Analyst')).toBe('ic');
    expect(seniorityFromTitle(null)).toBe('unknown');
  });
});

describe('pickApproach', () => {
  it('prefers role fit, then seniority, and flags a missing role', () => {
    const people = [person('Ana CFO', 'Chief Financial Officer', true, '2026-09-01T00:00:00Z'), person('Bo', 'Analyst'), person('Cy CIO', 'Chief Information Officer')];
    const r = pickApproach('cloud', people, now);
    expect(r.approach[0]!.name).toBe('Cy CIO');
    expect(r.gap).toBeNull();
    const fin = pickApproach('cyber', [person('Bo', 'Analyst')], now);
    expect(fin.approach).toHaveLength(0);
    expect(fin.gap).toMatch(/CISO/);
  });
});

describe('dealRangeFor', () => {
  it('uses org-wide on-theme wins first, then account wins, else null', () => {
    const won = [1, 2, 3, 4].map((m) => ({ name: 'Cloud migration', valueMicros: BigInt(m * 1_000_000) * 1_000_000n, here: false }));
    const r = dealRangeFor('cloud', won, themeForText);
    expect(r?.deals).toBe(4);
    expect(BigInt(r!.lowMicros) <= BigInt(r!.highMicros)).toBe(true);
    const here = [{ name: 'Payroll', valueMicros: 5_000_000n, here: true }, { name: 'Audit', valueMicros: 9_000_000n, here: true }];
    expect(dealRangeFor('cyber', here, themeForText)).toMatchObject({ lowMicros: '5000000', highMicros: '9000000', deals: 2 });
    expect(dealRangeFor('cyber', [here[0]!], themeForText)).toBeNull();
  });

  it('names the sample when the wins are not the whole book', () => {
    // WHY: a silent take of 1000 was described as every won deal in the pipeline.
    const won = [1, 2, 3, 4].map((m) => ({ name: 'Cloud migration', valueMicros: BigInt(m * 1_000_000) * 1_000_000n, here: false }));
    const ranged = dealRangeFor('cloud', won, themeForText, 1000);
    expect(ranged?.basis).toContain('latest 1000');
    expect(ranged?.basis).not.toContain('your pipeline');
    const here = [{ name: 'Payroll', valueMicros: 5_000_000n, here: true }, { name: 'Audit', valueMicros: 9_000_000n, here: true }];
    expect(dealRangeFor('cyber', here, themeForText, 1000)?.basis).toContain('latest 1000');
  });
});

describe('buildPlays', () => {
  it('ranks real plays, merges financial evidence and caps at three', () => {
    const plays = buildPlays({
      initiatives: [initiative(), initiative({ id: 'i2', theme: 'data_ai', title: 'Data platform', confidenceScore: 0.9, sample: true })],
      financialSignals: [
        { rule: 'margin_squeeze', title: 'Operating margin down 3 pts', confidence: 'high', periodEnd: '2025-12-31', sourceUrl: 'https://example.test/f', sample: false },
        { rule: 'capex_up', title: 'Capex up 40%', confidence: 'medium', periodEnd: '2025-12-31', sourceUrl: '', sample: false },
        { rule: 'text_cue', title: 'ignored', confidence: 'low', periodEnd: '2025-12-31', sourceUrl: '', sample: false },
      ],
      financialSource: 'ESEF',
      people: [person('Cy', 'CIO', true, '2026-10-01T00:00:00Z'), person('Fi', 'CFO')],
      won: [],
      themeOf: themeForText,
      now,
    });
    expect(plays).toHaveLength(3);
    expect(plays.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(plays.some((p) => p.sample)).toBe(false);
    const fin = plays.find((p) => p.theme === 'erp_finance')!;
    expect(fin.whyNow[0]).toMatchObject({ kind: 'financial', anchor: 'financial-health', url: 'https://example.test/f', source: 'ESEF' });
    expect(fin.approach[0]!.name).toBe('Fi');
    expect(fin.dealRange).toBeNull();
    const cloud = plays.find((p) => p.theme === 'cloud')!;
    expect(cloud.firstStep).toContain('Cy');
    expect(cloud.talkingPoints.some((t) => t.includes('Oct 2026'))).toBe(true);
  });
});

describe('buildGaps', () => {
  it('flags missing seniors, stale meetings, decline and restructuring', () => {
    const gaps = buildGaps({
      people: [person('Bo', 'Analyst')],
      lastMeetingAt: '2026-03-01T00:00:00Z',
      momentum: { score: 40, delta: -22, trend: 'declining', sample: false },
      openDeals: 0,
      riskEvents: [{ kind: 'RESTRUCTURING', title: 'Plant closure', at: '2026-10-01', url: null, source: 'News', sample: false }],
      competitorMentions: [],
      financialRisks: [],
      financialStaleFy: null,
      financialSource: null,
      now,
    });
    expect(gaps.map((g) => g.kind)).toEqual(expect.arrayContaining(['senior_contacts', 'no_recent_meeting', 'declining_momentum', 'restructuring', 'no_pipeline']));
    expect(gaps.find((g) => g.kind === 'no_pipeline')?.title).toBe('No open pipeline');
    expect(gaps[0]!.severity).toBe('high');
  });

  it('does not call a full sample an empty account', () => {
    // WHY: zero open rows inside the latest 500 is not proof the account has no pipeline.
    const gaps = buildGaps({
      people: [],
      lastMeetingAt: null,
      momentum: null,
      openDeals: 0,
      riskEvents: [],
      competitorMentions: [],
      financialRisks: [],
      financialStaleFy: null,
      financialSource: null,
      dealSampleLimit: 500,
      now,
    });
    expect(gaps.find((g) => g.kind === 'no_pipeline')?.title).toBe('No open deal in the latest sample');
  });
});

describe('composeBrief', () => {
  it('only states the facts given', () => {
    const f: BriefFacts = {
      name: 'NOS',
      tierLabel: 'Strategic',
      industry: 'Telecom',
      country: 'PT',
      employees: null,
      momentum: { score: 62, delta: 4, trend: 'gaining', sample: false },
      financials: { fiscalYear: 2024, source: 'ESEF', currency: 'EUR', revenue: 1_700_000_000, revenueYoY: 5.2, marginLabel: 'Operating margin', margin: 18.3, marginDelta: -1.1, stale: false },
      pipeline: { openCount: 0, openMicros: '0', won24m: 1, lost24m: 0 },
      people: { known: 0, senior: 0, metLast12m: 0, lastMeeting: null },
      topSignal: null,
    };
    const txt = composeBrief(f, (v, c) => `${c} ${(v / 1e9).toFixed(1)}bn`, (m) => m);
    expect(txt).toContain('NOS is a Strategic account in Telecom, based in PT.');
    expect(txt).toContain('EUR 1.7bn in FY2024 (up 5% on the year), operating margin 18.3% (-1.1 pts)');
    expect(txt).toContain('no open deals; 1 won and 0 lost');
    expect(txt).not.toContain('latest');
    expect(txt).toContain('No contacts are mapped yet.');
    expect(txt).not.toMatch(/employees/);
    expect(txt).not.toContain('\u2014');
  });

  it('names the sample when the open count is not the whole book', () => {
    // WHY: a silent take of 500 was read aloud as every open deal.
    const f: BriefFacts = {
      name: 'NOS',
      tierLabel: 'Strategic',
      industry: null,
      country: null,
      employees: null,
      momentum: null,
      financials: null,
      pipeline: { openCount: 2, openMicros: '100', won24m: 0, lost24m: 0, latest: 500 },
      people: { known: 0, senior: 0, metLast12m: 0, lastMeeting: null },
      topSignal: null,
    };
    const txt = composeBrief(f, (v) => String(v), (m) => m);
    expect(txt).toContain('2 open deals worth 100 among the latest 500 deals');
  });

  it('says when subsidiary figures are a page of children', () => {
    // WHY: a parent with more than 1,000 subsidiaries was described as the whole group.
    const f: BriefFacts = {
      name: 'NOS',
      tierLabel: 'Strategic',
      industry: null,
      country: null,
      employees: null,
      momentum: null,
      financials: null,
      pipeline: { openCount: 0, openMicros: '0', won24m: 0, lost24m: 0 },
      people: { known: 0, senior: 0, metLast12m: 0, lastMeeting: null },
      topSignal: null,
      subsidiariesCapped: true,
    };
    expect(composeBrief(f, (v) => String(v), (m) => m)).toContain('latest 1,000 direct subsidiaries');
  });

  it('says when initiative evidence is a page', () => {
    // WHY: the latest 100 news items and meetings were read as the whole year.
    const f: BriefFacts = {
      name: 'NOS',
      tierLabel: 'Strategic',
      industry: null,
      country: null,
      employees: null,
      momentum: null,
      financials: null,
      pipeline: { openCount: 0, openMicros: '0', won24m: 0, lost24m: 0 },
      people: { known: 0, senior: 0, metLast12m: 0, lastMeeting: null },
      topSignal: null,
      evidenceCapped: true,
    };
    expect(composeBrief(f, (v) => String(v), (m) => m)).toContain('latest 100 news items and meetings');
  });
});

describe('labels', () => {
  it('keeps acronyms and humanises industries', async () => {
    const { lowerLabel, humanIndustry } = await import('./account-positioning.js');
    expect(lowerLabel('M&A integration')).toBe('M&A integration');
    expect(lowerLabel('ERP and finance transformation')).toBe('ERP and finance transformation');
    expect(lowerLabel('Data and AI')).toBe('data and AI');
    expect(humanIndustry('financial_services')).toBe('financial services');
  });
});
