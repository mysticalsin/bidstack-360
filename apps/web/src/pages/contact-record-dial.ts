/**
 * Dial target for the phone printed on a contact record.
 *
 * The demo book stores phones with spaces ("+49 30 1234 5670"). A tel link
 * has to be the digits, and the record keeps the printed form. A fragment,
 * a word, or a scheme is not a number. Those stay text.
 */

const DIAL = /^\+\d[\d\s().-]{6,24}$/;

export function contactRecordDialHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!DIAL.test(trimmed)) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:+${digits}`;
}
