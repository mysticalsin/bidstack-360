// Account signals (v21): one vocabulary for the account pulse, the signals
// timeline, the initiatives board, the watchdog news pipeline and the
// portfolio momentum view. Pure functions only (no I/O, no node built-ins) so
// the API, the worker and the web app share the exact same rules.
// Contract: /workspace/fleet/polo-signals-api.md
import { z } from 'zod';

// ── Categories ──────────────────────────────────────────────────────────────

/** Watch event kinds, mirroring the Prisma enum watchdog_event_kind. */
export const WATCH_EVENT_KINDS = [
  'EARNINGS_RELEASE',
  'EARNINGS_DATE',
  'ANNUAL_REPORT',
  'QUARTERLY_REPORT',
  'FILING',
  'GUIDANCE_CHANGE',
  'M_AND_A',
  'RESTRUCTURING',
  'LEADERSHIP_CHANGE',
  'INSOLVENCY',
  'OTHER_DISCLOSURE',
  'NEWS_SIGNAL',
  'FUNDING_ROUND',
  'PRODUCT_LAUNCH',
  'STRATEGIC_INITIATIVE',
  'HIRING_SPIKE',
  'LAYOFFS',
  'PARTNERSHIP',
  // v22.1: analyst notes, ratings, price targets, stock moves and investor commentary.
  'MARKET_COMMENTARY',
] as const;
export type WatchEventKind = (typeof WATCH_EVENT_KINDS)[number];

/** What a person scanning the account cares about. */
export const SignalCategory = z.enum([
  'funding',
  'launch',
  'initiative',
  'exec_move',
  'risk',
  'earnings',
  'hiring',
  'm_and_a',
  'partnership',
  'filing',
  'market',
  'news',
  // Our side of the timeline.
  'meeting',
  'deal',
  'bid',
]);
export type SignalCategory = z.infer<typeof SignalCategory>;

export const SIGNAL_CATEGORY_LABEL: Record<SignalCategory, string> = {
  funding: 'Funding',
  launch: 'Launch',
  initiative: 'Initiative',
  exec_move: 'Exec move',
  risk: 'Risk',
  earnings: 'Earnings',
  hiring: 'Hiring',
  m_and_a: 'M&A',
  partnership: 'Partnership',
  filing: 'Filing',
  market: 'Market / analyst',
  news: 'News',
  meeting: 'Meeting',
  deal: 'Deal',
  bid: 'Bid',
};

export type Implication = 'OPPORTUNITY' | 'RISK' | 'NEUTRAL';

export function categoryForKind(kind: string, implication?: Implication | null): SignalCategory {
  switch (kind) {
    case 'FUNDING_ROUND':
      return 'funding';
    case 'PRODUCT_LAUNCH':
      return 'launch';
    case 'STRATEGIC_INITIATIVE':
      return 'initiative';
    case 'LEADERSHIP_CHANGE':
      return 'exec_move';
    case 'EARNINGS_RELEASE':
    case 'EARNINGS_DATE':
    case 'GUIDANCE_CHANGE':
    case 'QUARTERLY_REPORT':
    case 'ANNUAL_REPORT':
      return 'earnings';
    case 'HIRING_SPIKE':
      return 'hiring';
    case 'M_AND_A':
      return 'm_and_a';
    case 'PARTNERSHIP':
      return 'partnership';
    case 'MARKET_COMMENTARY':
      return 'market';
    case 'LAYOFFS':
    case 'INSOLVENCY':
    case 'RESTRUCTURING':
      return 'risk';
    case 'FILING':
    case 'OTHER_DISCLOSURE':
      return implication === 'RISK' ? 'risk' : 'filing';
    default:
      return implication === 'RISK' ? 'risk' : 'news';
  }
}

// ── Text helpers ────────────────────────────────────────────────────────────

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

/** Strip tags and entities, collapse whitespace, swap long dashes for commas. */
export function cleanText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITY[e] ?? (e.startsWith('#') ? safeChar(e.slice(1)) : m))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeChar(code: string): string {
  const n = code.startsWith('x') ? Number.parseInt(code.slice(1), 16) : Number.parseInt(code, 10);
  return Number.isFinite(n) && n > 31 && n < 0x10ffff ? String.fromCodePoint(n) : '';
}

/** "Acme raises $20M - Reuters" -> "Acme raises $20M" (publisher kept apart). */
export function stripPublisher(title: string, publisher?: string | null): string {
  const t = cleanText(title);
  if (publisher) {
    const p = cleanText(publisher);
    for (const sep of [' - ', ' | ', ', ']) {
      if (p && t.toLowerCase().endsWith(`${sep}${p}`.toLowerCase())) return t.slice(0, t.length - sep.length - p.length).trim();
    }
  }
  const m = /^(.{20,}?)\s[-|]\s[^-|]{2,40}$/.exec(t);
  return m?.[1] ? m[1].trim() : t;
}

