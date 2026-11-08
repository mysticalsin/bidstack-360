/**
 * Consulting firm catalog and the deterministic alias matcher (slice 15).
 *
 * Short or ambiguous aliases (EY, BCG, CGI, Bain, Atos, Alten) match only
 * with their exact casing, so "key", "bain-marie" or "alten" as a German
 * word never count. Longer aliases win over shorter ones that overlap
 * ("Capgemini Engineering" is not also "Capgemini").
 */

/** One consulting firm we track. */
export interface ConsultingFirm {
  key: string;
  name: string;
  aliases: string[];
  /** The firm's own web domains (case studies, press releases). */
  domains: string[];
}

/** Default list. Extend per deployment (CONSULTING_PARTNER_FIRMS) or per org (competitor profiles). */
export const DEFAULT_CONSULTING_FIRMS: readonly ConsultingFirm[] = [
  { key: 'kpmg', name: 'KPMG', aliases: ['KPMG'], domains: ['kpmg.com'] },
  { key: 'deloitte', name: 'Deloitte', aliases: ['Deloitte', 'Monitor Deloitte'], domains: ['deloitte.com'] },
  { key: 'pwc', name: 'PwC', aliases: ['PwC', 'PWC', 'PricewaterhouseCoopers'], domains: ['pwc.com'] },
  { key: 'ey', name: 'EY', aliases: ['EY', 'Ernst & Young', 'EY-Parthenon'], domains: ['ey.com'] },
  { key: 'accenture', name: 'Accenture', aliases: ['Accenture'], domains: ['accenture.com'] },
  { key: 'capgemini', name: 'Capgemini', aliases: ['Capgemini', 'Capgemini Invent'], domains: ['capgemini.com'] },
  { key: 'ibm-consulting', name: 'IBM Consulting', aliases: ['IBM Consulting', 'IBM iX', 'IBM Global Business Services'], domains: ['ibm.com'] },
  { key: 'sopra-steria', name: 'Sopra Steria', aliases: ['Sopra Steria', 'Sopra'], domains: ['soprasteria.com'] },
  { key: 'alten', name: 'Alten', aliases: ['Alten', 'ALTEN'], domains: ['alten.com'] },
  { key: 'akkodis', name: 'Akkodis', aliases: ['Akkodis', 'AKKA Technologies'], domains: ['akkodis.com'] },
  { key: 'capgemini-engineering', name: 'Capgemini Engineering', aliases: ['Capgemini Engineering', 'Altran'], domains: ['capgemini.com'] },
  { key: 'cgi', name: 'CGI', aliases: ['CGI'], domains: ['cgi.com'] },
  { key: 'atos', name: 'Atos', aliases: ['Atos', 'Eviden'], domains: ['atos.net', 'eviden.com'] },
  { key: 'mckinsey', name: 'McKinsey', aliases: ['McKinsey', 'McKinsey & Company', 'QuantumBlack'], domains: ['mckinsey.com'] },
  { key: 'bcg', name: 'BCG', aliases: ['BCG', 'Boston Consulting Group', 'BCG X'], domains: ['bcg.com'] },
  { key: 'bain', name: 'Bain', aliases: ['Bain', 'Bain & Company'], domains: ['bain.com'] },
];

/** Aliases this short match with exact casing only. */
const CASE_SENSITIVE_MAX = 5;

/** Lower case slug for a firm name. */
export function firmKeyFor(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'firm';
}

/** Two letter monogram for a firm tile. */
export function firmMonogram(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}& ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  const w = words[0] ?? name;
  return (w.length <= 3 ? w : w.slice(0, 2)).toUpperCase();
}

/**
 * Parse CONSULTING_PARTNER_FIRMS: entries separated by newlines or ";;",
 * each `Name|alias,alias|domain,domain`. Bad entries are skipped.
 */
export function parseFirmList(raw: string | undefined | null): ConsultingFirm[] {
  if (!raw) return [];
  const out: ConsultingFirm[] = [];
  for (const entry of raw.split(/\n|;;/)) {
    const [name, aliases = '', domains = ''] = entry.split('|').map((s) => s.trim());
    if (!name || name.length > 120) continue;
    out.push({
      key: firmKeyFor(name),
      name,
      aliases: [name, ...aliases.split(',').map((a) => a.trim()).filter((a) => a.length >= 2 && a.length <= 120)],
      domains: domains.split(',').map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
    });
  }
  return out;
}

/** Defaults plus extras; an extra with a known key adds aliases and domains to it. */
export function firmCatalog(...extra: ConsultingFirm[][]): ConsultingFirm[] {
  const byKey = new Map<string, ConsultingFirm>();
  for (const f of [...DEFAULT_CONSULTING_FIRMS, ...extra.flat()]) {
    const hit = byKey.get(f.key);
    if (!hit) {
      byKey.set(f.key, { ...f, aliases: [...new Set(f.aliases)], domains: [...new Set(f.domains)] });
      continue;
    }
    hit.aliases = [...new Set([...hit.aliases, ...f.aliases])];
    hit.domains = [...new Set([...hit.domains, ...f.domains])];
  }
  return [...byKey.values()];
}

/** One firm mention in a text. */
export interface FirmMention {
  firmKey: string;
  alias: string;
  start: number;
  end: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface CompiledAlias {
  firmKey: string;
  alias: string;
  re: RegExp;
}

const compiledCache = new WeakMap<readonly ConsultingFirm[], CompiledAlias[]>();

function compile(firms: readonly ConsultingFirm[]): CompiledAlias[] {
  const hit = compiledCache.get(firms);
  if (hit) return hit;
  const list: CompiledAlias[] = [];
  for (const f of firms) {
    for (const alias of f.aliases) {
      const a = alias.trim();
      if (a.length < 2) continue;
      const flags = a.length <= CASE_SENSITIVE_MAX ? 'gu' : 'giu';
      list.push({ firmKey: f.key, alias: a, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(a)}(?![\\p{L}\\p{N}])`, flags) });
    }
  }
  list.sort((x, y) => y.alias.length - x.alias.length);
  compiledCache.set(firms, list);
  return list;
}

/** Every firm mention in `text`, in order, longest alias first on overlaps. */
export function matchFirms(text: string, firms: readonly ConsultingFirm[]): FirmMention[] {
  if (!text) return [];
  const taken: FirmMention[] = [];
  for (const c of compile(firms)) {
    c.re.lastIndex = 0;
    for (let m = c.re.exec(text); m; m = c.re.exec(text)) {
      const start = m.index;
      const end = start + m[0].length;
      if (taken.some((t) => start < t.end && end > t.start)) continue;
      taken.push({ firmKey: c.firmKey, alias: m[0], start, end });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** Distinct firm keys mentioned in `text`. */
export function firmsIn(text: string, firms: readonly ConsultingFirm[]): string[] {
  return [...new Set(matchFirms(text, firms).map((m) => m.firmKey))];
}

/** True when `text` names the client (word boundary, case insensitive). */
export function namesClient(text: string, clientName: string): boolean {
  const name = clientName.trim();
  if (name.length < 2) return false;
  const core = name.replace(/\s+(group|bank|ag|sa|se|plc|inc\.?|corporation|corp\.?|ltd\.?|asa)$/i, '').trim() || name;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(core)}(?![\\p{L}\\p{N}])`, core.length <= CASE_SENSITIVE_MAX ? 'u' : 'iu');
  return re.test(text);
}
