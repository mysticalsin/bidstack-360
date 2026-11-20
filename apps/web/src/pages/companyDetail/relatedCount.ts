/** Matches COMPANY_DETAIL_RELATED_CAP in apps/api/src/routes/companies.ts. */
export const RELATED_CAP = 200;

/** Tab count label: a full page from the capped detail payload is a lower bound. */
export function relatedCount(n: number): string {
  return n >= RELATED_CAP ? `${RELATED_CAP}+` : String(n);
}
