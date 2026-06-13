import { z } from 'zod';

/**
 * Top Accounts curation (demo-feedback M5).
 *
 * "Top accounts" = the manually curated global top-10 (Company.topAccountRank
 * 1..10, admin-managed). "Key accounts" = regional strategic accounts
 * (Company.tier = 'key'). The two concepts are distinct everywhere: the
 * /accounts/top endpoint labels its payload with `source` so the UI can tell
 * a curated list apart from the auto pipeline-value leaderboard fallback.
 */
export const TOP_ACCOUNTS_MAX = 10;

export const TopAccountsSource = z.enum(['curated', 'auto']);
export type TopAccountsSource = z.infer<typeof TopAccountsSource>;

export const TopAccountListUpdate = z.object({
  companyIds: z
    .array(z.string().uuid())
    .max(TOP_ACCOUNTS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'companyIds must not contain duplicates',
    }),
});
export type TopAccountListUpdate = z.infer<typeof TopAccountListUpdate>;
