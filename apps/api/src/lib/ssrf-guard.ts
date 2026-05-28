/**
 * Returns `true` if `hostname` is a publicly routable address.
 *
 * Rejects loopback (`127.*`, `localhost`), link-local (`169.254.*`),
 * private ranges (RFC 1918: `10.*`, `172.16-31.*`, `192.168.*`),
 * and `.local` mDNS domains.
 *
 * Use this before storing or fetching any user-supplied URL to prevent
 * Server-Side Request Forgery (SSRF) attacks against internal services.
 *
 * @param hostname - The `URL.hostname` value (without port).
 * @returns `true` if the hostname appears publicly routable, `false` if internal.
 * @example
 * ```ts
 * if (!isPublicHostname(new URL(userUrl).hostname)) {
 *   throw new Error('URL must not point to an internal address');
 * }
 * ```
 */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (
    h === 'localhost' ||
    h.endsWith('.local') ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    // IPv6 loopback (::1 and bracket forms, plus IPv4-mapped loopback)
    h === '::1' ||
    h === '[::1]' ||
    h.startsWith('::ffff:127.') ||
    h.startsWith('10.') ||
    h.startsWith('172.16.') ||
    h.startsWith('172.17.') ||
    h.startsWith('172.18.') ||
    h.startsWith('172.19.') ||
    h.startsWith('172.20.') ||
    h.startsWith('172.21.') ||
    h.startsWith('172.22.') ||
    h.startsWith('172.23.') ||
    h.startsWith('172.24.') ||
    h.startsWith('172.25.') ||
    h.startsWith('172.26.') ||
    h.startsWith('172.27.') ||
    h.startsWith('172.28.') ||
    h.startsWith('172.29.') ||
    h.startsWith('172.30.') ||
    h.startsWith('172.31.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  ) {
    return false;
  }
  return true;
}
