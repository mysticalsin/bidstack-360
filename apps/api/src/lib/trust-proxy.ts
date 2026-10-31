import { isPublicHostname } from '@bidstack/shared';

/**
 * Fastify `trustProxy` value built from TRUSTED_PROXIES.
 *
 * Behind Azure Front Door + Container Apps Envoy the client IP is 2 hops
 * upstream, so production sets TRUSTED_PROXIES=2. Fastify >= 5.12 no longer
 * honours a numeric hop count: it silently fails closed and trusts NO proxy,
 * which would make `req.ip` the Envoy address for every request and collapse
 * the per-IP rate-limit bucket into one shared bucket for all clients.
 *
 * We therefore translate a hop count into an explicit trust function, as the
 * Fastify docs require: the immediate peer (hop 0) must be a non-public
 * (private, loopback, link-local, CGNAT) address, i.e. the in-cluster ingress,
 * and only then are up to N hops trusted. A client that reaches the container
 * directly from a public address is never trusted, so it cannot spoof
 * X-Forwarded-For.
 *
 * Accepted values: '' / 'false' (no trust), 'true' (trust all; dev only),
 * a positive integer hop count, or a comma-separated IP/CIDR allowlist.
 */
export type TrustProxyValue = boolean | string[] | ((address: string, hop: number) => boolean);

export function isInternalPeer(address: string): boolean {
  if (!address) return false;
  return !isPublicHostname(address);
}

export function hopCountTrust(hops: number): (address: string, hop: number) => boolean {
  return (address, hop) => {
    if (hop >= hops) return false;
    if (hop === 0) return isInternalPeer(address);
    return true;
  };
}

export function parseTrustProxy(value: string | undefined): TrustProxyValue {
  if (!value) return false;
  const v = value.trim();
  if (v === 'true') return true;
  if (v === 'false' || v === '') return false;
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    return hops > 0 ? hopCountTrust(hops) : false;
  }
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
