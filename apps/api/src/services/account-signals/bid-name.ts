/** The account name is a whole word in the buyer, not a substring of a longer name. */
export function buyerNamesAccount(buyer: string | null | undefined, accountName: string): boolean {
  const name = accountName.trim();
  if (!buyer || !name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, 'iu').test(buyer);
}
