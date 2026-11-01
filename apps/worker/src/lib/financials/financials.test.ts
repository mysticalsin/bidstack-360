import { describe, expect, it } from 'vitest';

import { runFinancialsScan, syncFinancialsSchedule } from './scan.js';
import { buildVocab, detectFinancialSignals, findTextCues, fmtMoney, repairSplitWords, sentenceAround, type SignalPeriod } from './signals.js';
import { entityNameMatches, pacer, pullEdgar, pullEsef, type FinFetch } from './sources.js';
import { buildPeriods, derived, factsFromCompanyFacts, factsFromXbrlJson, filedAmount, type CompanyFacts, type XbrlJson } from './xbrl.js';

// ── fixtures (shapes copied from real EDGAR / filings.xbrl.org responses, numbers made up) ──

const companyFacts: CompanyFacts = {
  cik: 1829948,
  entityName: 'CI Financial Corp.',
  facts: {
    'ifrs-full': {
      Revenue: {
        units: {
          CAD: [
            { start: '2020-01-01', end: '2020-12-31', val: 2000, form: '40-F', filed: '2021-03-01' },
            { start: '2021-01-01', end: '2021-12-31', val: 2500, form: '40-F', filed: '2022-03-01' },
            { start: '2021-01-01', end: '2021-12-31', val: 2600, form: '40-F/A', filed: '2022-06-01' }, // restated
            { start: '2021-07-01', end: '2021-09-30', val: 640, form: '6-K', filed: '2021-11-01' }, // ignored form
          ],
        },
      },
      ProfitLossFromOperatingActivities: {
        units: { CAD: [{ start: '2020-01-01', end: '2020-12-31', val: 400, form: '40-F', filed: '2021-03-01' }, { start: '2021-01-01', end: '2021-12-31', val: 390, form: '40-F', filed: '2022-03-01' }] },
      },
      CashAndCashEquivalents: { units: { CAD: [{ end: '2021-12-31', val: 230, form: '40-F', filed: '2022-03-01' }] } },
      Borrowings: { units: { CAD: [{ end: '2020-12-31', val: 2000, form: '40-F', filed: '2021-03-01' }, { end: '2021-12-31', val: 3000, form: '40-F', filed: '2022-03-01' }] } },
      UnrelatedConcept: { units: { CAD: [{ start: '2021-01-01', end: '2021-12-31', val: 1, form: '40-F' }] } },
    },
  },
};

function esefDoc(year: number, vals: { revenue: number; op: number; capex: number; cash: number; segRevenue?: number }): XbrlJson {
  const y = String(year);
  const dur = `${y}-01-01T00:00:00/${year + 1}-01-01T00:00:00`;
  const inst = `${year + 1}-01-01T00:00:00`;
  const base = { entity: 'lei:549300GKFG0RYRRQ1414', unit: 'iso4217:EUR' };
  return {
    facts: {
      a: { value: String(vals.revenue), dimensions: { ...base, concept: 'ifrs-full:Revenue', period: dur } },
      b: { value: String(vals.op), dimensions: { ...base, concept: 'ifrs-full:ProfitLossFromOperatingActivities', period: dur } },
      c: { value: String(vals.capex), dimensions: { ...base, concept: 'ifrs-full:PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities', period: dur } },
      d: { value: String(vals.cash), dimensions: { ...base, concept: 'ifrs-full:CashAndCashEquivalents', period: inst } },
      // a segment-dimensioned fact must not overwrite the group total
      e: { value: String(vals.segRevenue ?? 1), dimensions: { ...base, concept: 'ifrs-full:Revenue', period: dur, 'ifrs-full:SegmentsAxis': 'x:Retail' } },
      t: { value: '<p>In March the acquisitio n of Claranet was c ompleted, strengthening the IT business.</p>', dimensions: { entity: base.entity, concept: 'ifrs-full:DisclosureOfGeneralInformationAboutFinancialStatementsExplanatory', period: dur } },
    },
  };
}

