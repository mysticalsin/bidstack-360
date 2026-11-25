import { titleCase } from '@/pages/accountsPage/accountUtils';

/**
 * Home leaderboard captions.
 * The crm catalog still says "Curated top 10" on `topAccounts.sourceCurated`.
 * This card reads these sentences instead, and prints a stored industry code
 * as words. A blank or "Unknown industry" value is not an industry.
 */
export const LEADERBOARD_CURATED_CAPTION = 'Curated ranking';

export const LEADERBOARD_LOADING_CAPTION = 'Loading the ranking.';

export function leaderboardRankLabel(rank: number): string {
  return `Rank ${rank}`;
}

export function leaderboardRowDetail(account: {
  industry: string | null;
  domain: string | null;
}): string | null {
  const industry = account.industry?.trim() ?? '';
  if (industry && industry !== 'Unknown industry') return titleCase(industry);
  const domain = account.domain?.trim() ?? '';
  return domain || null;
}
