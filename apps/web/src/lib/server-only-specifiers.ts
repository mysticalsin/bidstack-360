/**
 * Subpaths of @bidstack/shared that import node built-ins or exist only for
 * the API and the worker. A value import from the web app pulls them into
 * the browser bundle.
 */
export const SERVER_ONLY_SPECIFIERS = [
  '@bidstack/shared/server',
  '@bidstack/shared/server-crypto',
  '@bidstack/shared/token-crypto',
  '@bidstack/shared/crypto',
  '@bidstack/shared/llm',
  '@bidstack/shared/public-sector',
] as const;

export function isServerOnlySpecifier(spec: string): boolean {
  return SERVER_ONLY_SPECIFIERS.some((entry) => spec === entry || spec.startsWith(`${entry}/`));
}
