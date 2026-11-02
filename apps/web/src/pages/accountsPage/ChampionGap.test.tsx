import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChampionGap, CHAMPION_GAP_CAPTION } from './ChampionGap';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) => {
      if (typeof values?.count === 'number') return fallback.replace('{{count}}', String(values.count));
      return fallback;
    },
  }),
}));

describe('ChampionGap', () => {
  afterEach(cleanup);

  it('counts accounts in this view that have no accepted champion', () => {
    // WHY: a customer-name match or a suggested fact used to hide a missing
    // champion. The line is a count of the filtered view, not a score and not
    // one page of cards.
    render(<ChampionGap status="ready" accounts={4} missing={3} />);
    expect(screen.getByTestId('champion-gap').textContent).toContain(
      '3 accounts in this view have no accepted champion.',
    );
    expect(screen.getByTestId('champion-gap-caption').textContent).toBe(CHAMPION_GAP_CAPTION);
    expect(CHAMPION_GAP_CAPTION).toMatch(/this view/i);
    expect(CHAMPION_GAP_CAPTION).not.toMatch(/\bpage\b/i);
    expect(CHAMPION_GAP_CAPTION).not.toMatch(/score/i);

    cleanup();
    render(<ChampionGap status="ready" accounts={1} missing={1} />);
    expect(screen.getByText('1 account in this view has no accepted champion.')).toBeTruthy();

    cleanup();
    render(<ChampionGap status="ready" accounts={2} missing={0} />);
    expect(screen.getByText('Every account in this view has an accepted champion.')).toBeTruthy();

    cleanup();
    render(<ChampionGap status="error" accounts={2} missing={0} />);
    expect(screen.getByRole('alert').textContent).toMatch(/didn't load/i);
    expect(screen.queryByText(/accepted champion\./)).toBeNull();
  });

  it('asks for the filtered view, not the card page', () => {
    const segment = readFileSync(join(process.cwd(), 'src/pages/accountsPage/AccountsAllSegment.tsx'), 'utf8');
    expect(segment).toContain('useChampionCoverage(viewCompanyIds)');
    expect(segment).not.toMatch(/useChampionCoverage\(\s*pagedRows/);
    expect(segment).not.toMatch(/viewCompanyIds\.slice\(\s*0\s*,\s*(30|100|500)\s*\)/);
  });
});
