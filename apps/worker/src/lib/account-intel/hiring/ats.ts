/**
 * Public job board adapters (slice 12). Each reads the board's documented
 * public JSON or XML feed, the same data the board shows anonymously on the
 * company's careers site. No login, no scraping of rendered pages, no
 * candidate data. Descriptions are read for nothing and never stored.
 */
import type { IntelClient } from '../http.js';

/** Job boards with a public posting feed. */
export const ATS_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee', 'personio'] as const;
/** Job board id. */
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

/** A posting as read from a board, before classification. */
export interface RawPosting {
  externalId: string;
  source: AtsProvider | 'careers_jsonld' | 'theirstack' | 'adzuna';
  title: string;
  url: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  location: string | null;
  department: string | null;
  postedAt: Date | null;
}

/** One adapter: where the public feed lives and how to read it. */
export interface AtsAdapter {
  id: AtsProvider;
  label: string;
  /** Terms the adapter relies on, for the docs and the PR. */
  terms: string;
  url(board: string): string;
  parse(body: string, board: string): RawPosting[];
}

type J = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
const obj = (v: unknown): J => (v && typeof v === 'object' && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function date(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "Oslo, Norway" style location into city and country (country stays free text when not a code). */
function splitLocation(loc: string | null): { city: string | null; country: string | null } {
  if (!loc) return { city: null, country: null };
  const parts = loc.split(/[,;|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || /^remote\b/i.test(parts[0]!)) return { city: null, country: parts.length > 1 ? parts.at(-1)! : null };
  return { city: parts[0] ?? null, country: parts.length > 1 ? parts.at(-1)! : null };
}

function json(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function base(source: RawPosting['source'], externalId: string, title: string): RawPosting {
  return { externalId, source, title, url: null, city: null, state: null, country: null, location: null, department: null, postedAt: null };
}

function xmlTag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return null;
  return m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || null;
}

const enc = (b: string) => encodeURIComponent(b);

/** Adapters keyed by provider. */
export const ATS_ADAPTERS: Record<AtsProvider, AtsAdapter> = {
  greenhouse: {
    id: 'greenhouse',
    label: 'Greenhouse',
    terms: 'Greenhouse Job Board API, public GET endpoints, no key needed',
    url: (b) => `https://boards-api.greenhouse.io/v1/boards/${enc(b)}/jobs?content=true`,
    parse: (body) =>
      arr(obj(json(body)).jobs).flatMap((x) => {
        const j = obj(x);
        const id = str(j.id);
        const title = str(j.title);
        if (!id || !title) return [];
        const loc = str(obj(j.location).name);
        return [{ ...base('greenhouse', id, title), url: httpsUrl(j.absolute_url), location: loc, ...splitLocation(loc), department: str(obj(arr(j.departments)[0]).name), postedAt: date(j.first_published ?? j.updated_at) }];
      }),
  },
  lever: {
    id: 'lever',
    label: 'Lever',
    terms: 'Lever Postings API, public published postings, no key needed',
    url: (b) => `https://api.lever.co/v0/postings/${enc(b)}?mode=json`,
    parse: (body) =>
      arr(json(body)).flatMap((x) => {
        const j = obj(x);
        const id = str(j.id);
        const title = str(j.text);
        if (!id || !title) return [];
        const cat = obj(j.categories);
        const loc = str(cat.location);
        return [{ ...base('lever', id, title), url: httpsUrl(j.hostedUrl), location: loc, city: splitLocation(loc).city, country: str(j.country), department: str(cat.department) ?? str(cat.team), postedAt: date(typeof j.createdAt === 'number' ? j.createdAt : Number(j.createdAt)) }];
      }),
  },
  ashby: {
    id: 'ashby',
    label: 'Ashby',
    terms: 'Ashby public Job Posting API, listed jobs only, no key needed',
    url: (b) => `https://api.ashbyhq.com/posting-api/job-board/${enc(b)}?includeCompensation=false`,
    parse: (body) =>
      arr(obj(json(body)).jobs).flatMap((x) => {
        const j = obj(x);
        const id = str(j.id);
        const title = str(j.title);
        if (!id || !title || j.isListed === false) return [];
        const loc = str(j.location);
        return [{ ...base('ashby', id, title), url: httpsUrl(j.jobUrl), location: loc, ...splitLocation(loc), department: str(j.department) ?? str(j.team), postedAt: date(j.publishedAt) }];
      }),
  },
  workable: {
    id: 'workable',
    label: 'Workable',
    terms: 'Workable public jobs widget endpoint, published jobs only, no key needed',
    url: (b) => `https://apply.workable.com/api/v1/widget/accounts/${enc(b)}`,
    parse: (body) =>
      arr(obj(json(body)).jobs).flatMap((x) => {
        const j = obj(x);
        const id = str(j.shortcode) ?? str(j.code);
        const title = str(j.title);
        if (!id || !title) return [];
        return [{ ...base('workable', id, title), url: httpsUrl(j.url) ?? httpsUrl(j.shortlink), city: str(j.city), state: str(j.state), country: str(j.country), location: [str(j.city), str(j.country)].filter(Boolean).join(', ') || null, department: str(j.department) ?? str(j.function), postedAt: date(j.published_on ?? j.created_at) }];
      }),
  },
  smartrecruiters: {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    terms: 'SmartRecruiters Posting API, public postings, no key needed',
    url: (b) => `https://api.smartrecruiters.com/v1/companies/${enc(b)}/postings?limit=100`,
    parse: (body, board) =>
      arr(obj(json(body)).content).flatMap((x) => {
        const j = obj(x);
        const id = str(j.id);
        const title = str(j.name);
        if (!id || !title) return [];
        const loc = obj(j.location);
        const country = str(loc.country);
        return [{ ...base('smartrecruiters', id, title), url: `https://jobs.smartrecruiters.com/${enc(board)}/${enc(id)}`, city: str(loc.city), state: str(loc.region), country: country ? country.toUpperCase() : null, location: str(loc.fullLocation), department: str(obj(j.department).label) ?? str(obj(j.function).label), postedAt: date(j.releasedDate) }];
      }),
  },
  recruitee: {
    id: 'recruitee',
    label: 'Recruitee',
    terms: 'Recruitee Careers Site API, published offers, no key needed',
    url: (b) => `https://${enc(b)}.recruitee.com/api/offers/`,
    parse: (body) =>
      arr(obj(json(body)).offers).flatMap((x) => {
        const j = obj(x);
        const id = str(j.id);
        const title = str(j.title);
        if (!id || !title || (j.status && j.status !== 'published')) return [];
        return [{ ...base('recruitee', id, title), url: httpsUrl(j.careers_url), city: str(j.city), country: str(j.country_code) ?? str(j.country), location: str(j.location), department: str(j.department), postedAt: date(j.published_at ?? j.created_at) }];
      }),
  },
  personio: {
    id: 'personio',
    label: 'Personio',
    terms: 'Personio public XML job feed, published positions, no key needed',
    url: (b) => `https://${enc(b)}.jobs.personio.de/xml`,
    parse: (body, board) =>
      (body.match(/<position>[\s\S]*?<\/position>/gi) ?? []).flatMap((block) => {
        const id = xmlTag(block, 'id');
        const title = xmlTag(block, 'name');
        if (!id || !title) return [];
        const office = xmlTag(block, 'office');
        return [{ ...base('personio', id, title), url: `https://${enc(board)}.jobs.personio.de/job/${enc(id)}`, city: office, location: office, department: xmlTag(block, 'department') ?? xmlTag(block, 'recruitingCategory'), postedAt: date(xmlTag(block, 'createdAt')) }];
      }),
  },
};

const BOARD_LINKS: Array<{ provider: AtsProvider; re: RegExp }> = [
  { provider: 'greenhouse', re: /https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/gi },
  { provider: 'greenhouse', re: /https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi },
  { provider: 'lever', re: /https?:\/\/jobs(?:\.eu)?\.lever\.co\/([a-z0-9_-]+)/gi },
  { provider: 'ashby', re: /https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/gi },
  { provider: 'workable', re: /https?:\/\/apply\.workable\.com\/([a-z0-9_-]+)/gi },
  { provider: 'smartrecruiters', re: /https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([a-z0-9_-]+)/gi },
  { provider: 'recruitee', re: /https?:\/\/([a-z0-9-]+)\.recruitee\.com/gi },
  { provider: 'personio', re: /https?:\/\/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/gi },
];

const NOT_A_BOARD = new Set(['embed', 'api', 'v1', 'www', 'jobs', 'careers', 'static', 'assets']);

/** Job boards the careers page links to, in page order. Only explicit links count. */
export function detectAtsBoards(html: string): Array<{ provider: AtsProvider; board: string }> {
  const hits: Array<{ provider: AtsProvider; board: string; at: number }> = [];
  for (const { provider, re } of BOARD_LINKS) {
    for (const m of html.matchAll(re)) {
      const board = m[1]!;
      if (!NOT_A_BOARD.has(board.toLowerCase())) hits.push({ provider, board, at: m.index ?? 0 });
    }
  }
  const seen = new Set<string>();
  return hits
    .sort((a, b) => a.at - b.at)
    .filter((h) => {
      const k = `${h.provider}:${h.board.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(({ provider, board }) => ({ provider, board }));
}

function* jsonLdNodes(html: string): Generator<J> {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const parsed = json(m[1]!.trim());
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const n = stack.pop();
      if (Array.isArray(n)) stack.push(...n);
      else if (n && typeof n === 'object') {
        const o = n as J;
        yield o;
        if (o['@graph']) stack.push(o['@graph']);
      }
    }
  }
}

/** schema.org JobPosting entries embedded in a careers page. */
export function parseJobPostingJsonLd(html: string, pageUrl: string): RawPosting[] {
  const out: RawPosting[] = [];
  for (const n of jsonLdNodes(html)) {
    const type = n['@type'];
    if (!(type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting')))) continue;
    const title = str(n.title);
    if (!title) continue;
    const ident = n.identifier;
    const url = httpsUrl(n.url) ?? httpsUrl(new URL(pageUrl).toString());
    const externalId = (typeof ident === 'object' ? str(obj(ident).value) : str(ident)) ?? url ?? title;
    const loc = obj(Array.isArray(n.jobLocation) ? n.jobLocation[0] : n.jobLocation);
    const addr = obj(loc.address);
    const city = str(addr.addressLocality);
    const country = str(addr.addressCountry) ?? str(obj(addr.addressCountry).name);
    out.push({ ...base('careers_jsonld', externalId, title), url, city, state: str(addr.addressRegion), country, location: [city, country].filter(Boolean).join(', ') || null, department: str(n.occupationalCategory) ?? str(n.industry), postedAt: date(n.datePosted) });
  }
  return out;
}

/** Account inputs for a hiring fetch. */
export interface PostingTarget {
  domain: string | null;
  careersUrl: string | null;
  atsProvider: string | null;
  atsBoard: string | null;
}

/** Result of one hiring fetch. */
export interface PostingFetchResult {
  boards: Array<{ provider: AtsProvider; board: string }>;
  postings: RawPosting[];
  errors: string[];
  careersUrl: string | null;
}

const MAX_BOARDS = 3;

function isProvider(p: string | null): p is AtsProvider {
  return !!p && (ATS_PROVIDERS as readonly string[]).includes(p);
}

/**
 * Read the configured board first, then the careers page (JSON-LD and linked
 * boards). A board slug is never guessed from the company name or domain.
 */
export async function fetchCompanyPostings(client: IntelClient, t: PostingTarget): Promise<PostingFetchResult> {
  const errors: string[] = [];
  const boards: Array<{ provider: AtsProvider; board: string }> = [];
  const postings: RawPosting[] = [];
  if (isProvider(t.atsProvider) && t.atsBoard) boards.push({ provider: t.atsProvider, board: t.atsBoard });

  const careersUrl = t.careersUrl ?? (t.domain ? `https://www.${t.domain.replace(/^www\./, '')}/careers` : null);
  if (careersUrl) {
    try {
      const html = await client.get(careersUrl, { accept: 'text/html' });
      postings.push(...parseJobPostingJsonLd(html, careersUrl));
      for (const b of detectAtsBoards(html)) if (!boards.some((x) => x.provider === b.provider && x.board.toLowerCase() === b.board.toLowerCase())) boards.push(b);
    } catch (err) {
      // A guessed /careers URL that does not exist is not an error worth reporting.
      if (t.careersUrl) errors.push(`careers page: ${(err as Error).message}`);
    }
  }

  for (const b of boards.slice(0, MAX_BOARDS)) {
    const a = ATS_ADAPTERS[b.provider];
    try {
      postings.push(...a.parse(await client.get(a.url(b.board), { accept: b.provider === 'personio' ? 'application/xml' : 'application/json' }), b.board));
    } catch (err) {
      errors.push(`${b.provider} ${b.board}: ${(err as Error).message}`);
    }
  }
  return { boards, postings, errors, careersUrl: t.careersUrl ?? (postings.some((p) => p.source === 'careers_jsonld') ? careersUrl : null) };
}
