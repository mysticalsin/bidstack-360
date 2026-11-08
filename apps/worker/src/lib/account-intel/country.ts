/**
 * Best-known country for registry matching: the account's own country first,
 * then its address, then a country-code domain. Sold-as-generic ccTLDs
 * (.io, .co, .ai, ...) say nothing about where a company is registered.
 */
const GENERIC_CCTLDS = new Set(['io', 'co', 'ai', 'me', 'tv', 'cc', 'ly', 'fm', 'gg', 'sh', 'to', 'ws', 'app', 'is', 'so', 'la', 'eu']);
const TLD_TO_ISO: Record<string, string> = { uk: 'GB' };

function iso2(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}

export function inferCountry(input: { countryCode?: string | null; address?: unknown; domain?: string | null }): string | null {
  const own = iso2(input.countryCode);
  if (own) return own;
  const addr = input.address && typeof input.address === 'object' ? (input.address as Record<string, unknown>) : {};
  const fromAddress = iso2(addr.countryCode) ?? iso2(addr.country);
  if (fromAddress) return fromAddress;
  const host = (input.domain ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
  const tld = host.includes('.') ? host.slice(host.lastIndexOf('.') + 1) : '';
  if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return null;
  return TLD_TO_ISO[tld] ?? tld.toUpperCase();
}
