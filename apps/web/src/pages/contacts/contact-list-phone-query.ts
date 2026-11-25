/**
 * Phone lookup for the contacts list.
 *
 * The demo book prints phones with spaces ("+49 30 1234 5670"). The list
 * route cannot substring-match phone: the column is encrypted and `contains`
 * throws. A full number is matched on the loaded page by digits. A name, a
 * fragment, or a scheme stays a server text search.
 */

const PHONE_QUERY = /^\+\d[\d\s().-]{6,24}$/;

export function contactListPhoneQuery(input: string): string | null {
  const trimmed = input.trim();
  if (!PHONE_QUERY.test(trimmed)) return null;
  const digits = trimmed.slice(1).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

export function contactPhoneMatches(phone: string | null | undefined, digits: string): boolean {
  if (!phone) return false;
  const trimmed = phone.trim();
  if (!trimmed.startsWith('+')) return false;
  const got = trimmed.slice(1).replace(/\D/g, '');
  return got === digits;
}
