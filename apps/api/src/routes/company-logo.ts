/**
 * company-logo.ts — same-origin company-logo proxy.
 *
 * The frontend's logo <img> can't send a Bearer token, and CompanyLogo only
 * renders SAME-ORIGIN images (logoUrlSafety), so raw third-party logo URLs never
 * display. This PUBLIC endpoint resolves a company's domain server-side, fetches
 * its logo from a provider (logo.dev when a token is configured, else Clearbit —
 * key-free; both 404 for unknown domains → the UI falls back to initials), and
 * streams the bytes same-origin with long cache headers.
 *
 * Security: logos are public brand assets, so this is intentionally public
 * (config.public). The domain is a query parameter, not a URL. Fetches go only
 * to a fixed provider host list, through pinnedFetch, and a redirect is
 * accepted only when the next host is still on that list. SVG is an attachment.
 * Reserved/dev domains are rejected.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { PinnedFetchError, pinnedFetch, type PinnedFetchResponse } from '@bidstack/shared/server';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;
const MAX_CACHE = 500;
const MIN_IMAGE_BYTES = 128;
const MAX_IMAGE_BYTES = 512 * 1024;
const MAX_PROVIDER_REDIRECTS = 2;

/** Hosts this route is allowed to contact. A redirect off this set is a miss. */
const PROVIDER_HOSTS = new Set([
  'img.logo.dev',
  'cdn.brandfetch.io',
  'www.google.com',
  'icons.duckduckgo.com',
  'cdn.simpleicons.org',
  'cdn.jsdelivr.net',
]);

const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon']);

type Hit = { buf: Buffer; contentType: string; attachment: boolean; ts: number } | null; // null = negative cache
const cache = new Map<string, Hit>();

function cacheGet(key: string): Hit | undefined {
  const v = cache.get(key);
  if (v === undefined) return undefined;
  if (v && Date.now() - v.ts > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return v;
}
function cacheSet(key: string, v: Hit): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, v);
}

/** Bare, public, non-reserved hostname or null. */
function resolveDomain(domain: string | null, website: string | null): string | null {
  let host = (domain ?? '').trim().toLowerCase();
  if (!host && website) {
    try {
      host = new URL(website).hostname.toLowerCase();
    } catch {
      host = '';
    }
  }
  host = host.replace(/^www\./, '');
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null; // must look like a real hostname
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null; // no IPs
  if (/\.(example|invalid|localhost|test|local)$/.test(host) || host === 'localhost') return null;
  return host;
}

function providerUrls(domain: string): string[] {
  const token = process.env.LOGO_DEV_TOKEN?.trim();
  const urls: string[] = [];
  // logo.dev (token) = best quality full logos. Brandfetch if a token is set.
  if (token) urls.push(`https://img.logo.dev/${domain}?token=${encodeURIComponent(token)}&size=128&format=png`);
  const bf = process.env.BRANDFETCH_LOGO_TOKEN?.trim();
  if (bf) urls.push(`https://cdn.brandfetch.io/${domain}/w/128/h/128?c=${encodeURIComponent(bf)}`);
  // Google favicon service — key-free, returns up to 128px (crisper than DDG's
  // 16-32px .ico). Preferred key-free source when no logo.dev/Brandfetch token.
  urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  // DuckDuckGo icon service — key-free fallback.
  urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  return urls;
}

type FetchResult =
  | { kind: 'image'; buf: Buffer; contentType: string; attachment: boolean }
  | { kind: 'miss' }
  | { kind: 'unavailable' };

function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Raster types are served inline under a forced type. SVG is an attachment
 * with a locked CSP: tech icons are SVG, and an inline SVG document on this
 * origin can run script where the page CSP allows it (F-13).
 */
function classifyLogo(contentType: string | null): { contentType: string; attachment: boolean } | null {
  const base = mediaType(contentType);
  if (base === 'image/svg+xml') return { contentType: 'image/svg+xml', attachment: true };
  if (base === 'image/jpg') return { contentType: 'image/jpeg', attachment: false };
  if (base === 'image/vnd.microsoft.icon') return { contentType: 'image/x-icon', attachment: false };
  if (RASTER_TYPES.has(base)) return { contentType: base, attachment: false };
  return null;
}

function providerHost(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return PROVIDER_HOSTS.has(url.hostname.toLowerCase()) ? url : null;
  } catch {
    return null;
  }
}

async function fetchProvider(url: string): Promise<PinnedFetchResponse> {
  return pinnedFetch(url, {
    method: 'GET',
    redirect: 'manual',
    maxHops: 0,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: MAX_IMAGE_BYTES,
  });
}