const P = (end: string, m: Record<string, number>, extra: Partial<SignalPeriod> = {}): SignalPeriod => ({
  periodType: 'FY',
  fiscalYear: Number(end.slice(0, 4)),
  periodStart: `${end.slice(0, 4)}-01-01`,
  periodEnd: end,
  currency: 'EUR',
  filedAt: `${Number(end.slice(0, 4)) + 1}-03-01T00:00:00.000Z`,
  sourceUrl: `https://example.test/${end}`,
  metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { value: v, concept: `ifrs-full:${k}` }])),
  ...extra,
});

// ── parsing ──

describe('xbrl parsing', () => {
  it('builds FY periods from EDGAR companyfacts, latest filing wins, foreign forms ignored', () => {
    const facts = factsFromCompanyFacts(companyFacts);
    expect(facts.some((f) => f.concept === 'ifrs-full:UnrelatedConcept')).toBe(false);
    const ps = buildPeriods(facts, { quarters: true });
    expect(ps.map((p) => `${p.periodType}:${p.periodEnd}`)).toEqual(['FY:2021-12-31', 'FY:2020-12-31']);
    expect(ps[0]!.metrics.revenue).toEqual({ value: 2600, concept: 'ifrs-full:Revenue' });
    expect(ps[0]!.metrics.cash?.value).toBe(230);
    expect(ps[0]!.metrics.debt?.value).toBe(3000);
    expect(ps[0]!.currency).toBe('CAD');
    expect(derived(ps[0]!.metrics).operatingMargin).toBe(15);
  });

  it('reads ESEF xBRL-JSON: exclusive period ends become inclusive dates, dimensioned facts skipped', () => {
    const facts = factsFromXbrlJson(esefDoc(2025, { revenue: 1000, op: 150, capex: 80, cash: 40, segRevenue: 999 }), '2026-03-20T00:00:00.000Z');
    const ps = buildPeriods(facts);
    expect(ps).toHaveLength(1);
    expect(ps[0]!.periodEnd).toBe('2025-12-31');
    expect(ps[0]!.periodStart).toBe('2025-01-01');
    expect(ps[0]!.metrics.revenue?.value).toBe(1000);
    expect(ps[0]!.metrics.cash?.value).toBe(40);
    expect(derived(ps[0]!.metrics)).toEqual({ operatingMargin: 15, netMargin: null, freeCashFlow: null });
  });

  it('omits a filing integer Number would round and keeps one it can hold', () => {
    // WHY: Number("9007199254740993") is 9007199254740992, which would be filed as revenue.
    expect(filedAmount('9007199254740993')).toBeNull();
    expect(filedAmount('90649000000')).toBe(90_649_000_000);
    const rounded = esefDoc(2025, { revenue: 1, op: 150, capex: 80, cash: 40 });
    rounded.facts.a!.value = '9007199254740993';
    const facts = factsFromXbrlJson(rounded, null);
    expect(facts.some((fact) => fact.concept === 'ifrs-full:Revenue')).toBe(false);
    expect(facts.find((fact) => fact.concept.endsWith('ProfitLossFromOperatingActivities'))?.value).toBe(150);
    const held = esefDoc(2025, { revenue: 1, op: 150, capex: 80, cash: 40 });
    held.facts.a!.value = '90649000000';
    expect(factsFromXbrlJson(held, null).find((fact) => fact.concept === 'ifrs-full:Revenue')?.value).toBe(90_649_000_000);
  });

  it('keeps one concept per metric across years when a filer retags a line', () => {
    const facts = [
      { concept: 'ifrs-full:Revenue', value: 100, unit: 'EUR', start: '2024-01-01', end: '2024-12-31', filed: 'a' },
      { concept: 'ifrs-full:Revenue', value: 120, unit: 'EUR', start: '2025-01-01', end: '2025-12-31', filed: 'b' },
      { concept: 'ifrs-full:AdministrativeExpense', value: 10, unit: 'EUR', start: '2025-01-01', end: '2025-12-31', filed: 'b' },
      { concept: 'ifrs-full:AdministrativeExpense', value: 9, unit: 'EUR', start: '2024-01-01', end: '2024-12-31', filed: 'b' },
      { concept: 'ifrs-full:OperatingExpense', value: 80, unit: 'EUR', start: '2024-01-01', end: '2024-12-31', filed: 'a' },
    ];
    const ps = buildPeriods(facts);
    expect(ps[1]!.metrics.opex?.concept).toBe(ps[0]!.metrics.opex?.concept);
  });
});