/** One line, at most `max` characters, cut on a word boundary. */
export function oneLine(text: string, max = 160): string {
  const t = cleanText(text);
  const first = /^(.{40,}?[.!?])\s/.exec(t)?.[1] ?? t;
  if (first.length <= max) return first;
  const cut = first.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:\s]+$/, '')}…`;
}

const STOP = new Set(
  'a an and the of for to in on at by with from as is are was were be its it this that new says said after over into amid about up out more than will has have had inc ltd plc corp co company group sa ag nv llc'.split(' '),
);

/** Lower-case significant tokens, without the company's own name words. */
export function titleTokens(title: string, companyName = ''): string[] {
  const own = new Set(companyName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return cleanText(title)
    .toLowerCase()
    .replace(/[^a-z0-9$%. ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/\.$/, ''))
    .filter((w) => w.length > 1 && !STOP.has(w) && !own.has(w));
}

/** FNV-1a 64-bit as 16 hex chars; stable, dependency free, browser safe. */
export function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Same story, different outlet: kind plus the six most telling title tokens,
 * sorted so word order does not matter.
 */
export function signalDedupeKey(kind: string, title: string, companyName = ''): string {
  const toks = [...new Set(titleTokens(title, companyName))].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 6).sort();
  return `${kind.toLowerCase()}:${fnv1a64(toks.join(' '))}`;
}

/** Jaccard overlap of title tokens, for fuzzy dedupe inside one batch. */
export function titleSimilarity(a: string, b: string, companyName = ''): number {
  const x = new Set(titleTokens(a, companyName));
  const y = new Set(titleTokens(b, companyName));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const t of x) if (y.has(t)) both++;
  return both / (x.size + y.size - both);
}

// ── Classifier ──────────────────────────────────────────────────────────────

export interface SignalClassification {
  kind: WatchEventKind;
  category: SignalCategory;
  implication: Implication;
  /** -1..1 */
  sentiment: number;
  /** Which rule fired, for the rationale line. */
  rule: string;
}

interface Rule {
  kind: WatchEventKind;
  re: RegExp;
  implication: Implication;
  sentiment: number;
  rule: string;
}

// Order matters: the first match wins, most consequential first.
const RULES: Rule[] = [
  { kind: 'INSOLVENCY', re: /\b(insolven\w*|bankrupt\w*|administration order|chapter 11|receivership|liquidation)\b/i, implication: 'RISK', sentiment: -1, rule: 'insolvency wording' },
  { kind: 'LAYOFFS', re: /\b(lay ?offs?|laid off|job cuts?|cuts? [\d,]+ (jobs|roles|staff)|cutting [\d,]+|redundanc\w*|workforce reduction|headcount reduction)\b/i, implication: 'RISK', sentiment: -0.7, rule: 'layoffs wording' },
  { kind: 'NEWS_SIGNAL', re: /\b(lawsuit|sued|fined|fines?|probe|investigat\w*|data breach|breach|outage|cyber ?attack|ransomware|(credit|debt|bond) (rating )?downgrade[sd]?|downgrade[sd]? [^.]{0,40}?\b(credit|debt|bond)|default\w*|penalt\w*|sanction\w*|recall\w*|class action)\b/i, implication: 'RISK', sentiment: -0.6, rule: 'risk wording' },
  { kind: 'M_AND_A', re: /\b(acquires?|acquired|acquisition|to acquire|merger|merges?|takeover|to buy|buys|divest\w*|sells? (its |the )?\w+ (unit|business|division))\b/i, implication: 'OPPORTUNITY', sentiment: 0.3, rule: 'M&A wording' },
  { kind: 'FUNDING_ROUND', re: /\b(raises?|raised|funding round|series [a-h]\b|seed round|growth round|secures? [$€£]?\s?[\d.,]+ ?(m|bn|million|billion)|venture (capital|funding)|financing round|private placement|capital raise)\b/i, implication: 'OPPORTUNITY', sentiment: 0.8, rule: 'funding wording' },
  { kind: 'LEADERSHIP_CHANGE', re: /\b(appoints?|appointed|names? (a |its )?(new )?(chief|ceo|cfo|cto|cio|coo|ciso|president|head)|steps? down|resigns?|resignation|retires?|joins as|new (ceo|cfo|cto|cio|coo|ciso|chair\w*)|successor|interim (ceo|cfo))\b/i, implication: 'OPPORTUNITY', sentiment: 0.1, rule: 'leadership wording' },
  { kind: 'EARNINGS_RELEASE', re: /\b(earnings|quarterly results|annual results|(q[1-4]|first|second|third|fourth)[- ]quarter|full[- ]year results|net (income|profit)|profit (rose|fell|up|down|jumps?|drops?)|revenue (rose|fell|grew|up|down)|guidance|beats? estimates|miss(es|ed)? estimates)\b/i, implication: 'NEUTRAL', sentiment: 0, rule: 'earnings wording' },
  { kind: 'PRODUCT_LAUNCH', re: /\b(launch(es|ed|ing)?|unveil\w*|introduc(es|ed|ing)|rolls? out|rolled out|debuts?|releases? (a |its )?new|new (platform|product|service|app|offering))\b/i, implication: 'OPPORTUNITY', sentiment: 0.5, rule: 'launch wording' },
  { kind: 'PARTNERSHIP', re: /\b(partner(s|ed|ing|ship)? with|partnership|teams? up|alliance|collaborat\w* with|strategic agreement|signs? (a )?deal with|selects?|chooses)\b/i, implication: 'OPPORTUNITY', sentiment: 0.4, rule: 'partnership wording' },
  { kind: 'STRATEGIC_INITIATIVE', re: /\b(initiative|transformation|programme|program|moderni[sz]\w*|digiti[sz]\w*|migrat\w* to|invest(s|ing|ment)? (in|of)|expan(d|ds|sion)|opens? (a )?(new )?(\w+ )?(office|hub|centre|center|plant|facility|campus)|strategy|roadmap|plans? to)\b/i, implication: 'OPPORTUNITY', sentiment: 0.5, rule: 'initiative wording' },
  { kind: 'HIRING_SPIKE', re: /\b(hiring|to hire|recruit\w*|new jobs|[\d,]+ (jobs|roles|hires))\b/i, implication: 'OPPORTUNITY', sentiment: 0.5, rule: 'hiring wording' },
];

const POSITIVE = /\b(beats?|record|surge\w*|soar\w*|jumps?|rises?|rose|growth|grew|strong|wins?|award\w*|upgrade[sd]?)\b/i;
const NEGATIVE = /\b(miss(es|ed)?|falls?|fell|drops?|plunge\w*|slump\w*|weak|loss(es)?|warns?|warning|cuts? (guidance|forecast)|decline\w*)\b/i;

// v22.1: stock-market chatter. Price targets, ratings, analyst notes, share
// moves and investor-commentary headlines ("Should X (TSX:ATZ) attract
// attention?") are about the stock, not the business, so they get their own
// low-weight category instead of tripping the funding or earnings rules.
const MARKET_WORDS =
  /\b(price target|target price|pt (raised|cut|lowered)|analysts?|(strong |moderate )?(buy|sell|hold) rating|rated|ratings?|re-?rated|upgrades?|upgraded|downgrades?|downgraded|outperform|underperform|overweight|underweight|equal[- ]weight|market perform|consensus|stocks?|shares? (price|rose|fell|jump\w*|drop\w*|climb\w*|slid\w*|slip\w*|gain\w*|surg\w*|plung\w*|rall\w*|sink\w*|tumbl\w*|up|down|higher|lower)|share price|investors?|investor (day|attention)|valuation|undervalued|overvalued|trading session|market (tone|outlook|cap)|short interest|dividend yield|cash flow|trades? at a (discount|premium)|catalysts?|investment (narrative|case|thesis)|buy the dip|52-week|all-time high|(rise|rose|fell|gain(ed)?|drop(ped)?|climb(ed)?|jump(ed)?) [\d.]+ ?%|slideshow)\b/i;
/** "(TSX:ATZ)", "(NYSE: DNB)", "(ATZ.TO)", "(TSX:ATZ:CA)". */
const TICKER_TAG = /\((?:[A-Z]{2,8}: ?)?[A-Z0-9]{1,6}(?:\.[A-Z]{1,3})?(?::[A-Z]{2})?\)/;
/** Real business events keep their own category even when a stock word appears. */
const BUSINESS_EVENT = /\b(series [a-h]\b|seed round|funding round|raises? [$€£]\s?[\d.,]+|acquires?|acquired|acquisition|to acquire|merger|takeover|insolven\w*|bankrupt\w*|lay ?offs?|job cuts?|appoints?|appointed|steps? down|resigns?|new (ceo|cfo|cto|cio|coo|chair\w*)|partners? with|partnership|launch(es|ed)?|unveil\w*|(reports?|posts?|announces?) (q[1-4]|first|second|third|fourth|full[- ]year|quarterly|annual) (quarter )?(results|earnings))\b/i;
const MARKET_NEGATIVE = /\b(downgrade[sd]?|cuts?|lower(s|ed)?|underperform|underweight|sell rating|slid\w*|slip\w*|fell|drop\w*|plung\w*|tumbl\w*|sink\w*|pressure)\b/i;
const MARKET_POSITIVE = /\b(upgrade[sd]?|raise[sd]?|boost\w*|outperform|overweight|buy rating|rose|gain\w*|climb\w*|jump\w*|surg\w*|rall\w*|strong)\b/i;

/** True for analyst, rating, price-target, stock-move and investor-commentary headlines. */
export function isMarketCommentary(rawTitle: string): boolean {
  const head = cleanText(rawTitle);
  if (BUSINESS_EVENT.test(head)) return false;
  if (MARKET_WORDS.test(head)) return true;
  // SEO investor pieces: a ticker tag and a question ("Can X (TSX:ATZ) expand?").
  return TICKER_TAG.test(rawTitle) && /\?\s*$/.test(head);
}

/** Rule-based classification of a headline (plus optional description). */
export function classifySignalText(title: string, description = ''): SignalClassification {
  const text = `${cleanText(title)} ${cleanText(description)}`;
  const head = cleanText(title);
  const hardRisk = RULES.slice(0, 3).find((r) => r.re.test(head));
  if (!hardRisk && isMarketCommentary(title)) {
    const neg = MARKET_NEGATIVE.test(head);
    const pos = MARKET_POSITIVE.test(head);
    const implication: Implication = neg && !pos ? 'RISK' : 'NEUTRAL';
    const sentiment = neg && !pos ? -0.2 : pos && !neg ? 0.2 : 0;
    return { kind: 'MARKET_COMMENTARY', category: 'market', implication, sentiment, rule: 'market or analyst wording' };
  }
  // Headline first: descriptions often mention unrelated boilerplate.
  const hit = RULES.find((r) => r.re.test(head)) ?? RULES.find((r) => r.re.test(text));
  let kind: WatchEventKind = hit?.kind ?? 'NEWS_SIGNAL';
  let implication: Implication = hit?.implication ?? 'NEUTRAL';
  let sentiment = hit?.sentiment ?? 0;
  const rule = hit?.rule ?? 'no rule matched';
  const pos = POSITIVE.test(head);
  const neg = NEGATIVE.test(head);
  if (kind === 'EARNINGS_RELEASE' || kind === 'NEWS_SIGNAL') {
    if (pos && !neg) {
      sentiment = kind === 'NEWS_SIGNAL' && implication === 'RISK' ? sentiment : 0.5;
      if (implication === 'NEUTRAL') implication = 'OPPORTUNITY';
    } else if (neg && !pos) {
      sentiment = Math.min(sentiment, -0.5);
      implication = 'RISK';
    }
  }
  if (kind === 'LEADERSHIP_CHANGE' && /\b(steps? down|resigns?|resignation|ousted|fired)\b/i.test(head)) {
    sentiment = -0.2;
    implication = 'NEUTRAL';
  }
  if (kind === 'NEWS_SIGNAL' && implication === 'NEUTRAL') kind = 'NEWS_SIGNAL';
  return { kind, category: categoryForKind(kind, implication), implication, sentiment, rule };
}

/** Sentiment for rows that predate the classifier (EDGAR etc.). */
export function sentimentForRow(row: { sentiment?: number | null; implication: Implication; kind: string }): number {
  if (typeof row.sentiment === 'number') return row.sentiment;
  if (row.kind === 'INSOLVENCY') return -1;
  return row.implication === 'OPPORTUNITY' ? 0.5 : row.implication === 'RISK' ? -0.5 : 0;
}

// ── Importance ──────────────────────────────────────────────────────────────

const KIND_BASE: Partial<Record<WatchEventKind, number>> = {
  INSOLVENCY: 95,
  M_AND_A: 80,
  FUNDING_ROUND: 75,
  LAYOFFS: 75,
  RESTRUCTURING: 70,
  LEADERSHIP_CHANGE: 65,
  STRATEGIC_INITIATIVE: 60,
  GUIDANCE_CHANGE: 60,
  EARNINGS_RELEASE: 55,
  PRODUCT_LAUNCH: 55,
  PARTNERSHIP: 50,
  HIRING_SPIKE: 50,
  ANNUAL_REPORT: 45,
  QUARTERLY_REPORT: 40,
  EARNINGS_DATE: 35,
  FILING: 35,
  OTHER_DISCLOSURE: 30,
  NEWS_SIGNAL: 30,
  // Stock chatter is context, never an alert on its own.
  MARKET_COMMENTARY: 15,
};

/** Sources that publish first-hand (the company itself or a regulator). */
const PRIMARY_SOURCES = new Set(['sec_edgar', 'financials', 'companies_house', 'amf', 'ir_feed', 'company_rss', 'apollo', 'seamless']);

export const ALERT_IMPORTANCE = 70;

/** 0..100: kind, risk, first-hand source and how many outlets carried it. */
export function importanceScore(input: { kind: string; implication: Implication; source: string; mentions?: number }): number {
  let s = KIND_BASE[input.kind as WatchEventKind] ?? 30;
  // Risk news (lawsuit, fine, breach, downgrade) is crucial for a key account,
  // so it starts at the restructuring level rather than generic news.
  if (input.kind === 'NEWS_SIGNAL' && input.implication === 'RISK') s = 60;
  if (input.implication === 'RISK') s += input.kind === 'MARKET_COMMENTARY' ? 5 : 10;
  if (PRIMARY_SOURCES.has(input.source)) s += 10;
  s += Math.min(15, Math.max(0, (input.mentions ?? 1) - 1) * 5);
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Legacy severity (1..5) for rows the older watchdog UI still reads. */
export function severityFromImportance(importance: number): number {
  return Math.max(1, Math.min(5, Math.ceil(importance / 20)));
}

// ── Momentum ────────────────────────────────────────────────────────────────

export const MomentumTrend = z.enum(['gaining', 'steady', 'declining']);
export type MomentumTrend = z.infer<typeof MomentumTrend>;

export const DriverKey = z.enum(['pipeline', 'winloss', 'meetings', 'hiring', 'news']);
export type DriverKey = z.infer<typeof DriverKey>;

export interface MomentumOpp {
  createdAt: Date;
  /** When it closed (won or lost); null while open. */
  closedAt: Date | null;
  outcome: 'open' | 'won' | 'lost';
  valueMicros: bigint | number;
}
export interface MomentumEvent {
  occurredAt: Date;
  importance: number;
  sentiment: number;
  category: SignalCategory;
}
export interface MomentumData {
  opps: MomentumOpp[];
  meetings: Date[];
  postings: Date[];
  events: MomentumEvent[];
  /** Fraction, e.g. 0.08 for +8% (firmographics, undated snapshot). */
  headcountGrowth12m: number | null;
}

export interface MomentumDriver {
  key: DriverKey;
  label: string;
  /** -1..1 */
  signal: number;
  /** Weighted contribution in score points (sum of drivers = score - 50). */
  points: number;
  direction: 'up' | 'down' | 'flat';
  detail: string;
}

export interface MomentumResult {
  score: number;
  delta: number;
  trend: MomentumTrend;
  /** Weekly scores, oldest first, last point is now. */
  series: Array<{ at: string; score: number }>;
  drivers: MomentumDriver[];
  verdict: string;
  /** Share of the weight that had data (0..1); low means "early read". */
  coverage: number;
}

const DAY = 86_400_000;
export const MOMENTUM_WEIGHTS: Record<DriverKey, number> = { pipeline: 0.3, meetings: 0.25, winloss: 0.15, hiring: 0.15, news: 0.15 };
const LABEL: Record<DriverKey, string> = { pipeline: 'Pipeline', winloss: 'Win and loss', meetings: 'Meetings', hiring: 'Hiring', news: 'News' };

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const toNum = (v: bigint | number) => (typeof v === 'bigint' ? Number(v) : v);
const ratioChange = (now: number, before: number) => (now === before ? 0 : (now - before) / Math.max(now, before));
const inWindow = (d: Date, from: number, to: number) => d.getTime() > from && d.getTime() <= to;

function compactMoney(micros: number): string {
  const v = micros / 1_000_000;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}K`;
  return `${Math.round(v)}`;
}

