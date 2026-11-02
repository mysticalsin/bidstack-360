import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PORTFOLIO_ACCOUNTS_DRAWN,
  portfolioAccountLabel,
  portfolioAccountPage,
  shownPortfolioAccounts,
} from './portfolio-account-caption';

/**
 * How many accounts the momentum list keeps before the card cuts the page. A
 * slice at the limit drops the later account before the caption can tell that
 * the page is not every account.
 */
function portfolioAccountQueryTake(src: string): number {
  const start = src.indexOf("'/portfolio/momentum'");
  const fn = src.slice(start);
  const probes = fn.includes('req.query.limit + 1') && fn.includes('accountsContinue');
  const blind = /take:\s*req\.query\.limit\s*[,}]/.test(fn);
  return probes && !blind ? PORTFOLIO_ACCOUNTS_DRAWN + 1 : PORTFOLIO_ACCOUNTS_DRAWN;
}

function account(name: string) {
  return { companyId: name, companyName: name };
}

describe('portfolio account page', () => {
  it('does not call the loaded page every account when a later account was loaded', () => {
    // WHY: the momentum list kept forty accounts and printed that length as
    // every account ("Show all 40 accounts"). Cutting a forty-first account
    // left that label as if the page were the whole portfolio. One more
    // loaded row means those forty are not every account. The extra row is
    // dropped. A shorter list keeps "Show all N accounts". No account total
    // is invented.
    const src = readFileSync(
      path.resolve(process.cwd(), '../api/src/routes/account-signals.ts'),
      'utf8',
    );
    const start = src.indexOf("'/portfolio/momentum'");
    const handler = src.slice(start);
    expect(handler).toContain('take: req.query.limit + 1');
    expect(handler).toContain('accountsContinue');
    expect(handler).not.toMatch(/take:\s*req\.query\.limit\s*[,}]/);

    const view = readFileSync(
      path.resolve(process.cwd(), 'src/components/signals/PortfolioMomentum.tsx'),
      'utf8',
    );
    const card = view.slice(view.indexOf('export function MomentumList'));
    expect(card).toContain('shownPortfolioAccounts(');
    expect(card).toContain('portfolioAccountLabel(');
    expect(card).not.toContain('`Show all ${rows.length} accounts`');

    const rows = Array.from({ length: PORTFOLIO_ACCOUNTS_DRAWN + 1 }, (_, n) =>
      account(n === PORTFOLIO_ACCOUNTS_DRAWN ? 'probe-account' : `account-${n}`),
    );
    const loaded = rows.slice(0, portfolioAccountQueryTake(src));
    const page = portfolioAccountPage(loaded);
    const shown = shownPortfolioAccounts(page.items, page.pageContinues);
    const caption = portfolioAccountLabel(shown.items.length, shown.pageContinues, false);
    expect(caption).toBe('40 in the latest 40, not every account');
    expect(caption).not.toBe('Show all 40 accounts');
    expect(caption).not.toBe(`Show all ${rows.length} accounts`);
    expect(caption).not.toMatch(/41|Show all|View all/i);
    expect(shown.items).toHaveLength(PORTFOLIO_ACCOUNTS_DRAWN);
    expect(shown.items.some((row) => row.companyId === 'probe-account')).toBe(false);
    expect(loaded.some((row) => row.companyId === 'probe-account')).toBe(true);
    expect(shown.pageContinues).toBe(true);

    const carried = shownPortfolioAccounts(rows, false);
    expect(portfolioAccountLabel(carried.items.length, carried.pageContinues, false)).toBe(
      '40 in the latest 40, not every account',
    );
    expect(carried.items.some((row) => row.companyId === 'probe-account')).toBe(false);
    expect(portfolioAccountLabel(carried.items.length, carried.pageContinues, true)).toBe(
      'Show fewer (40 in the latest 40, not every account)',
    );

    const shortLoaded = rows.slice(0, 12).slice(0, portfolioAccountQueryTake(src));
    const shortPage = portfolioAccountPage(shortLoaded);
    const short = shownPortfolioAccounts(shortPage.items, shortPage.pageContinues);
    expect(short.pageContinues).toBe(false);
    expect(short.items).toHaveLength(12);
    expect(portfolioAccountLabel(short.items.length, short.pageContinues, false)).toBe(
      'Show all 12 accounts',
    );
    expect(portfolioAccountLabel(short.items.length, short.pageContinues, false)).not.toMatch(
      /not every/i,
    );
    expect(portfolioAccountLabel(short.items.length, short.pageContinues, true)).toBe('Show fewer');
    expect(portfolioAccountLabel(PORTFOLIO_ACCOUNTS_DRAWN, false, false)).toBe('Show all 40 accounts');
  });
});