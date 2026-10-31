import { describe, expect, it, vi } from 'vitest';

import { classifyCompaniesHouseFiling, classifySecFiling } from './classify.js';
import { detectAccountEvents, type WatchdogStore } from './detect.js';
import { edgarSubmissionsUrl, fetchEdgarEvents, normaliseEdgarSubmissions, type EdgarSubmissions } from './edgar.js';

const FIXTURE: EdgarSubmissions = {
  cik: '0000320193',
  name: 'Example Corp',
  filings: {
    recent: {
      accessionNumber: ['0000320193-26-000101', '0000320193-26-000100', '0000320193-26-000099', '0000320193-26-000098', '0000320193-26-000050'],
      filingDate: ['2026-10-30', '2026-10-29', '2026-10-15', '2026-10-10', '2026-08-01'],
      reportDate: ['2026-10-30', '2026-09-30', '', '', '2026-06-30'],
      form: ['8-K', '10-Q', '8-K', '4', '10-K'],
      items: ['2.02,9.01', '', '5.02', '', ''],
      primaryDocument: ['ex8k.htm', 'q3.htm', 'exec.htm', 'f4.xml', 'k.htm'],
    },
  },
};

describe('watchdog classifier', () => {
  it.each([
    ['10-K', [], 'ANNUAL_REPORT', 'NEUTRAL'],
    ['10-K/A', [], 'ANNUAL_REPORT', 'NEUTRAL'],
    ['10-Q', [], 'QUARTERLY_REPORT', 'NEUTRAL'],
    ['8-K', ['2.02'], 'EARNINGS_RELEASE', 'NEUTRAL'],
    ['8-K', ['2.01'], 'M_AND_A', 'OPPORTUNITY'],
    ['8-K', ['2.05'], 'RESTRUCTURING', 'RISK'],
    ['8-K', ['5.02'], 'LEADERSHIP_CHANGE', 'OPPORTUNITY'],
    ['8-K', ['7.01', '1.03'], 'INSOLVENCY', 'RISK'],
    ['8-K', ['9.01'], 'OTHER_DISCLOSURE', 'NEUTRAL'],
    ['SC 13D', [], 'M_AND_A', 'OPPORTUNITY'],
  ])('%s %j → %s / %s', (form, items, kind, implication) => {
    const c = classifySecFiling(form, items as string[]);
    expect(c.kind).toBe(kind);
    expect(c.implication).toBe(implication);
    expect(c.rationale.length).toBeGreaterThan(0);
  });

  it('maps Companies House codes', () => {
    expect(classifyCompaniesHouseFiling('AA').kind).toBe('ANNUAL_REPORT');
    expect(classifyCompaniesHouseFiling('TM01').kind).toBe('LEADERSHIP_CHANGE');
    expect(classifyCompaniesHouseFiling('LIQ02')).toMatchObject({ kind: 'INSOLVENCY', implication: 'RISK', severity: 5 });
  });
});

describe('EDGAR adapter (fixture, no network)', () => {
  it('normalises filings, drops noise forms, builds archive URLs and honours since', () => {
    const all = normaliseEdgarSubmissions(FIXTURE);
    expect(all.map((e) => e.kind)).toEqual(['EARNINGS_RELEASE', 'QUARTERLY_REPORT', 'LEADERSHIP_CHANGE', 'ANNUAL_REPORT']);
    expect(all[0]!.sourceUrl).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000101/ex8k.htm');
    expect(all[0]!.externalId).toBe('0000320193-26-000101');
    expect(all.every((e) => e.sourceUrl.startsWith('https://www.sec.gov/'))).toBe(true);
    const recent = normaliseEdgarSubmissions(FIXTURE, new Date('2026-10-20T00:00:00Z'));
    expect(recent).toHaveLength(2);
  });

  it('requires a contactable User-Agent and sends it', async () => {
    await expect(fetchEdgarEvents('320193', { userAgent: 'polo' })).rejects.toThrow(/contact email/);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => FIXTURE }));
    const ev = await fetchEdgarEvents('320193', { userAgent: 'Polo test ops@example.test', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(edgarSubmissionsUrl('320193'), {
      headers: { 'User-Agent': 'Polo test ops@example.test', Accept: 'application/json' },
    });
    expect(edgarSubmissionsUrl('320193')).toBe('https://data.sec.gov/submissions/CIK0000320193.json');
    expect(ev).toHaveLength(4);
  });

  it('marks 429 as retryable', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    await expect(fetchEdgarEvents('1', { userAgent: 'a b@c.d', fetchImpl })).rejects.toMatchObject({ retryable: true });
  });
});

function memoryStore() {
  const rows = new Map<string, unknown>();
  const notes: unknown[] = [];
  const checks: Array<{ id: string; error: string | null }> = [];
  const store: WatchdogStore = {
    insertEvents: async (rs) => {
      let n = 0;
      for (const r of rs) {
        const k = `${r.orgId}|${r.source}|${r.externalId}`;
        if (!rows.has(k)) {
          rows.set(k, r);
          n++;
        }
      }
      return n;
    },
    notify: async (x) => {
      notes.push(x);
    },
    markChecked: async (id, _at, error) => {
      checks.push({ id, error });
    },
  };
  return { store, rows, notes, checks };
}

describe('detectAccountEvents', () => {
  const subject = { id: 's1', orgId: 'o1', companyId: 'c1', lastCheckedAt: null, alertUserIds: ['kam1'] };
  const adapter = async () => normaliseEdgarSubmissions(FIXTURE);

  it('inserts, alerts only at/above threshold, and is idempotent on re-run', async () => {
    const m = memoryStore();
    const first = await detectAccountEvents(subject, [adapter], m.store, { minAlertSeverity: 3 });
    expect(first).toEqual({ fetched: 4, inserted: 4, alerted: 1, error: null });
    expect(m.notes).toHaveLength(1);
    expect(m.notes[0]).toMatchObject({ title: expect.stringMatching(/^Opportunity: Example Corp: 8-K \(items 5.02\)/) });
    const second = await detectAccountEvents(subject, [adapter], m.store, { minAlertSeverity: 3 });
    expect(second.inserted).toBe(0);
    expect(second.alerted).toBe(0);
    expect(m.rows.size).toBe(4);
  });

  it('a failing source records lastError instead of reporting healthy, and other sources still land', async () => {
    const m = memoryStore();
    const broken = async () => {
      throw new Error('SEC rate limited (429)');
    };
    const res = await detectAccountEvents(subject, [broken, adapter], m.store);
    expect(res.error).toBe('SEC rate limited (429)');
    expect(res.inserted).toBe(4);
    expect(m.checks).toEqual([{ id: 's1', error: 'SEC rate limited (429)' }]);
  });
});