function openValueAt(opps: MomentumOpp[], t: number): number {
  let sum = 0;
  for (const o of opps) {
    if (o.createdAt.getTime() > t) continue;
    if (o.closedAt && o.closedAt.getTime() <= t) continue;
    if (!o.closedAt && o.outcome !== 'open') continue; // closed, date unknown
    sum += toNum(o.valueMicros);
  }
  return sum;
}

interface Component {
  key: DriverKey;
  signal: number;
  detail: string;
}

function components(d: MomentumData, asOf: number): Component[] {
  const out: Component[] = [];
  // Pipeline: open value now vs 90 days earlier.
  const nowV = openValueAt(d.opps, asOf);
  const prevV = openValueAt(d.opps, asOf - 90 * DAY);
  if (nowV > 0 || prevV > 0) {
    const s = clamp(ratioChange(nowV, prevV) * 1.25);
    const pct = prevV > 0 ? Math.round(((nowV - prevV) / prevV) * 100) : null;
    const detail =
      pct === null
        ? `${compactMoney(nowV)} open pipeline, all opened in the last 90 days`
        : pct === 0
          ? `${compactMoney(nowV)} open pipeline, flat over 90 days`
          : `Open pipeline ${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% in 90 days (${compactMoney(nowV)})`;
    out.push({ key: 'pipeline', signal: s, detail });
  }
  // Win/loss: last 180 days.
  let won = 0;
  let lost = 0;
  for (const o of d.opps) {
    if (!o.closedAt || !inWindow(o.closedAt, asOf - 180 * DAY, asOf)) continue;
    if (o.outcome === 'won') won++;
    else if (o.outcome === 'lost') lost++;
  }
  if (won + lost > 0) {
    out.push({
      key: 'winloss',
      signal: clamp((won - lost) / (won + lost)),
      detail: `${won} won, ${lost} lost in the last 6 months`,
    });
  }
  // Meetings: frequency (60 vs prior 60 days) and recency.
  const past = d.meetings.filter((m) => m.getTime() <= asOf);
  if (past.length) {
    const a = past.filter((m) => inWindow(m, asOf - 60 * DAY, asOf)).length;
    const b = past.filter((m) => inWindow(m, asOf - 120 * DAY, asOf - 60 * DAY)).length;
    const last = Math.max(...past.map((m) => m.getTime()));
    const days = Math.floor((asOf - last) / DAY);
    const recency = days <= 14 ? 1 : days <= 30 ? 0.5 : days <= 60 ? 0 : days <= 90 ? -0.5 : -1;
    const freq = a + b === 0 ? -0.5 : ratioChange(a, b);
    const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    out.push({
      key: 'meetings',
      signal: clamp(freq * 0.6 + recency * 0.4),
      detail: `${a} meeting${a === 1 ? '' : 's'} in 60 days (${b} before), last ${when}`,
    });
  }
  // Hiring: postings 30 vs prior 30 days, blended with 12-month headcount.
  const pa = d.postings.filter((p) => inWindow(p, asOf - 30 * DAY, asOf)).length;
  const pb = d.postings.filter((p) => inWindow(p, asOf - 60 * DAY, asOf - 30 * DAY)).length;
  const hasPostings = pa + pb > 0;
  const hc = d.headcountGrowth12m;
  if (hasPostings || hc !== null) {
    const parts: number[] = [];
    const words: string[] = [];
    if (hasPostings) {
      parts.push(ratioChange(pa, pb));
      words.push(`${pa} roles posted in 30 days (${pb} before)`);
    }
    if (hc !== null) {
      parts.push(clamp(hc / 0.15));
      words.push(`headcount ${hc >= 0 ? '+' : ''}${Math.round(hc * 100)}% in 12 months`);
    }
    const s = parts.reduce((x, y) => x + y, 0) / parts.length;
    const text = words.join(', ');
    out.push({ key: 'hiring', signal: clamp(s), detail: text.charAt(0).toUpperCase() + text.slice(1) });
  }
  // News: importance-weighted sentiment over 90 days.
  const recent = d.events.filter((e) => inWindow(e.occurredAt, asOf - 90 * DAY, asOf));
  if (recent.length) {
    let w = 0;
    let s = 0;
    for (const e of recent) {
      const wi = Math.max(10, e.importance);
      w += wi;
      s += wi * e.sentiment;
    }
    const pos = recent.filter((e) => e.sentiment > 0.15).length;
    const neg = recent.filter((e) => e.sentiment < -0.15).length;
    const avg = s / w;
    const tone = avg > 0.15 ? 'mostly positive' : avg < -0.15 ? 'mostly negative' : 'mixed';
    out.push({
      key: 'news',
      signal: clamp(avg * 1.4),
      detail: `News ${tone}: ${pos} positive, ${neg} negative in 90 days`,
    });
  }
  return out;
}

