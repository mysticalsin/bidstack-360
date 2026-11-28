// A contact id on the account relationship map opens that contact record.
// The name is not an address. A script, a path, or a blank stays text.

const CONTACT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contact page for this id, or null when it is not a uuid. */
export function contactRecordHref(contactId: string | null | undefined): string | null {
  if (!contactId || !CONTACT_ID.test(contactId)) return null;
  return `/contacts/${contactId}`;
}
