/**
 * The tasks list reads filter, sort, and view. It does not read `search`.
 * A follow-up opens on its own record. A title search drops the reader on
 * the unfiltered list.
 */
export function taskRecordPath(id: string): string {
  return `/tasks/${encodeURIComponent(id)}`;
}
