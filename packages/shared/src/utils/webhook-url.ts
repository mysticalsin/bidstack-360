/**
 * True if a parsed IPv4 [a,b,c,d] is NOT globally routable: this-host, private,
 * loopback, link-local (cloud metadata), CGNAT, IETF protocol assignments,
 * documentation/benchmark nets, multicast, reserved and broadcast.
 */
function isPrivateV4(octets: number[]): boolean {
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  const c = octets[2] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true; // 0/8 (this-host), 10/8, 127/8 loopback
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0/24 IETF, 192.0.2/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113/24 TEST-NET-3
  if (a >= 224) return true; // 224/4 multicast, 240/4 reserved, 255.255.255.255 broadcast
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
 * Expand an IPv6 literal (any valid textual form, incl. "::" compression and a
 * trailing dotted IPv4) to its 8 sixteen-bit groups, or null if malformed.
 */
function parseV6(s: string): number[] | null {
  let text = s;
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseDottedV4(maybeV4);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.map((g) => parseInt(g, 16));
  };
  const head = parse(halves[0] ?? '');
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !rest) return null;
  const explicit = head.length + rest.length;
  if (halves.length === 1) return explicit === 8 ? head : null;
  if (explicit > 7) return null;
  return [...head, ...new Array<number>(8 - explicit).fill(0), ...rest];
}

function v4FromGroups(hi: number, lo: number): number[] {
  return [(hi >>> 8) & 0xff, hi & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
}

/** True if a parsed IPv6 address is not a safe public destination. */
function isPrivateV6(g: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
  const firstSixZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (firstSixZero && g6 === 0 && (g7 === 0 || g7 === 1)) return true; // :: unspecified, ::1 loopback
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible (::a.b.c.d):
  // judge by the embedded IPv4.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPrivateV4(v4FromGroups(g6, g7));
  }
  // NAT64 well-known prefix 64:ff9b::/96 (and local-use 64:ff9b:1::/48): on a
  // NAT64 network 64:ff9b::a9fe:a9fe reaches 169.254.169.254.
  if (g0 === 0x64 && g1 === 0xff9b) {
    if (g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPrivateV4(v4FromGroups(g6, g7));
    if (g2 === 1) return true;
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return true; // 100::/64 discard
  return false;
}

/** Hostnames that resolve to internal services by convention (RFC 6761 / cloud). */
function isInternalName(h: string): boolean {
  const name = h.endsWith('.') ? h.slice(0, -1) : h;
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    name.endsWith('.local') ||
    name.endsWith('.internal') ||
    name.endsWith('.home.arpa') ||
    name === 'metadata' ||
    name === 'instance-data'
  );
}

/**
 * Returns true only for a publicly-routable host. Parses IPv4 / IPv6 literals
 * by RANGE (not string prefixes): the whole 127.0.0.0/8 and 0.0.0.0/8 blocks,
 * IPv4-mapped / IPv4-compatible / NAT64 IPv6 forms of private IPv4 space, and
 * any textual form of an IPv6 address (expanded, compressed, zone-scoped).
 * Guards SSRF before storing or fetching any user URL, and is re-applied to
 * every DNS-resolved address by assertUrlResolvesPublic.
 */
export function isPublicHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (isInternalName(h)) return false;
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;

  // IPv4 literal — range check.
  const v4 = parseDottedV4(bare);
  if (v4) return !isPrivateV4(v4);

  // IPv6 literal (contains ':'). Guarded by ':' so hostnames starting with
  // "fc"/"fd" (e.g. fc-cdn.example.com) are never affected.
  if (bare.includes(':')) {
    const groups = parseV6(bare);
    if (!groups) return false; // unparseable address literal: fail closed
    return !isPrivateV6(groups);
  }

  // A DNS hostname — treated as public here; the resolved-IP recheck happens in
  // assertUrlResolvesPublic (@bidstack/shared/server) before outbound requests.
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
