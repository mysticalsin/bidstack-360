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
 * (config.public). It only fetches from a FIXED provider host using the
 * company's stored domain as a parameter — no user-supplied URL — so there is no
 * SSRF surface. Reserved/dev domains are rejected.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3500;
const MAX_CACHE = 500;
const MIN_IMAGE_BYTES = 128;

type Hit = { buf: Buffer; contentType: string; ts: number } | null; // null = negative cache
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
  // DuckDuckGo icon service — key-free, reliable, returns the real brand favicon.
  urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  return urls;
}

async function fetchFirstImage(urls: string[]): Promise<{ buf: Buffer; contentType: string } | null> {
  for (const url of urls) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.startsWith('image/')) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength >= MIN_IMAGE_BYTES) return { buf, contentType: ct };
      }
    } catch {
      /* try next provider */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
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

      const serve = (hit: NonNullable<Hit>) =>
        reply
          .header('content-type', hit.contentType)
          .header('cache-control', 'public, max-age=604800, immutable')
          .send(hit.buf);

      const cached = cacheGet(cacheKey);
      if (cached !== undefined) {
        return cached ? serve(cached) : reply.code(404).send();
      }
      const fetched = await fetchFirstImage(urls);
      const hit: Hit = fetched ? { ...fetched, ts: Date.now() } : null;
      cacheSet(cacheKey, hit);
      return hit ? serve(hit) : reply.code(404).send();
    },
  );
};
