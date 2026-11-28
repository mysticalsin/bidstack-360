/**
 * The tasks list reads `filter`, `sort`, and `view` from the URL. It does not
 * read `search`, so `/tasks?search=<title>` opens the unfiltered book.
 * A follow-up opens on its own record. The title is not part of the address.
 */
export function taskRecordPath(id: string): string {
  return `/tasks/${encodeURIComponent(id)}`;
}
