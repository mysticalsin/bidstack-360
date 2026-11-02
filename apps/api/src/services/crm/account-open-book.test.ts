import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { AccessScope } from '../../lib/access-scope.js';
import { OPEN_OPPORTUNITY_SQL } from './dashboard.queries.js';
import {
  accountBookStagesFromRows,
  fetchAccountOpenBook,
  openAccountBookQuery,
  type AccountBookQueryRow,
} from './account-open-book.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const TAIL = '8598204328457184962';

const UNRESTRICTED: AccessScope = { unrestricted: true, countries: [], userId: USER };
const RESTRICTED: AccessScope = { unrestricted: false, countries: ['FR'], userId: USER };

function row(overrides: Partial<AccountBookQueryRow> & Pick<AccountBookQueryRow, 'stageKey'>): AccountBookQueryRow {
  return {
    stageName: null,
    count: 1,
    valueSumMicros: '1',
    ...overrides,
  };
}

describe('account open book query', () => {
  it('sums the view as integer micros and does not take a 100- or 500-row page', () => {
    // WHY: the chart summed dashboard deals (take 100). A later open deal
    // never reached its stage. The aggregate has to be the same open
    // predicate as the account book, with no row cap, still inside the view.
    const query = openAccountBookQuery(ORG, [COMPANY, 'key-only-clinic', COMPANY, ''], UNRESTRICTED);
    expect(query).not.toBeNull();
    const text = query!.text;
    expect(text).toContain(OPEN_OPPORTUNITY_SQL.trim());
    expect(text).toContain("o.stage NOT IN ('closed_won', 'closed_lost')");
    expect(text).toContain('ps.deleted_at IS NULL');
    expect(text).toContain('(ps.is_won OR ps.is_lost)');
    expect(text).toContain('stage_row.deleted_at IS NULL');
    expect(text).toContain('o.stage::text');
    expect(text).toContain('SUM(GREATEST(o.value_micros, 0))');
    expect(text).toContain('::text');
    expect(text).toContain('o.org_id =');
    expect(text).toContain('o.deleted_at IS NULL');
    expect(text).toContain('o.company_id IN');
    expect(text).toContain('btrim(o.customer)');
    expect(text).not.toContain('is_won AND NOT ps.is_lost');
    expect(text).not.toContain('o.owner_id');
    expect(text).not.toMatch(/\bLIMIT\b/i);
    expect(text).not.toMatch(/take:\s*(100|500)/);
    expect(query!.values).not.toContain(100);
    expect(query!.values).not.toContain(500);
    expect(query!.values).not.toContain(100n);
    expect(query!.values).not.toContain(500n);
    expect(query!.values.filter((value) => value === COMPANY)).toEqual([COMPANY]);
    expect(query!.values).toContain('key-only-clinic');
    expect(query!.values).not.toContain(OTHER);
    expect(query!.values).not.toContain('');
  });

  it('keeps a restricted caller on the same country and owner rule as the accounts view', () => {
    // WHY: dropping the dashboard visibility predicate would add deals the
    // accounts list cannot show. Company ids do not replace that rule.
    const query = openAccountBookQuery(ORG, [COMPANY], RESTRICTED);
    expect(query).not.toBeNull();
    const text = query!.text;
    expect(text).toContain('o.owner_id =');
    expect(text).toContain('o.country = ANY');
    expect(text).toContain('t.country_codes');
    expect(text).toContain('o.company_id IN');
    expect(text).toContain('o.org_id =');
    expect(query!.values).toContain(USER);
    expect(query!.values).toContain('FR');
    expect(query!.values).toContain('fr');
    expect(query!.values).toContain(COMPANY);
    expect(query!.values).not.toContain(OTHER);
  });

  it('does not query the org when the view has no account ids', () => {
    expect(openAccountBookQuery(ORG, [], UNRESTRICTED)).toBeNull();
    expect(openAccountBookQuery(ORG, ['', '   '], RESTRICTED)).toBeNull();
  });

  it('matches a customer-key account without casting the slug to uuid', () => {
    const query = openAccountBookQuery(ORG, ['key-only-clinic'], UNRESTRICTED);
    expect(query).not.toBeNull();
    expect(query!.text).toContain('btrim(o.customer)');
    expect(query!.text).not.toContain('o.company_id IN');
    expect(query!.values).toContain('key-only-clinic');
  });
});