// ── signal rules ──

describe('fmtMoney', () => {
  it('keeps a filing amount when the compact label would move it', () => {
    // WHY: Math.round(7.86) printed 8m in the signal a seller reads.
    expect(fmtMoney(7_860_000, 'EUR')).toBe('EUR 7,860,000');
    expect(fmtMoney(2_000_000, 'EUR')).toBe('EUR 2m');
    expect(fmtMoney(1_000, 'EUR')).toBe('EUR 1k');
    expect(fmtMoney(90_649e6, 'NOK')).toBe('NOK 90,649,000,000');
    expect(fmtMoney(-156_444e6, 'NOK')).toBe('-NOK 156,444,000,000');
    expect(fmtMoney(Number.NaN, 'EUR')).toBe('amount not readable');
  });
});

describe('signal rules', () => {
  it('capex up 40% with a rising share reads as an expansion program', () => {
    const s = detectFinancialSignals([P('2025-12-31', { revenue: 1000, capex: 140 }), P('2024-12-31', { revenue: 1000, capex: 100 })]);
    const capex = s.find((x) => x.rule === 'capex_up');
    expect(capex?.title).toMatch(/Capex up 40%/);
    expect(capex?.confidence).toBe('medium');
    expect(capex?.sourceUrl).toBe('https://example.test/2025-12-31');
    expect(capex?.implication).toBe('OPPORTUNITY');
  });

  it('no signal on flat numbers or on a single period', () => {
    expect(detectFinancialSignals([P('2025-12-31', { revenue: 1000, capex: 100, operatingIncome: 100 }), P('2024-12-31', { revenue: 1000, capex: 100, operatingIncome: 100 })])).toEqual([]);
    expect(detectFinancialSignals([P('2025-12-31', { revenue: 1000, capex: 400 })])).toEqual([]);
  });

  it('margin squeeze is high confidence when restructuring charges are booked', () => {
    const s = detectFinancialSignals([
      P('2025-12-31', { revenue: 1000, operatingIncome: 160, restructuring: 11 }),
      P('2024-12-31', { revenue: 1000, operatingIncome: 220, restructuring: 11 }),
    ]);
    const m = s.find((x) => x.rule === 'margin_squeeze');
    expect(m?.confidence).toBe('high');
    expect(m?.implication).toBe('RISK');
  });

  it('debt jump, impairment and acquisitions fire on their thresholds', () => {
    const s = detectFinancialSignals([
      P('2025-12-31', { revenue: 1000, debt: 1400, impairment: 30, acquisitions: 90 }),
      P('2024-12-31', { revenue: 1000, debt: 1000 }),
    ]);
    expect(s.map((x) => x.rule).sort()).toEqual(['acquisitions', 'debt_jump', 'impairment']);
    expect(s.every((x) => x.explanation.length > 20 && !x.explanation.includes('\u2014'))).toBe(true);
  });

  it('text cues survive words split by PDF conversion, and skip tables and policy boilerplate', () => {
    const cues = findTextCues([
      { concept: 'ifrs-full:DisclosureOfMaterialAccountingPolicyInformationExplanatory', text: 'Unusual costs are: business restructuring programmes and indemnities.' },
      { concept: 'ifrs-full:DisclosureOfProvisionsExplanatory', text: 'Restructuring programme 25,542 39,878 24,241 29,546 11,000 12,000 13,000 14,000' },
      { concept: 'ifrs-full:DisclosureOfGeneralInformationAboutFinancialStatementsExplanatory', text: 'On 17 March 2025, NOS acquired the entire share capi tal of Claranet Portugal Group. Other text.' },
      { concept: 'x:Outlook', text: 'Given weaker demand, the Board lowered its full-year guidance for 2026.' },
    ]);
    expect(cues.map((c) => c.rule).sort()).toEqual(['acquisitions', 'guidance_cut']);
    expect(cues.find((c) => c.rule === 'acquisitions')?.snippet).toContain('Claranet Portugal Group');
    const s = detectFinancialSignals([P('2025-12-31', { revenue: 1 }), P('2024-12-31', { revenue: 1 })], cues, 'https://example.test/report');
    const g = s.find((x) => x.rule === 'guidance_cut');
    expect(g?.snippet).toContain('lowered its full-year guidance');
    expect(g?.sourceUrl).toBe('https://example.test/report');
  });

  it('repairs words split by PDF conversion in snippets (NOS 2025 report example)', () => {
    const nos = [
      { concept: 'ifrs-full:DisclosureOfGeneralInformationAboutFinancialStatementsExplanatory',
        text: 'On 17 Ma rch 2025, NOS acquired the entire share capi tal of C laranet Por tugal Group. Other text.' },
      { concept: 'ifrs-full:DisclosureOfBusinessCombinationsExplanatory',
        text: 'Claranet Portugal provides cloud services in Portugal. The share capital of Claranet was paid in cash. Capital increase in March.' },
    ];
    const cue = findTextCues(nos).find((c) => c.rule === 'acquisitions');
    expect(cue?.snippet).toBe('On 17 March 2025, NOS acquired the entire share capital of Claranet Portugal Group.');
    const v = buildVocab(['the investment into the company, in to the market, a man and a plan; acquisition of the acquisition target']);
    // real word pairs stay apart, hyphen line breaks and stray spaces are fixed
    expect(repairSplitWords('invested in to  new  plants , a man', v)).toBe('invested in to new plants, a man');
    expect(repairSplitWords('the acquisi-\n tion was completed', v)).toBe('the acquisition was completed');
    expect(repairSplitWords('the acqui si tion of X', v)).toBe('the acquisition of X');
    // unknown joins are left alone rather than guessed
    expect(repairSplitWords('Zorg plex Ltd', v)).toBe('Zorg plex Ltd');
  });

  it('sentenceAround returns null for numeric tables', () => {
    expect(sentenceAround('12 13 14 15 16 17 18 19 20 21 22 23 24 restructuring 25 26 27 28 29', 39, 52)).toBeNull();
  });
});

