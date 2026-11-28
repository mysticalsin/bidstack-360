import type { Prisma } from '@bidstack/db';

/**
 * Contacts-list search.
 *
 * Name, customer, and role are substring matches. Email is not: the column is
 * encrypted at rest, and the PII middleware throws on `contains` (only
 * equality and `in` are rewritten to emailHash). A `contains` on email 500s
 * the whole list. A fragment of an address therefore stays on the plaintext
 * columns. A full address — one @ and a dot in the domain, not "vogt@" or
 * "vogt@example" — is an equality lookup. Citext matches it when encryption
 * is off. emailHash matches it when encryption is on.
 */
const FULL_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactListSearchOr(search: string): Prisma.ContactWhereInput[] {
  const term = search.trim();
  const clauses: Prisma.ContactWhereInput[] = [
    { name: { contains: term, mode: 'insensitive' } },
    { customer: { contains: term, mode: 'insensitive' } },
    { role: { contains: term, mode: 'insensitive' } },
  ];
  if (FULL_EMAIL.test(term)) {
    // Equality only. Encryption on: the middleware rewrites this to emailHash.
    // Encryption off: Contact.email is Citext, so case does not matter.
    clauses.push({ email: { equals: term } });
  }
  return clauses;
}
