/** Accounts the momentum list treats as the whole portfolio. The route reads one past this page. */
export const PORTFOLIO_ACCOUNTS_DRAWN = 40;

/**
 * Accounts to draw. The extra row only says another account exists. It is
 * not shown, and it is not a total.
 */
export function portfolioAccountPage<T>(
  rows: readonly T[],
  drawn = PORTFOLIO_ACCOUNTS_DRAWN,
): { items: T[]; pageContinues: boolean } {
  const pageContinues = rows.length > drawn;
  return {
    items: pageContinues ? rows.slice(0, drawn) : [...rows],
    pageContinues,
  };
}

/**
 * Accounts the list draws. The API drops the probe and sets
 * `accountsContinue`. A response that still carries that row is paged here
 * so the probe is not shown.
 */
export function shownPortfolioAccounts<T>(
  items: readonly T[],
  accountsContinue: boolean | undefined,
  drawn = PORTFOLIO_ACCOUNTS_DRAWN,
): { items: T[]; pageContinues: boolean } {
  if (items.length > drawn) return portfolioAccountPage(items, drawn);
  return { items: [...items], pageContinues: Boolean(accountsContinue) };
}

/**
 * Account control on the momentum list. A longer loaded list is this page,
 * not every account. A shorter list keeps "Show all N accounts" and
 * "Show fewer". No account total is invented.
 */
export function portfolioAccountLabel(count: number, pageContinues: boolean, open: boolean): string {
  if (pageContinues) {
    const page = `${count} in the latest ${count}, not every account`;
    return open ? `Show fewer (${page})` : page;
  }
  if (open) return 'Show fewer';
  return `Show all ${count} accounts`;
}
