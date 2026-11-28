// A workspace-search case study opens on its own row. The reference library
// reads `q` and `expand`. It does not read `search`, and a title can match a
// different case study. There is no /references/:id route. Only a uuid is an
// address.

const REFERENCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/references?expand=<uuid>`, or null when the id is not a uuid. */
export function referenceRecordHref(id: string | null | undefined): string | null {
  const value = id?.trim() ?? '';
  if (!REFERENCE_ID.test(value)) return null;
  return `/references?expand=${value}`;
}
