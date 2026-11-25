// The library search box is one string. It used to match only the title and
// the description, so the seeded industry ("healthcare"), a tag that is not
// in the write-up ("governance", "landing-zone"), and the company name the
// title does not carry ("System for Health") missed the case study.
// Contact name and email are not search fields.

import type { Prisma } from '@bidstack/db';

export type ReferenceSearchFields = {
  title: string;
  description: string | null;
  industry: string | null;
  companyName: string | null;
  tags: readonly string[];
};

/**
 * True when `search` sits in the title, the description, the industry, or the
 * company name, or equals a whole tag. A capitalized query also matches the
 * lowercase tag. A blank query matches nothing: the caller omits the filter.
 */
export function referenceLibrarySearchHits(row: ReferenceSearchFields, search: string): boolean {
  const q = search.trim();
  if (!q) return false;
  const needle = q.toLowerCase();
  const text = [row.title, row.description, row.industry, row.companyName];
  if (text.some((value) => (value ?? '').toLowerCase().includes(needle))) return true;
  const tags = new Set([q, needle]);
  return row.tags.some((tag) => tags.has(tag));
}

/**
 * The `search` clause for GET /references. Same rule as
 * `referenceLibrarySearchHits`. Undefined when the query is blank, so a blank
 * search does not filter the library.
 */
export function referenceLibrarySearchWhere(
  search: string | undefined,
): Prisma.ReferenceWhereInput | undefined {
  const q = search?.trim() ?? '';
  if (!q) return undefined;
  const tags = Array.from(new Set([q, q.toLowerCase()]));
  return {
    OR: [
      { title: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { industry: { contains: q, mode: 'insensitive' } },
      { company: { is: { name: { contains: q, mode: 'insensitive' } } } },
      ...tags.map((tag) => ({ tags: { has: tag } })),
    ],
  };
}
