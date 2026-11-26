// The insight strip is handed an empty list both when the server page has
// not arrived and when a loaded page has no rows. useAuditLogs stores the
// page under this key. The settings section re-renders the strip when that
// query changes, so a render-time read of the cache is the arrival signal.

export const AUDIT_LOG_QUERY_KEY = ['audit-logs'] as const;

export interface AuditQuerySnapshot {
  data: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  fetchStatus: string;
}

/**
 * A settled page has arrived, including a settled page with no rows.
 * A failed read, a read still in flight, and a newer failure than the last
 * settled page have not arrived. An empty list alone is not enough to decide.
 */
export function auditPayloadArrived(queries: readonly AuditQuerySnapshot[]): boolean {
  if (queries.length === 0) return false;
  const anySettledData = queries.some((query) => query.data != null);
  if (!anySettledData) return false;
  const newestDataAt = Math.max(...queries.map((query) => query.dataUpdatedAt));
  const newestErrorAt = Math.max(...queries.map((query) => query.errorUpdatedAt));
  const inFlightWithoutData = queries.some(
    (query) => query.fetchStatus === 'fetching' && query.data == null,
  );
  if (inFlightWithoutData) return false;
  if (newestErrorAt > newestDataAt) return false;
  return true;
}
