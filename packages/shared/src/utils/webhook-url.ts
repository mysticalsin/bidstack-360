/** True if a parsed IPv4 [a,b,c,d] falls in a private / loopback / reserved range. */
function isPrivateV4(octets: number[]): boolean {
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true; // 0/8 (this-host), 10/8, 127/8 loopback
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

/** Parse a dotted-decimal IPv4 literal, or null if not one. */
function parseDottedV4(s: string): number[] | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = m.slice(1, 5).map(Number);
  return o.every((n) => n <= 255) ? o : null;
}

/**
 * Returns true only for a publicly-routable host. Parses IPv4 / IPv6 literals
 * by RANGE (not string prefixes) so the whole 127.0.0.0/8 and 0.0.0.0/8 blocks
 * are caught — including IPv4-mapped IPv6 in dotted (`::ffff:127.0.0.2`) AND hex
 * (`::ffff:7f00:2`) form. Guards SSRF before storing or fetching any user URL.
 */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return false;
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;

  // IPv4 literal — range check.
  const v4 = parseDottedV4(bare);
  if (v4) return !isPrivateV4(v4);

  // IPv6 literal (contains ':') — block loopback, unspecified, ULA, link-local,
  // and IPv4-mapped private space. Guarded by ':' so hostnames starting with
  // "fc"/"fd" (e.g. fc-cdn.example.com) are never affected.
  if (bare.includes(':')) {
    if (bare === '::1' || bare === '::') return false; // loopback / unspecified
    if (bare.startsWith('fc') || bare.startsWith('fd')) return false; // fc00::/7 ULA
    if (/^fe[89ab]/.test(bare)) return false; // fe80::/10 link-local
    if (bare.startsWith('::ffff:')) {
      const rest = bare.slice(7);
      const dotted = parseDottedV4(rest);
      if (dotted) return !isPrivateV4(dotted);
      // Hex-mapped form, e.g. ::ffff:7f00:1 → 127.0.0.1. Fold the low 32 bits.
      const groups = rest.split(':').filter(Boolean);
      if (groups.length >= 1 && groups.length <= 2 && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
        let value = 0;
        for (const g of groups) value = (value * 0x10000 + parseInt(g, 16)) >>> 0;
        const octets = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
        return !isPrivateV4(octets);
      }
    }
    return true; // other global IPv6
  }

  // A DNS hostname — treated as public here; the resolved-IP recheck happens in
  // the worker's research fetch (safe-research-fetch.ts) for outbound requests.
  return true;
}

export function assertSafeWebhookUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('url must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('url must use HTTPS');
  }

  if (!isPublicHostname(url.hostname)) {
    throw new Error('url must not point to a private or internal address');
  }
}
