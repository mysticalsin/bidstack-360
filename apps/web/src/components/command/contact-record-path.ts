/**
 * The contacts list keeps search in component state. It does not read `search`
 * from the URL, so `/contacts?search=<name>` opens the unfiltered book.
 * A contact opens on its own record. The name is not part of the address.
 */
export function contactRecordPath(id: string): string {
  return `/contacts/${encodeURIComponent(id)}`;
}
