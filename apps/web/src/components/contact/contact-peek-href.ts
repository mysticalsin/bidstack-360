/**
 * Reach targets for the contacts-list Quick Look.
 *
 * The demo book stores phones with spaces ("+1 416 555 0142"). A tel link
 * has to be the digits, and the card keeps the printed form. A fragment,
 * a word, or a scheme is not a number — those stay text. The name opens
 * the contact record only when the id is a contact id.
 */

const CONTACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIAL = /^\+\d[\d\s().-]{6,24}$/;

export function contactPeekRecordPath(id: string): string | null {
  if (!CONTACT_ID.test(id)) return null;
  return `/contacts/${id}`;
}

export function contactPeekMailHref(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!MAIL.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function contactPeekDialHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!DIAL.test(trimmed)) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:+${digits}`;
}
