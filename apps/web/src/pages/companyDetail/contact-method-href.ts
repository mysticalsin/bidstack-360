/**
 * Mail and call targets for a contact printed on an account roster.
 *
 * The demo book stores phones with spaces ("+49 30 1234 5670"). A tel link
 * has to be the digits, and the cell keeps the printed form. A fragment,
 * a word, or a scheme is not a number — those stay text.
 */

const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DIAL = /^\+\d[\d\s().-]{6,24}$/;

export function contactMailHref(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (!MAIL.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function contactDialHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!DIAL.test(trimmed)) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `tel:+${digits}`;
}
