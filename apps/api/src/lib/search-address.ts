// Workspace search may equality-match a full address. contains on Contact.email,
// Lead.email, or either phone throws in the PII middleware and 500s the request.
// A fragment stays on the plaintext columns.

import { tokenize } from './search-score.js';

type TextMatch = { contains: string; mode: 'insensitive' };

export type TextOrAddressWhere =
  | { AND: Array<{ OR: Record<string, TextMatch>[] }> }
  | {
      OR: Array<
        | { AND: Array<{ OR: Record<string, TextMatch>[] }> }
        | { email: { equals: string; mode: 'insensitive' } }
      >;
    };

/** The whole query is local@domain with a dot in the domain, or null. */
export function fullSearchAddress(query: string): string | null {
  const value = query.trim();
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return null;
  if (/\s/.test(value)) return null;
  const domain = value.slice(at + 1);
  const dot = domain.indexOf('.');
  if (dot <= 0 || dot === domain.length - 1 || domain.includes('..')) return null;
  return value;
}

function textAnd(tokens: string[], fields: readonly string[]): Array<{ OR: Record<string, TextMatch>[] }> {
  return tokens.map((tok) => ({
    OR: fields.map((field) => ({ [field]: { contains: tok, mode: 'insensitive' as const } })),
  }));
}

/**
 * Plaintext token-AND, or that clause OR an email equality when `query` is
 * one full address. Phone is never a field here.
 */
export function textOrAddressWhere(fields: readonly string[], query: string): TextOrAddressWhere {
  const text = textAnd(tokenize(query), fields);
  const address = fullSearchAddress(query);
  if (!address) return { AND: text };
  return {
    OR: [{ AND: text }, { email: { equals: address, mode: 'insensitive' } }],
  };
}
