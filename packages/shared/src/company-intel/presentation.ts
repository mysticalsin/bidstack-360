/**
 * Customer-facing words for a row that is not a live provider fetch.
 * The stored source stays `fixture` and `sample` stays true, so the row
 * is never presented as production provider data.
 */
export const REFERENCE_BADGE = 'Reference';

/** Source name shown next to a fixture row. */
export const REFERENCE_RECORD = 'Reference record';

/** Drop a fixture author's "Sample:" prefix from a stored title or evidence line. */
export function withoutFixturePrefix(text: string): string {
  return text.replace(/^Sample:\s*/i, '');
}

/**
 * Provenance clause for a non-live metric.
 * Omitted when the source label already names the reference record, so the
 * sentence does not say it twice.
 */
export function referenceClause(sourceLabel: string, sample: boolean): string | null {
  if (!sample) return null;
  return /reference record/i.test(sourceLabel) ? null : 'reference record';
}