function scoreOf(comps: Component[]): { score: number; coverage: number; points: Map<DriverKey, number> } {
  const points = new Map<DriverKey, number>();
  const wsum = comps.reduce((s, c) => s + MOMENTUM_WEIGHTS[c.key], 0);
  if (!wsum) return { score: 50, coverage: 0, points };
  let acc = 0;
  for (const c of comps) {
    const p = (50 * MOMENTUM_WEIGHTS[c.key] * c.signal) / wsum;
    points.set(c.key, p);
    acc += p;
  }
  // Thin evidence pulls the score toward neutral.
  const coverage = Math.min(1, wsum);
  const shrink = 0.5 + 0.5 * coverage;
  for (const [k, v] of points) points.set(k, v * shrink);
  return { score: Math.round(clamp(50 + acc * shrink, 0, 100)), coverage, points };
}

export const MOMENTUM_TREND_THRESHOLD = 5;

export function trendFor(delta: number): MomentumTrend {
  if (delta >= MOMENTUM_TREND_THRESHOLD) return 'gaining';
  if (delta <= -MOMENTUM_TREND_THRESHOLD) return 'declining';
  return 'steady';
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

const PHRASE: Record<DriverKey, { up: string; down: string }> = {
  pipeline: { up: 'pipeline growing', down: 'pipeline shrinking' },
  winloss: { up: 'recent wins', down: 'recent losses' },
  meetings: { up: 'meetings more frequent', down: 'meetings drying up' },
  hiring: { up: 'they are hiring', down: 'hiring slowing' },
  news: { up: 'positive news', down: 'negative news' },
};

export function momentumVerdict(trend: MomentumTrend, score: number, drivers: MomentumDriver[], coverage: number): string {
  if (coverage === 0) return 'Not enough signal yet: no deals, meetings, hiring or news on this account.';
  // The trend is the 4-week change, not the level, so say both when they disagree.
  const lead =
    trend === 'gaining'
      ? score <= 40
        ? 'Low level, but up over 4 weeks'
        : 'Gaining traction over 4 weeks'
      : trend === 'declining'
        ? score >= 60
          ? 'High level, but down over 4 weeks'
          : 'Losing momentum over 4 weeks'
        : score >= 60
          ? 'Healthy and steady'
          : score <= 40
            ? 'Steady but weak'
            : 'Holding steady';
  const fitting = drivers
    .filter((d) => (trend === 'declining' ? d.direction === 'down' : trend === 'gaining' ? d.direction === 'up' : d.direction !== 'flat'))
    .slice(0, 2)
    .map((d) => PHRASE[d.key][d.direction === 'down' ? 'down' : 'up']);
  const why = fitting.length ? `: ${joinWords(fitting)}` : '';
  const early = coverage < 0.4 ? ' Early read, few signals.' : '';
  return `${lead}${why}.${early}`;
}

/**
 * Momentum 0..100 (50 = neutral) from dated signals, evaluated weekly over
 * `weeks` weeks so the sparkline and the trend use the same rule. Delta is
 * now vs four weeks ago.
 */
export function computeMomentum(data: MomentumData, now: Date = new Date(), weeks = 13): MomentumResult {
  const t = now.getTime();
  const series: Array<{ at: string; score: number }> = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const at = t - i * 7 * DAY;
    series.push({ at: new Date(at).toISOString(), score: scoreOf(components(data, at)).score });
  }
  const comps = components(data, t);
  const { score, coverage, points } = scoreOf(comps);
  const before = series.length > 4 ? (series[series.length - 5]?.score ?? score) : (series[0]?.score ?? score);
  const delta = score - before;
  const trend = trendFor(delta);
  const drivers: MomentumDriver[] = comps
    .map((c) => {
      const p = points.get(c.key) ?? 0;
      return {
        key: c.key,
        label: LABEL[c.key],
        signal: Math.round(c.signal * 100) / 100,
        points: Math.round(p * 10) / 10,
        direction: (c.signal > 0.1 ? 'up' : c.signal < -0.1 ? 'down' : 'flat') as MomentumDriver['direction'],
        detail: c.detail,
      };
    })
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return { score, delta, trend, series, drivers, verdict: momentumVerdict(trend, score, drivers, coverage), coverage: Math.round(coverage * 100) / 100 };
}

