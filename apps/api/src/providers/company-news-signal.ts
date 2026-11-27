// Free, keyless company "intent" signal: recent news headlines from Google News
// RSS. No API key, no cost, no paid intent vendor — a public-web activity proxy
// (funding, leadership moves, expansions, product launches) the pre-sales team
// can read off the account view.
//
// Honest scope: this is NEWS-as-signal, not licensed buyer-intent (Bombora/6sense
// are paid). The host is fixed (news.google.com); the company name is URL-encoded
// into the query, so there is no SSRF surface. A feed that does not answer is
// `unavailable`, not an empty match. Confidence is attached only after an answer.

export interface NewsSignalItem {
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
}

/** `ok` means the feed answered, including a real empty channel. */
export type NewsSignalRead =
  | { read: 'ok'; items: NewsSignalItem[] }
  | { read: 'unavailable'; items: [] };

/** Courtesy-feed confidence. Only present after the feed answered. */
const OPEN_WEB_CONFIDENCE = 0.62;

export interface AccountNewsSignalBody {
  source: 'google-news';
  fetchedAt: string;
  read: 'ok' | 'unavailable';
  sourceAttribution?: {
    source: string;
    label: string;
    sourceUrl: string;
    fetchedAt: string;
    confidence: number;
    providerMetadata: Record<string, unknown>;
  };
  items: NewsSignalItem[];
}

/** Wire body for the account news card. A missed feed carries no confidence score. */
export function accountNewsSignalBody(
  result: NewsSignalRead,
  fetchedAt: string,
  accountQuery: string,
): AccountNewsSignalBody {
  if (result.read !== 'ok') {
    return { source: 'google-news', fetchedAt, read: 'unavailable', items: [] };
  }
  return {
    source: 'google-news',
    fetchedAt,
    read: 'ok',
    sourceAttribution: {
      source: 'google_news_open_web',
      label: 'Google News',
      sourceUrl: 'https://news.google.com/',
      fetchedAt,
      confidence: OPEN_WEB_CONFIDENCE,
      providerMetadata: { signalType: 'public_news', accountQuery },
    },
    items: result.items,
  };
}

const FEED_TIMEOUT_MS = 8_000;
const MAX_ITEMS = 8;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&#0?38;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  if (!m?.[1]) return null;
  // Strip a CDATA wrapper if present, then decode entities.
  return decodeEntities(m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
}

/**
 * Fetch recent news headlines for a company name. Returns at most MAX_ITEMS,
 * newest first as served by Google News. A blank name is an empty match.
 * A non-200 or a thrown fetch is `unavailable`: the feed did not answer.
 * `fetchImpl` is injectable for tests.
 */
export async function fetchCompanyNewsSignals(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NewsSignalRead> {
  const q = name.trim();
  if (!q) return { read: 'ok', items: [] };
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(`"${q}"`)}` +
    `&hl=en-US&gl=US&ceid=US:en`;

  let xml: string;
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      headers: { accept: 'application/rss+xml, application/xml, text/xml' },
    });
    if (!res.ok) return { read: 'unavailable', items: [] };
    xml = await res.text();
  } catch {
    return { read: 'unavailable', items: [] };
  }

  const items: NewsSignalItem[] = [];
  // Iterate <item> blocks. Google News titles are "Headline - Source"; the
  // <source> tag carries the publisher, so we prefer it and strip the suffix.
  const blocks = xml.split(/<item>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/item>/i)[0] ?? '';
    const rawTitle = tag(block, 'title');
    const link = tag(block, 'link');
    if (!rawTitle || !link) continue;
    const source = tag(block, 'source');
    const title =
      source && rawTitle.endsWith(` - ${source}`)
        ? rawTitle.slice(0, rawTitle.length - source.length - 3)
        : rawTitle;
    const pub = tag(block, 'pubDate');
    const publishedAt = pub ? (Number.isNaN(Date.parse(pub)) ? null : new Date(pub).toISOString()) : null;
    items.push({ title, url: link, source, publishedAt });
    if (items.length >= MAX_ITEMS) break;
  }
  return { read: 'ok', items };
}