/**
 * First provider image wins. `miss` means every provider answered and none had
 * an image; `unavailable` means at least one timed out, failed or answered 429
 * or 5xx, so the miss may be transient and must not be negative-cached.
 */
async function readProvider(start: string): Promise<FetchResult> {
  let current = start;
  for (let hop = 0; hop <= MAX_PROVIDER_REDIRECTS; hop++) {
    if (!providerHost(current)) return { kind: 'miss' };
    let res: PinnedFetchResponse;
    try {
      res = await fetchProvider(current);
    } catch (err) {
      const code = err instanceof PinnedFetchError ? err.code : 'network';
      return code === 'timeout' || code === 'network' || code === 'dns' ? { kind: 'unavailable' } : { kind: 'miss' };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop === MAX_PROVIDER_REDIRECTS) return { kind: 'miss' };
      try {
        current = new URL(location, current).toString();
      } catch {
        return { kind: 'miss' };
      }
      continue;
    }
    if (res.status === 429 || res.status >= 500) return { kind: 'unavailable' };
    if (res.status < 200 || res.status >= 300) return { kind: 'miss' };
    const kind = classifyLogo(res.headers.get('content-type'));
    if (!kind || res.body.byteLength < MIN_IMAGE_BYTES) return { kind: 'miss' };
    return { kind: 'image', buf: Buffer.from(res.body), contentType: kind.contentType, attachment: kind.attachment };
  }
  return { kind: 'miss' };
}

async function fetchFirstImage(urls: string[]): Promise<FetchResult> {
  let transient = false;
  for (const url of urls) {
    const result = await readProvider(url);
    if (result.kind === 'image') return result;
    if (result.kind === 'unavailable') transient = true;
  }
  return transient ? { kind: 'unavailable' } : { kind: 'miss' };
}

export const companyLogoRoutes: FastifyPluginAsyncZod = async (server) => {
  // Domain-based so it works for ANY account surface (Company-table rows, CRM
  // dashboard/enrichment rows) — they all carry a domain. <img> can't send a
  // token, so it's public; the domain is validated + only fixed providers are
  // fetched (no SSRF). Reserved/dev/invalid domains → 404 → initials.
  server.get(
    '/logo',
    {
      config: { public: true },
      schema: {
        querystring: z
          .object({
            domain: z.string().min(1).max(255).optional(),
            // `tech` = a Simple Icons slug for tech-stack brand glyphs.
            tech: z.string().min(1).max(64).optional(),
          })
          .refine((q) => Boolean(q.domain) !== Boolean(q.tech), {
            message: 'Provide exactly one of domain or tech',
          }),
      },
    },
    async (req, reply) => {
      let cacheKey: string;
      let urls: string[];
      if (req.query.tech) {
        const slug = req.query.tech.toLowerCase();
        if (!/^[a-z0-9-]+$/.test(slug)) return reply.code(400).send(); // no SSRF via the slug
        cacheKey = `tech:${slug}`;
        // Two fixed sources: Simple Icons (clean brand glyphs) then Devicon, which
        // carries the enterprise brands Simple Icons dropped for trademark reasons
        // (AWS, Azure, Salesforce, Oracle…). First image wins; else 404 → monogram.
        const dev = (variant: string) =>
          `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${slug}/${slug}-${variant}.svg`;
        urls = [
          `https://cdn.simpleicons.org/${slug}`,
          dev('original'),
          dev('original-wordmark'),
          dev('plain'),
          dev('plain-wordmark'),
        ];
      } else {
        const domain = resolveDomain(req.query.domain ?? null, null);
        if (!domain) return reply.code(404).send();
        cacheKey = domain;
        urls = providerUrls(domain);
      }

      const serve = (hit: NonNullable<Hit>) => {
        const sent = reply
          .header('content-type', hit.contentType)
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'public, max-age=604800, immutable');
        if (hit.attachment) {
          sent
            .header('content-disposition', 'attachment')
            .header('content-security-policy', "default-src 'none'; sandbox");
        }
        return sent.send(hit.buf);
      };

      const cached = cacheGet(cacheKey);
      if (cached !== undefined) {
        return cached ? serve(cached) : reply.code(404).send();
      }
      const fetched = await fetchFirstImage(urls);
      if (fetched.kind === 'unavailable') return reply.code(404).send();
      const hit: Hit =
        fetched.kind === 'image'
          ? { buf: fetched.buf, contentType: fetched.contentType, attachment: fetched.attachment, ts: Date.now() }
          : null;
      cacheSet(cacheKey, hit);
      return hit ? serve(hit) : reply.code(404).send();
    },
  );
};
