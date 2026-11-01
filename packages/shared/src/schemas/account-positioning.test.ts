import { describe, expect, it } from 'vitest';

import {
  buildGaps,
  buildPlays,
  composeBrief,
  dealRangeFor,
  pickNotableSignal,
  openJobsCopy,
  pickApproach,
  readCoversWindow,
  seniorityFromTitle,
  sentimentCopy,
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
    expect(gaps.find((g) => g.kind === 'senior_contacts')?.title).toBe('No senior contacts mapped');
  });

  it('does not treat a full people page as an empty buying group', () => {
    // WHY: the latest 1,000 contacts can omit a CFO, and the gap must not say none exist.
    const gaps = buildGaps({
      people: [person('Bo', 'Analyst')],
      lastMeetingAt: null,
      momentum: null,
      openDeals: 1,
      riskEvents: [],
      competitorMentions: [],
      financialRisks: [],
      financialStaleFy: null,
      financialSource: null,
      peoplePage: { contacts: true, meetings: true },
      now,
    });
    const senior = gaps.find((g) => g.kind === 'senior_contacts');
    expect(senior?.title).toBe('No senior contacts on the latest page');
    expect(senior?.severity).toBe('medium');
  });

  it('does not call a capped meeting page a full year of silence', () => {
    // WHY: the latest 200 meetings can miss an earlier meeting with the CFO.
    const gaps = buildGaps({
      people: [person('Cy', 'Chief Information Officer')],
      lastMeetingAt: '2026-10-01T00:00:00Z',
      momentum: null,
      openDeals: 1,
      riskEvents: [],
      competitorMentions: [],
      financialRisks: [],
      financialStaleFy: null,
      financialSource: null,
      peoplePage: { meetings: true },
      now,
    });
    expect(gaps.find((g) => g.kind === 'senior_contacts')?.title).toBe('1 senior contact, none met in the latest 200 meetings');
  });

  it('does not treat the latest risk page as every risk event', () => {
    // WHY: twenty leadership items hid an older layoff, and silence read as an all-clear.
    const gaps = buildGaps({
      people: [person('Cy', 'Chief Information Officer', true, '2026-10-01T00:00:00Z')],
      lastMeetingAt: '2026-10-01T00:00:00Z',
      momentum: null,
      openDeals: 1,
      riskEvents: [{ kind: 'LEADERSHIP_CHANGE', title: 'New CFO', at: '2026-10-01', url: null, source: 'News', sample: false }],
      competitorMentions: [{ competitor: 'Accenture', title: 'Won the desk', at: '2026-10-01', url: null, source: 'Competitor intel' }],
      financialRisks: [],
      financialStaleFy: null,
      financialSource: null,
      riskPageCapped: true,
      competitorPageCapped: true,
      now,
    });
    expect(gaps.find((g) => g.kind === 'leadership_change')?.detail).toContain('latest 20 risk events');
    expect(gaps.find((g) => g.kind === 'competitor')?.detail).toContain('Latest 10 mentions');
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

  it('names the highest-importance signal instead of calling it the latest', () => {
    // WHY: the row is the highest importance in 180 days, which can be older than a newer quieter event.
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
      topSignal: { title: 'Plant closure', at: '2026-06-01T00:00:00Z', source: 'GDELT news', sample: false },
    };
    const txt = composeBrief(f, (v) => String(v), (m) => m);
    expect(txt).toContain('Highest-importance signal in the last 180 days: Plant closure');
    expect(txt).not.toContain('Latest notable');
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

  it('says when the already-sold check stopped at 5000 solutions', () => {
    // WHY: a solution past the read limit left the theme looking unsold.
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
      solutionsCapped: true,
    };
    expect(composeBrief(f, (v) => String(v), (m) => m)).toContain('latest 5,000 solutions');
  });

  it('states people counts as a lower bound when a page is full', () => {
    // WHY: "we know 4 people" was the latest contacts page, read as the buying group.
    const f: BriefFacts = {
      name: 'NOS',
      tierLabel: 'Strategic',
      industry: null,
      country: null,
      employees: null,
      momentum: null,
      financials: null,
      pipeline: { openCount: 0, openMicros: '0', won24m: 0, lost24m: 0 },
      people: { known: 4, senior: 1, metLast12m: 1, lastMeeting: null },
      topSignal: null,
      peoplePage: { contacts: true },
    };
    const txt = composeBrief(f, (v) => String(v), (m) => m);
    expect(txt).toContain('We know at least 4 people there (at least 1 senior), at least 1 met in the last 12 months');
    expect(txt).toContain('People counts use the latest 1,000 contacts.');
    expect(txt).not.toContain('No contacts are mapped yet.');
  });
});

