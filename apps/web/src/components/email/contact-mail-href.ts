// A contact address is a mail target only when it is a plain address.
// A scheme, a word, or a blank value stays off the link so the empty
// panel cannot open mailto:mailto:… or mail a fragment.

// Colon is rejected so a stored "mailto:" prefix cannot become
// mailto:mailto:…. A plus-tag in the local part is still an address.
const MAIL = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;

export function contactMailHref(
  email: string | null | undefined,
): { href: string; address: string } | null {
  if (!email) return null;
  const address = email.trim();
  if (!MAIL.test(address)) return null;
  return { href: `mailto:${address}`, address };
}
