/**
 * Synthetic accounts leak into shared orgs from E2E/integration fixtures
 * (SCOPE-<uuid>, "E2E Bulk Company", approve-*, Audit Company…). They are never
 * real customers, so hide them from the customer-facing Key/Top account views.
 * Fresh demo orgs are already clean (seedOrgData seeds none) — this is defensive
 * for any residual polluted org until the DB is purged. Keep the prefixes in
 * sync with the E2E fixtures that create them.
 */
const SYNTHETIC_PATTERNS: RegExp[] = [
  /^SCOPE-/i,
  /^E2E\b/i,
  /^Audit Company\b/i,
  /^(AP)?approve-(gate|proposal)/i,
  /\baccount QQ$/i,
  /^Test /i,
];

export function isSyntheticAccountName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  return SYNTHETIC_PATTERNS.some((re) => re.test(n));
}