// ── Initiatives ─────────────────────────────────────────────────────────────

export const InitiativeTheme = z.enum(['data_ai', 'cloud', 'cyber', 'digital_cx', 'erp_finance', 'engineering', 'expansion', 'm_and_a', 'regulatory', 'workforce']);
export type InitiativeTheme = z.infer<typeof InitiativeTheme>;

export interface OfferingHook {
  theme: InitiativeTheme;
  label: string;
  offering: string;
  pitch: string;
  nextStep: string;
}

/**
 * Theme to offering map. Static on purpose: Polo has no offerings catalogue
 * yet, so these name the practice that usually answers the theme. Replace
 * with a catalogue lookup when one exists.
 */
export const OFFERING_HOOKS: Record<InitiativeTheme, OfferingHook> = {
  data_ai: { theme: 'data_ai', label: 'Data and AI', offering: 'Data and AI practice', pitch: 'Data platform, analytics and applied AI squads that ship in weeks.', nextStep: 'Offer a data platform health check.' },
  cloud: { theme: 'cloud', label: 'Cloud and infrastructure', offering: 'Cloud and infrastructure', pitch: 'Migration factory, landing zones and FinOps.', nextStep: 'Propose a migration readiness assessment.' },
  cyber: { theme: 'cyber', label: 'Cybersecurity', offering: 'Cybersecurity practice', pitch: 'Zero Trust, SOC and identity programmes.', nextStep: 'Share a Zero Trust roadmap workshop.' },
  digital_cx: { theme: 'digital_cx', label: 'Digital and customer experience', offering: 'Digital product and CX', pitch: 'Product, design and engineering teams for customer journeys.', nextStep: 'Bring a journey teardown of their new product.' },
  erp_finance: { theme: 'erp_finance', label: 'ERP and finance transformation', offering: 'ERP and finance transformation', pitch: 'ERP rollouts, finance process redesign and PMO.', nextStep: 'Offer a transformation PMO conversation.' },
  engineering: { theme: 'engineering', label: 'Engineering and R&D', offering: 'Engineering and R&D services', pitch: 'Embedded, mechanical and software engineering capacity.', nextStep: 'Propose an engineering capacity plan.' },
  expansion: { theme: 'expansion', label: 'Growth and expansion', offering: 'Talent and staffing', pitch: 'Local teams stood up fast in new markets.', nextStep: 'Offer a market entry staffing plan.' },
  m_and_a: { theme: 'm_and_a', label: 'M&A integration', offering: 'Integration and PMO', pitch: 'Post-merger integration, carve-outs and systems consolidation.', nextStep: 'Suggest a 100-day integration plan.' },
  regulatory: { theme: 'regulatory', label: 'Regulatory and compliance', offering: 'Risk and compliance', pitch: 'Regulatory programmes, controls and reporting.', nextStep: 'Offer a regulatory readiness review.' },
  workforce: { theme: 'workforce', label: 'Workforce change', offering: 'Talent and staffing', pitch: 'Flexible capacity while teams resize.', nextStep: 'Offer flexible capacity during the change.' },
};