describe('account book stages from the full query', () => {
  it('adds a deal past a 100-row page and a 500-row page onto its stage', async () => {
    // WHY: building the series from the loaded page leaves the next deal
    // off its bar. The 501st row is a custom stage the open predicate keeps.
    const head = Array.from({ length: 500 }, () =>
      row({ stageKey: 's1_lead', stageName: 'S1 Lead', valueSumMicros: '1' }),
    );
    const tail = row({
      stageKey: 'price_review',
      stageName: 'Price review',
      valueSumMicros: TAIL,
    });
    const book = [...head, tail];
    expect(accountBookStagesFromRows(book.slice(0, 100)).some((stage) => stage.stageName === 'Price review')).toBe(
      false,
    );
    expect(accountBookStagesFromRows(book.slice(0, 500)).some((stage) => stage.stageName === 'Price review')).toBe(
      false,
    );
    expect(accountBookStagesFromRows(book.slice(0, 100)).find((stage) => stage.stage === 'new')?.valueSumMicros).toBe(
      '100',
    );
    expect(accountBookStagesFromRows(book.slice(0, 500)).find((stage) => stage.stage === 'new')?.valueSumMicros).toBe(
      '500',
    );

    const db = { $queryRaw: vi.fn(async () => book) };
    const stages = await fetchAccountOpenBook(db, ORG, [COMPANY], UNRESTRICTED);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = db.$queryRaw.mock.calls[0]?.[0] as { text: string; values: unknown[] };
    expect(sql.text).not.toMatch(/\bLIMIT\b/i);
    expect(sql.text).not.toMatch(/take:\s*(100|500)/);
    expect(sql.values).not.toContain(100);
    expect(sql.values).not.toContain(500);

    const lead = stages.find((stage) => stage.stageName === 'S1 Lead');
    const later = stages.find((stage) => stage.stageName === 'Price review');
    expect(lead).toMatchObject({ stage: 'new', count: 500, valueSumMicros: '500' });
    expect(later).toMatchObject({
      stage: 'unspecified',
      count: 1,
      valueSumMicros: TAIL,
    });
    expect(BigInt(later!.valueSumMicros)).toBe(BigInt(TAIL));
    expect(String(Number(TAIL))).not.toBe(TAIL);

    const src = readFileSync(new URL('./account-open-book.ts', import.meta.url), 'utf8');
    const fetchStart = src.indexOf('export async function fetchAccountOpenBook');
    const fetchBody = src.slice(fetchStart);
    expect(fetchStart).toBeGreaterThan(-1);
    expect(fetchBody).not.toMatch(/\.slice\(\s*0\s*,\s*(100|500)\s*\)/);
    expect(fetchBody).not.toMatch(/take:\s*(100|500)/);
    expect(fetchBody).not.toMatch(/\bLIMIT\b/);
    expect(fetchBody).not.toContain('findMany');
    expect(fetchBody).toContain('accountBookStagesFromRows(rows)');
  });

  it('keeps won, lost, and both-flag outcomes off, and keeps a flagless custom stage', () => {
    // WHY: a live lost flag is stored as closed_lost by the account list, and
    // a stage flagged both won and lost is lost. A deleted row does not
    // rewrite the enum, so closed_lost stays off and an open enum stays on.
    // A custom stage with neither flag is still open.
    const stages = accountBookStagesFromRows([
      row({ stageKey: 'closed_won', stageName: 'Closed Won', valueSumMicros: '9000000' }),
      row({ stageKey: 'closed_lost', stageName: 'S4 Negotiation', valueSumMicros: '8000000' }),
      row({ stageKey: 's2_sent', stageName: null, valueSumMicros: '3000000' }),
      row({ stageKey: 'price_review', stageName: 'Price review', valueSumMicros: '4000000' }),
      row({ stageKey: 's3_technical_iteration', stageName: 'Proposal', count: 1, valueSumMicros: '10' }),
      row({ stageKey: 's4_negotiation', stageName: 'Proposal', count: 2, valueSumMicros: '5' }),
    ]);
    expect(stages.map((stage) => stage.stage)).not.toContain('closed_won');
    expect(stages.map((stage) => stage.stage)).not.toContain('closed_lost');
    expect(stages.find((stage) => stage.stage === 'meeting')).toMatchObject({
      stageName: null,
      valueSumMicros: '3000000',
    });
    expect(stages.find((stage) => stage.stageName === 'Price review')).toMatchObject({
      stage: 'unspecified',
      valueSumMicros: '4000000',
    });
    expect(stages.find((stage) => stage.stageName === 'Proposal')).toMatchObject({
      stage: 'proposal',
      count: 3,
      valueSumMicros: '15',
    });
  });

  it('adds stage micros as integers when a float sum would drop the tail', () => {
    const head = '9007199254740993000001';
    const extra = '100';
    const [merged] = accountBookStagesFromRows([
      row({ stageKey: 's1_lead', valueSumMicros: head }),
      row({ stageKey: 's1_lead', valueSumMicros: extra }),
    ]);
    expect(merged?.valueSumMicros).toBe((BigInt(head) + BigInt(extra)).toString());
    expect(merged?.count).toBe(2);
    expect(String(Number(merged?.valueSumMicros))).not.toBe(merged?.valueSumMicros);
  });
});

describe('accounts open-book route', () => {
  it('reads the caller scope and does not build the series from the dashboard page', () => {
    const src = readFileSync(new URL('../../routes/crm/dashboard.ts', import.meta.url), 'utf8');
    const start = src.indexOf("'/crm/accounts/open-book'");
    const end = src.indexOf("'/crm/release-score'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain('getAccessScope');
    expect(body).toContain('fetchAccountOpenBook');
    expect(body).not.toContain('buildDashboardSnapshot');
    expect(body).not.toContain('findMany');
    expect(body).not.toMatch(/take:\s*(100|500)/);
  });
});
