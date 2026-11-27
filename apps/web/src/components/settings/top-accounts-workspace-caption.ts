/**
 * Caption for the curated top-account list.
 * The settings catalog still names another org on `topAccounts.subtitle`.
 * This screen reads this sentence instead, for the workspace that is signed in.
 */
export function topAccountsWorkspaceCaption(count: number): string {
  return `Hand-pick and order up to ${count} accounts for this workspace. This is separate from Key Accounts (regional strategic accounts flagged per company). Saving an empty list reverts the Top Accounts page to the automatic pipeline-value ranking.`;
}