describe('readCoversWindow', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const daysAgo = (n: number) => now - n * 86_400_000;

  it('treats unread older weeks as missing when the page is full', () => {
    // WHY: a newest-1,000 page of this month is not a quiet prior quarter.
    expect(readCoversWindow([daysAgo(3), daysAgo(10)], now, 90, true)).toBe(false);
    expect(readCoversWindow([daysAgo(3), daysAgo(200)], now, 180, true)).toBe(true);
    expect(readCoversWindow([], now, 90, false)).toBe(true);
  });
});

describe('key number page copy', () => {
  it('withholds the hiring trend when the latest posts do not reach 90 days', () => {
    // WHY: the open-jobs arrow compared a full page with weeks that were never read.
    const partial = openJobsCopy(true, false, false, null);
    expect(partial.period).toContain('past the latest 1,000 posts');
    expect(partial.sub).toBe('latest 1,000 posts');
    expect(openJobsCopy(true, true, false, 12).period).toContain('past this page');
    expect(openJobsCopy(false, true, true, 12).sub).toBe('12 posted in 90 days');
  });

  it('withholds the sentiment comparison when the prior window was not read', () => {
    // WHY: the mean of the newest 1,000 items was labelled as the last 90 days against the 90 before.
    const partial = sentimentCopy(true, false, false, 1000);
    expect(partial.compare).toBe(false);
    expect(partial.period).toContain('not the full 90 days');
    const recentOnly = sentimentCopy(true, true, false, 40);
    expect(recentOnly.compare).toBe(false);
    expect(recentOnly.period).toContain('past this page');
    expect(sentimentCopy(false, true, true, 4).compare).toBe(true);
  });
});

describe('pickNotableSignal', () => {
  const at = (day: number) => new Date(`2026-06-${String(day).padStart(2, '0')}T00:00:00Z`);

  it('lets an unscored severe event outrank a small stored importance', () => {
    // WHY: importance 1 was chosen over a severity-5 event whose importance was never set.
    const mild = { title: 'Sponsors a marathon', importance: 1, severity: 0, occurredAt: at(20) };
    const severe = { title: 'Plant closure', importance: 0, severity: 5, occurredAt: at(2) };
    expect(pickNotableSignal(mild, severe)?.title).toBe('Plant closure');
  });

  it('keeps a high stored importance ahead of a milder unscored event', () => {
    // WHY: severity only fills in when importance is unset. Importance 90 beats severity 2, which scores 40.
    const ranked = { title: 'Guidance cut', importance: 90, severity: 1, occurredAt: at(2) };
    const milder = { title: 'Office move', importance: 0, severity: 2, occurredAt: at(20) };
    expect(pickNotableSignal(ranked, milder)?.title).toBe('Guidance cut');
  });

  it('breaks a tied score toward the newer event', () => {
    const older = { title: 'Older', importance: 40, severity: 0, occurredAt: at(2) };
    const newer = { title: 'Newer', importance: 40, severity: 0, occurredAt: at(18) };
    expect(pickNotableSignal(older, newer)?.title).toBe('Newer');
    expect(pickNotableSignal(null, null)).toBeNull();
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
