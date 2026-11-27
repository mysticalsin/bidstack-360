/**
 * Distinct industries on the current companies page.
 *
 * The Industries card sits beside Countries, which already counts distinct
 * country codes. Counting every row that has an industry makes the demo book
 * look like one industry per company: CI Financial and DNB Bank are both
 * `financial_services`. A blank industry is not an industry.
 *
 * The stored string is the industry. This does not fold case or underscores
 * into a shared label.
 */
export function visibleIndustryCount(industries: readonly (string | null | undefined)[]): number {
  const seen = new Set<string>();
  for (const raw of industries) {
    const value = raw?.trim();
    if (value) seen.add(value);
  }
  return seen.size;
}