// ── homonyms / identifiers ──

describe('identifier mapping and homonyms', () => {
  it('matches the filer behind the CIK or LEI by name, not namesakes', () => {
    expect(entityNameMatches('DNB Bank', 'DNB BANK ASA')).toBe(true);
    expect(entityNameMatches('MAPFRE', 'MAPFRE S.A.')).toBe(true);
    expect(entityNameMatches('NOS', 'NOS, SGPS, S.A.')).toBe(true);
    expect(entityNameMatches('CI Financial', 'CI Financial Corp.')).toBe(true);
    expect(entityNameMatches('Rush University System for Health', 'RUSH ENTERPRISES INC')).toBe(false);
    expect(entityNameMatches('MAPFRE', 'MAPFRE MALTA P.L.C.')).toBe(true); // name alone is ambiguous...
  });

  it('...so pulls go by the LEI set on the account, never by name search', async () => {
    const urls: string[] = [];
    const f: FinFetch = async (url) => {
      urls.push(url);
      if (url.endsWith('/api/entities/95980020140005693107')) return { ok: true, status: 200, json: async () => ({ data: { attributes: { name: 'MAPFRE S.A.' } } }) };
      if (url.includes('/filings?')) return { ok: true, status: 200, json: async () => ({ data: [{ attributes: { period_end: '2025-12-31', date_added: '2026-03-01 10:00:00', json_url: '/x/2025.json', report_url: '/x/2025.xhtml' } }] }) };
      return { ok: true, status: 200, json: async () => esefDoc(2025, { revenue: 26352, op: 2000, capex: 65, cash: 1947 }) };
    };
    const e = await pullEsef('95980020140005693107', { fetchImpl: f, userAgent: 'Test (t@example.test)', pace: async () => {} });
    expect(urls.every((u) => !/search|name=/i.test(u))).toBe(true);
    expect(urls[0]).toContain('95980020140005693107');
    expect(urls).not.toContain(expect.stringContaining('213800KY94NQYH4IZU83'));
    expect(e.entityName).toBe('MAPFRE S.A.');
    expect(buildPeriods(e.facts)[0]!.metrics.revenue?.value).toBe(26352);
  });

  it('EDGAR requires a contact email in the User-Agent and pads the CIK', async () => {
    const seen: Array<{ url: string; ua?: string }> = [];
    const f: FinFetch = async (url, init) => {
      seen.push({ url, ua: init?.headers?.['User-Agent'] });
      return { ok: true, status: 200, json: async () => companyFacts };
    };
    await expect(pullEdgar('1829948', { fetchImpl: f, userAgent: 'NoContact', pace: async () => {} })).rejects.toThrow(/contact email/);
    await pullEdgar('1829948', { fetchImpl: f, userAgent: 'Polo (ops@example.test)', pace: async () => {} });
    expect(seen[0]).toEqual({ url: 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001829948.json', ua: 'Polo (ops@example.test)' });
  });

  it('pacer keeps calls apart', async () => {
    const waits: number[] = [];
    const pace = pacer(150, async (ms) => void waits.push(ms));
    await pace();
    await pace();
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(100);
  });
});

// ── tier gating (in-memory db) ──

type Row = Record<string, unknown>;
function fakeDb(companies: Row[], subjects: Row[] = []) {
  const profiles: Row[] = [];
  const periods: Row[] = [];
  const events: Row[] = [];
  const eligible = (c: Row) => !c.deletedAt && (['key', 'top'].includes(c.tier as string) || c.topAccountRank != null || c.trackFinancials === true);
  const byOrg = (w: Row | undefined) => (r: Row) => !w?.orgId || r.orgId === w.orgId;
  const db = {
    company: { findMany: async ({ where }: { where: Row }) => companies.filter(byOrg(where)).filter(eligible).map((c) => ({ id: c.id, orgId: c.orgId })) },
    accountFinancialProfile: {
      findMany: async ({ where, select }: { where?: Row; select?: Row }) => {
        let rows = profiles.filter(byOrg(where));
        if (where?.nextPullAt) rows = rows.filter((p) => p.nextPullAt && (p.nextPullAt as Date) <= ((where.nextPullAt as Row).lte as Date));
        if (where?.company) rows = rows.filter((p) => eligible(companies.find((c) => c.id === p.companyId)!));
        return rows.map((p) => (select && 'company' in select ? { ...p, company: companies.find((c) => c.id === p.companyId) } : { ...p }));
      },
      create: async ({ data }: { data: Row }) => void profiles.push({ lastPulledAt: null, ...data }),
      update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(profiles.find((p) => p.companyId === where.companyId)!, data),
      updateMany: async ({ where, data }: { where: { companyId: { in: string[] } }; data: Row }) => {
        for (const p of profiles) if (where.companyId.in.includes(p.companyId as string)) Object.assign(p, data);
      },
    },
    accountFinancialPeriod: { upsert: async ({ create }: { create: Row }) => void periods.push(create) },
    accountWatchSubject: { findFirst: async ({ where }: { where: Row }) => subjects.find((s) => s.companyId === where.companyId) ?? null },
    accountWatchEvent: { findFirst: async () => null, update: async () => ({}), create: async ({ data }: { data: Row }) => void events.push(data) },
    accountEarningsDate: { findFirst: async () => null },
  };
  return { db: db as never, profiles, periods, events };
}

const now = new Date('2026-11-01T05:00:00Z');
const companies = (): Row[] => [
  { id: 'strategic', orgId: 'o', name: 'DNB Bank', tier: 'key', topAccountRank: null, trackFinancials: false, deletedAt: null },
  { id: 'top', orgId: 'o', name: 'CI Financial', tier: 'top', topAccountRank: null, trackFinancials: false, deletedAt: null },
  { id: 'general', orgId: 'o', name: 'MAHLE', tier: 'standard', topAccountRank: null, trackFinancials: false, deletedAt: null },
  { id: 'optin', orgId: 'o', name: 'NOS', tier: 'standard', topAccountRank: null, trackFinancials: true, deletedAt: null },
];

describe('tier gating', () => {
  it('schedules Strategic, Top and opted-in accounts only', async () => {
    const f = fakeDb(companies());
    const r = await syncFinancialsSchedule(f.db, now);
    expect(r).toEqual({ scheduled: 3, paused: 0 });
    expect(f.profiles.map((p) => p.companyId).sort()).toEqual(['optin', 'strategic', 'top']);
  });

  it('a tier change to General pauses the job; back to Top re-arms it', async () => {
    const cs = companies();
    const f = fakeDb(cs);
    await syncFinancialsSchedule(f.db, now);
    cs[1]!.tier = 'standard';
    expect(await syncFinancialsSchedule(f.db, now)).toEqual({ scheduled: 0, paused: 1 });
    expect(f.profiles.find((p) => p.companyId === 'top')).toMatchObject({ status: 'paused', nextPullAt: null });
    cs[1]!.tier = 'top';
    expect(await syncFinancialsSchedule(f.db, now)).toEqual({ scheduled: 1, paused: 0 });
    expect(f.profiles.find((p) => p.companyId === 'top')).toMatchObject({ status: 'pending', nextPullAt: now });
  });

  it('turning Track financials off stops a General account', async () => {
    const cs = companies();
    const f = fakeDb(cs);
    await syncFinancialsSchedule(f.db, now);
    cs[3]!.trackFinancials = false;
    expect((await syncFinancialsSchedule(f.db, now)).paused).toBe(1);
  });

  it('never fetches for a General account, even one with a CIK', async () => {
    const urls: string[] = [];
    const fetchImpl: FinFetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => companyFacts };
    };
    const f = fakeDb(companies().filter((c) => c.id !== 'optin'), [
      { companyId: 'general', secCik: '0000000999', lei: null },
      { companyId: 'top', secCik: '0001829948', lei: null },
    ]);
    const s = await runFinancialsScan({ db: f.db, now, fetchImpl, env: { SEC_USER_AGENT: 'Polo test (ops@example.test)' }, sleep: async () => {} });
    expect(urls.some((u) => u.includes('0000000999'))).toBe(false);
    expect(s.pulled.find((p) => p.companyId === 'general')).toBeUndefined();
    const top = s.pulled.find((p) => p.companyId === 'top');
    expect(top).toMatchObject({ status: 'ok', source: 'sec_edgar', periods: 2 });
    expect(s.pulled.find((p) => p.companyId === 'strategic')?.status).toBe('no_identifier');
    expect(f.periods.every((p) => p.companyId === 'top')).toBe(true);
    // debt +50% on CI fixture becomes a watchdog event with a link
    expect(f.events.some((e) => e.source === 'financials' && String(e.title).includes('Debt up 50%'))).toBe(true);
  });

  it('a namesake filer is stored as mismatch, with no periods', async () => {
    const cs: Row[] = [{ id: 'rush', orgId: 'o', name: 'Rush University System for Health', tier: 'key', topAccountRank: null, trackFinancials: false, deletedAt: null }];
    const f = fakeDb(cs, [{ companyId: 'rush', secCik: '1012019', lei: null }]);
    const fetchImpl: FinFetch = async () => ({ ok: true, status: 200, json: async () => ({ ...companyFacts, entityName: 'RUSH ENTERPRISES INC' }) });
    const s = await runFinancialsScan({ db: f.db, now, fetchImpl, env: { SEC_USER_AGENT: 'Polo test (ops@example.test)' }, sleep: async () => {} });
    expect(s.pulled[0]).toMatchObject({ status: 'mismatch', periods: 0 });
    expect(f.periods).toHaveLength(0);
    expect(f.profiles[0]).toMatchObject({ status: 'mismatch' });
  });
});
