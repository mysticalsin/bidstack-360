import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_BOOK_CAPTION,
  openAccountBookStages,
  type AccountBookStageInput,
} from './accountBookSeries';

const TAIL = '8598204328457184962';

function stage(overrides: Partial<AccountBookStageInput> & Pick<AccountBookStageInput, 'stage'>): AccountBookStageInput {
  return {
    stageName: null,
    count: 1,
    valueSumMicros: '1000000',
    ...overrides,
  };
}

describe('openAccountBookStages', () => {
  it('keeps a lost stage out of the open series and names the recorded book', () => {
    // WHY: a lost stage can still carry an open-looking name. Grouping by
    // that name would draw a lost deal as if it were still open. The caption
    // has to name the recorded book once the series is no longer a page.
    const series = openAccountBookStages([
      stage({
        stage: 'closed_lost',
        stageName: 'S4 Negotiation',
        valueSumMicros: '8000000',
      }),
      stage({ stage: 'new', stageName: 'S1 Lead', valueSumMicros: '1000000' }),
      stage({ stage: 'closed_won', stageName: 'Closed Won', valueSumMicros: '9000000' }),
      stage({ stage: 'customer', stageName: 'Customer', valueSumMicros: '2000000' }),
      stage({ stage: 'unspecified', stageName: 'Price review', valueSumMicros: '4000000' }),
    ]);

    expect(series.map((row) => row.label)).toEqual(['S1 Lead', 'Customer', 'Price review']);
    expect(series.map((row) => row.stage)).not.toContain('closed_lost');
    expect(series.map((row) => row.stage)).not.toContain('closed_won');
    expect(series.some((row) => /negotiation|closed won/i.test(row.label))).toBe(false);
    expect(series.find((row) => row.label === 'S1 Lead')?.valueSumMicros).toBe('1000000');
    expect(series.find((row) => row.label === 'Price review')?.valueSumMicros).toBe('4000000');

    expect(ACCOUNT_BOOK_CAPTION).toMatch(/recorded open book/i);
    expect(ACCOUNT_BOOK_CAPTION).toMatch(/this view/i);
    expect(ACCOUNT_BOOK_CAPTION).not.toMatch(/page/i);
    expect(ACCOUNT_BOOK_CAPTION.trim().length).toBeGreaterThan(20);
  });

  it('adds a deal past a 100-row page and a 500-row page onto its stage', () => {
    // WHY: the accounts chart used to sum the loaded dashboard deals. The
    // 101st and 501st deals belong on their stage, as integer micros.
    const head = Array.from({ length: 500 }, () =>
      stage({ stage: 'new', stageName: 'S1 Lead', valueSumMicros: '1' }),
    );
    const tail = stage({ stage: 'unspecified', stageName: 'Later', valueSumMicros: TAIL });
    const book = [...head, tail];

    expect(openAccountBookStages(book.slice(0, 100)).some((row) => row.label === 'Later')).toBe(false);
    expect(openAccountBookStages(book.slice(0, 500)).some((row) => row.label === 'Later')).toBe(false);
    expect(openAccountBookStages(book.slice(0, 100)).find((row) => row.label === 'S1 Lead')?.valueSumMicros).toBe(
      '100',
    );
    expect(openAccountBookStages(book.slice(0, 500)).find((row) => row.label === 'S1 Lead')?.valueSumMicros).toBe(
      '500',
    );

    const series = openAccountBookStages(book);
    expect(series.find((row) => row.label === 'S1 Lead')).toMatchObject({
      count: 500,
      valueSumMicros: '500',
    });
    const later = series.find((row) => row.label === 'Later');
    expect(later?.valueSumMicros).toBe(TAIL);
    expect(BigInt(later?.valueSumMicros ?? '0')).toBe(BigInt(TAIL));
    expect(String(Number(TAIL))).not.toBe(TAIL);

    const src = readFileSync(join(process.cwd(), 'src/pages/accountsPage/accountBookSeries.ts'), 'utf8');
    expect(src).not.toMatch(/\.slice\(\s*0\s*,\s*(100|500)\s*\)/);
    expect(src).not.toMatch(/take:\s*(100|500)/);
    expect(src).not.toContain('dashboard.data.deals');
    expect(src).not.toMatch(/Number\(\s*[^)]*amountMicros/);

    const segment = readFileSync(join(process.cwd(), 'src/pages/accountsPage/AccountsAllSegment.tsx'), 'utf8');
    expect(segment).toContain('useAccountOpenBook(viewCompanyIds)');
    expect(segment).not.toMatch(/useAccountOpenBook\(\s*pagedRows/);
    expect(segment).not.toMatch(/viewCompanyIds\.slice\(\s*0\s*,\s*(100|500)\s*\)/);
    const chartAt = segment.indexOf('<AccountBookChart');
    expect(chartAt).toBeGreaterThan(-1);
    const chartJsx = segment.slice(chartAt, segment.indexOf('/>', chartAt));
    expect(chartJsx).not.toContain('deals');
    expect(chartJsx).not.toContain('dashboard.data.deals');
  });
});