const THEME_RULES: Array<{ theme: InitiativeTheme; re: RegExp }> = [
  { theme: 'm_and_a', re: /\b(acqui\w*|merger|integration|carve[- ]out|takeover)\b/i },
  { theme: 'cyber', re: /\b(cyber\w*|security|soc\b|zero trust|identity|iam\b|siem|ciso)\b/i },
  { theme: 'data_ai', re: /\b(data|analytics|ai\b|artificial intelligence|machine learning|ml\b|genai|llm|snowflake|databricks)\b/i },
  { theme: 'cloud', re: /\b(cloud|aws|azure|gcp|kubernetes|devops|infrastructure|platform engineering|migration)\b/i },
  { theme: 'erp_finance', re: /\b(erp|sap|oracle|s\/4|finance transformation|workday|core banking)\b/i },
  { theme: 'regulatory', re: /\b(regulat\w*|compliance|basel|dora|gdpr|aml|kyc|esg reporting)\b/i },
  { theme: 'digital_cx', re: /\b(app|digital|customer|mobile|ecommerce|e-commerce|ux|product launch|launch\w*|portal)\b/i },
  { theme: 'engineering', re: /\b(engineer\w*|r&d|embedded|electrification|ev\b|manufactur\w*|plant)\b/i },
  { theme: 'workforce', re: /\b(lay ?offs?|restructur\w*|job cuts|redundanc\w*)\b/i },
  { theme: 'expansion', re: /\b(expan\w*|new office|new market|opens?|growth|funding|raises?|series [a-h])\b/i },
];

