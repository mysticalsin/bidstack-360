import { isPublicHostname } from '../utils/webhook-url.js';

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
 * Accepted values: '' / 'false' (no trust), 'true' (trust all; development
 * and test only — productionTrustProxyError rejects it at boot), a positive
 * integer hop count, or a comma-separated IP/CIDR allowlist.
 */

const IPV4_OR_CIDR =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?:\/(?:3[0-2]|[12]?\d))?$/;
const IPV6_OR_CIDR = /^[0-9a-fA-F:.]+(?:\/(?:12[0-8]|1[01]\d|\d{1,2}))?$/;

function isExplicitProxyEntry(entry: string): boolean {
  if (IPV4_OR_CIDR.test(entry)) return true;
  return entry.includes(':') && IPV6_OR_CIDR.test(entry);
}

/**
 * Production must not use trust-all. `true` makes req.ip the leftmost
 * X-Forwarded-For value, which the client chooses, so each spoofed address
 * is a new rate-limit bucket. Empty and `false` trust no proxy (fail closed).
 * A hop count or an explicit IP/CIDR list is the only way to trust a proxy.
 * Returns a boot error, or null when the value is allowed.
 */
export function productionTrustProxyError(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (v === '' || v === 'false' || v === '0') return null;
  if (v === 'true') {
    return (
      'TRUSTED_PROXIES=true is not allowed in production. Set an explicit hop count ' +
      '(for example 2) or a comma-separated CIDR list.'
    );
  }
  if (/^\d+$/.test(v)) {
    const hops = Number(v);
    if (Number.isSafeInteger(hops) && hops > 0) return null;
  }
  const entries = v.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length > 0 && entries.every(isExplicitProxyEntry)) return null;
  return (
    'TRUSTED_PROXIES must be a hop count (for example 2) or a comma-separated CIDR list ' +
    'in production. TRUSTED_PROXIES=true is not allowed in production.'
  );
}

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
