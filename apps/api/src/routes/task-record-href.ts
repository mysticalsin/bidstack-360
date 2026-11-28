// A workspace-search follow-up opens on its own record. The tasks page does
// not read ?search=, and a title can match a different follow-up. Only a
// uuid is an address.

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/tasks/<uuid>`, or null when the id is not a uuid. */
export function taskRecordHref(id: string | null | undefined): string | null {
  const value = id?.trim() ?? '';
  if (!TASK_ID.test(value)) return null;
  return `/tasks/${value}`;
}