export function themeForText(text: string): InitiativeTheme {
  return THEME_RULES.find((r) => r.re.test(text))?.theme ?? 'expansion';
}

// ── API contracts ───────────────────────────────────────────────────────────

const Iso = z.string();

export const PulseDriver = z.object({
  key: DriverKey,
  label: z.string(),
  signal: z.number(),
  points: z.number(),
  direction: z.enum(['up', 'down', 'flat']),
  detail: z.string(),
});

export const AccountPulse = z.object({
  companyId: z.string(),
  companyName: z.string(),
  score: z.number().int(),
  delta: z.number().int(),
  trend: MomentumTrend,
  verdict: z.string(),
  coverage: z.number(),
  series: z.array(z.object({ at: Iso, score: z.number().int() })),
  drivers: z.array(PulseDriver),
  /** True when any input is demo data. */
  sample: z.boolean(),
  /** What the watchdog is listening to right now. */
  // v22: hint says what to add when a source cannot run (news needs a website or ticker).
  sources: z.array(z.object({ id: z.string(), label: z.string(), active: z.boolean(), hint: z.string().nullable().optional() })),
  computedAt: Iso,
});
export type AccountPulse = z.infer<typeof AccountPulse>;

export const TimelineItem = z.object({
  id: z.string(),
  at: Iso,
  lane: z.enum(['ours', 'theirs']),
  category: SignalCategory,
  title: z.string(),
  summary: z.string(),
  source: z.string(),
  sourceUrl: z.string().nullable(),
  /** In-app link, e.g. /opportunities/:id */
  href: z.string().nullable(),
  importance: z.number().int(),
  implication: z.enum(['OPPORTUNITY', 'RISK', 'NEUTRAL']),
  sample: z.boolean(),
  upcoming: z.boolean(),
  /** v22.1: several market / analyst notes in one week, shown as one row. */
  groupCount: z.number().int().optional(),
});
export type TimelineItem = z.infer<typeof TimelineItem>;

