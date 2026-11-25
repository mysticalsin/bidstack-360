// A person on the account relationship map opens their contact record only
// through the contact id. The name is not an address. A script, a path, or a
// blank stays text.

const CONTACT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contact page for this person, or null when the id is not a uuid. */
export function contactRecordHref(contactId: string | null | undefined): string | null {
  if (!contactId || !CONTACT_ID.test(contactId)) return null;
  return `/contacts/${contactId}`;
}
