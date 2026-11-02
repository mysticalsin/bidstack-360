/**
 * Registry lookup name gate. Same rule as the filings filer check:
 * legal suffixes drop, and the remaining words have to be the same set.
 * A shorter name inside a longer one is a different company.
 */
const LEGAL = new Set([
  'inc',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'limited',
  'plc',
  'sa',
  'asa',
  'ag',
  'gmbh',
  'se',
  'nv',
  'bv',
  'sgps',
  'spa',
  'srl',
  'ab',
  'oyj',
  'as',
  'adr',
  'the',
  'group',
  'holding',
  'holdings',
  'of',
  'for',
  'and',
  'p',
  'l',
  'c',
  's',
  'a',
]);

export function lookupNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token && !LEGAL.has(token));
}

/** True when both names are the same company after legal suffixes drop. */
export function lookupNamesMatch(left: string, right: string): boolean {
  const a = lookupNameTokens(left);
  const b = lookupNameTokens(right);
  if (a.length === 0 || a.length !== b.length) return false;
  const leftSorted = [...a].sort();
  const rightSorted = [...b].sort();
  return leftSorted.every((token, index) => token === rightSorted[index]);
}