export const AccountTimeline = z.object({
  companyId: z.string(),
  from: Iso,
  to: Iso,
  items: z.array(TimelineItem),
  counts: z.record(z.string(), z.number().int()),
});
export type AccountTimeline = z.infer<typeof AccountTimeline>;

export const InitiativeEvidence = z.object({
  kind: z.enum(['hiring', 'news', 'filing', 'funding', 'launch', 'meeting']),
  title: z.string(),
  url: z.string().nullable(),
  at: Iso.nullable(),
  source: z.string(),
  sample: z.boolean(),
});

export const Initiative = z.object({
  id: z.string(),
  title: z.string(),
  theme: InitiativeTheme,
  themeLabel: z.string(),
  rationale: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  confidenceScore: z.number(),
  firstSeen: Iso.nullable(),
  lastSeen: Iso.nullable(),
  evidence: z.array(InitiativeEvidence),
  hook: z.object({ offering: z.string(), pitch: z.string(), nextStep: z.string(), alreadySold: z.boolean() }),
  sample: z.boolean(),
});
export type Initiative = z.infer<typeof Initiative>;

export const AccountInitiatives = z.object({
  companyId: z.string(),
  items: z.array(Initiative),
  /** True when hiring, news, and meetings include only the latest 1,000 direct subsidiaries. */
  subsidiariesCapped: z.boolean().optional(),
});
export type AccountInitiatives = z.infer<typeof AccountInitiatives>;

export const PortfolioAlert = z.object({
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  title: z.string(),
  category: SignalCategory,
  importance: z.number().int(),
  occurredAt: Iso,
  source: z.string(),
  sourceUrl: z.string().nullable(),
  implication: z.enum(['OPPORTUNITY', 'RISK', 'NEUTRAL']),
  sample: z.boolean(),
});
export type PortfolioAlert = z.infer<typeof PortfolioAlert>;

export const PortfolioMomentum = z.object({
  accounts: z.array(
    z.object({
      companyId: z.string(),
      companyName: z.string(),
      score: z.number().int(),
      delta: z.number().int(),
      trend: MomentumTrend,
      verdict: z.string(),
      topDriver: z.string().nullable(),
      openPipelineMicros: z.string(),
      /** True when open pipeline and momentum used the latest 1000 deals. */
      dealsCapped: z.boolean().optional(),
      /** True when meetings, postings, or watch events used the latest 1000 rows. */
      feedsCapped: z.boolean().optional(),
      /** True when direct subsidiaries filled the 1000-row rollup. */
      childrenCapped: z.boolean().optional(),
      series: z.array(z.number().int()),
      sample: z.boolean(),
      coverage: z.number(),
    }),
  ),
  counts: z.object({ gaining: z.number().int(), steady: z.number().int(), declining: z.number().int() }),
  alerts: z.array(PortfolioAlert),
  computedAt: Iso,
});
export type PortfolioMomentum = z.infer<typeof PortfolioMomentum>;

/** "Sample: Foo" -> "Foo" for display (the UI shows a Sample badge instead). */
export function stripSamplePrefix(title: string): string {
  return title.replace(/^Sample:\s*/i, '');
}

// ── Market-note grouping (v22.1) ────────────────────────────────────────────

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = 7 * 86_400_000;

/** "5 analyst notes this week" / "3 analyst notes, week of 19 Oct". */
export function marketGroupTitle(count: number, weekStart: Date, now: Date): string {
  const noun = count === 1 ? 'analyst note' : 'analyst notes';
  if (now.getTime() - weekStart.getTime() < WEEK) return `${count} ${noun} this week`;
  return `${count} ${noun}, week of ${weekStart.getUTCDate()} ${MON[weekStart.getUTCMonth()]}`;
}

/**
 * Collapse repetitive market / analyst items per account into one row per
 * rolling week (counted back from now). Single notes stay as they are. The
 * merged row sits where the newest member was, so the list order holds.
 */
export function collapseMarketNotes<T>(
  items: T[],
  opts: { now: Date; isMarket(t: T): boolean; at(t: T): Date; merge(group: T[], title: string, weekStart: Date): T },
): T[] {
  const buckets = new Map<number, T[]>();
  for (const it of items) {
    if (!opts.isMarket(it)) continue;
    const b = Math.max(0, Math.floor((opts.now.getTime() - opts.at(it).getTime()) / WEEK));
    const arr = buckets.get(b) ?? [];
    arr.push(it);
    buckets.set(b, arr);
  }
  const out: T[] = [];
  const done = new Set<number>();
  for (const it of items) {
    if (!opts.isMarket(it)) {
      out.push(it);
      continue;
    }
    const b = Math.max(0, Math.floor((opts.now.getTime() - opts.at(it).getTime()) / WEEK));
    const group = buckets.get(b)!;
    if (group.length < 2) {
      out.push(it);
      continue;
    }
    if (done.has(b)) continue;
    done.add(b);
    const sorted = [...group].sort((a, z) => opts.at(z).getTime() - opts.at(a).getTime());
    const weekStart = new Date(opts.now.getTime() - (b + 1) * WEEK);
    out.push(opts.merge(sorted, marketGroupTitle(group.length, b === 0 ? new Date(opts.now.getTime() - 1) : weekStart, opts.now), weekStart));
  }
  return out;
}
