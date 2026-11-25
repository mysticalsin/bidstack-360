/**
 * Dial target for the phone printed on a contacts-list row.
 *
 * The demo book stores phones with spaces ("+49 30 1234 5670"). A tel link
 * has to be the digits, and the row keeps the printed form. A fragment,
 * a word, or a scheme is not a number — those stay text.
 */

const DIAL = /^\+\d[\d\s().-]{6,24}$/;

export function contactListDialHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!DIAL.test(trimmed)) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:+${digits}`;
}
