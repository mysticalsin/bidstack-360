// Org chart HTML import: a safe, generic people extractor.
//
// Security
//  * htmlparser2 only tokenizes; nothing is executed or fetched. Scripts are
//    never run: we only read the *text* of <script type="application/json">
//    and application/ld+json data islands and JSON.parse it.
//  * <script>, <style>, <template>, <noscript>, <iframe> and <object> text is
//    never used as person text. Every extracted value is plain text with tags,
//    control and bidi characters removed, whitespace collapsed and a length cap.
//  * URLs: photos https only; inline photos only data:image/(png|jpeg|webp)
//    with magic-byte check and the 2 MB cap; LinkedIn only linkedin.com /in/
//    or /pub/ profiles; other socials https only on a short host allowlist.
//
// Layouts understood (first match wins, in this order)
//  1. JSON data islands: any array of person-like objects (name, or first and
//     last name) inside a JSON script, including schema.org Person (ld+json).
//     Sprite-sheet avatars (`ph` index + `phCols`, sheet in a CSS data URI)
//     are supported, as produced by "people map" exports.
//  2. schema.org microdata (itemtype .../Person) and hCard (.vcard).
//  3. <table> with a header row (Name, Title, Email, Phone, LinkedIn,
//     Manager, Department, Location, ...); mailto:, tel:, LinkedIn links and
//     <img> in a row are picked up too.
import { DomUtils, parseDocument } from 'htmlparser2';
import { z } from 'zod';

import {
  ORG_CHART_HTML_MAX_BYTES,
  ORG_CHART_MAX_NODES,
  ORG_CHART_PHOTO_MAX_BYTES,
  type OrgChartPhotoType,
  type OrgChartProfile,
  normalizeLinkedinUrl,
  normalizePhone,
} from '@bidstack/shared';

type Doc = ReturnType<typeof parseDocument>;
type El = Parameters<typeof DomUtils.getAttributeValue>[0];
type AnyNode = Doc['children'][number];

export type HtmlPhoto =
  | { kind: 'url'; url: string }
  | { kind: 'data'; type: OrgChartPhotoType; buf: Buffer }
  | { kind: 'sprite'; index: number };

export interface HtmlPerson {
  line: number;
  ref: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  photo: HtmlPhoto | null;
  managerRef: string | null;
  managerEmail: string | null;
  managerName: string | null;
  function: string | null;
  businessUnit: string | null;
  region: string | null;
  profile: OrgChartProfile;
}

export interface HtmlSprite {
  type: OrgChartPhotoType;
  buf: Buffer;
  cols: number;
}

export interface HtmlParseResult {
  format: 'json' | 'microdata' | 'hcard' | 'table' | 'none';
  people: HtmlPerson[];
  found: number;
  skipped: number;
  sprite: HtmlSprite | null;
  errors: Array<{ line: number; message: string; name?: string }>;
  warnings: Array<{ line: number; message: string; name?: string }>;
}

// ── text and URL hygiene ───────────────────────────────────────────────────
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Plain, single-line text: no tags, no control or bidi characters, capped. */
export function cleanText(v: unknown, max = 300): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  let s = String(v);
  if (s.length > max * 4) s = s.slice(0, max * 4);
  s = s.replace(/<[^>]*>/g, ' ').replace(/[<>]/g, ' ').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const emailSchema = z.string().email().max(254);
export function cleanEmail(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().replace(/^mailto:/i, '').split('?')[0]!.toLowerCase() : null;
  return s && emailSchema.safeParse(s).success ? s : null;
}

export function cleanHttpsUrl(v: unknown, max = 1000): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > max) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const SOCIAL_HOSTS: Record<string, string> = {
  'x.com': 'x',
  'twitter.com': 'x',
  'github.com': 'github',
  'medium.com': 'medium',
  'youtube.com': 'youtube',
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'theorg.com': 'theorg',
};
function socialOf(url: string): { kind: string; url: string } | null {
  const u = cleanHttpsUrl(url);
  if (!u) return null;
  const host = new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  const kind = SOCIAL_HOSTS[host];
  return kind ? { kind, url: u } : null;
}

/** Magic-byte image type; null for anything else (SVG, HTML, ...). */
export function sniffImage(buf: Buffer): OrgChartPhotoType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const DATA_URI = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([a-z0-9+/=\s]+)$/i;
/** Decoded inline image, or an error message. */
export function decodeDataImage(uri: string, maxBytes = ORG_CHART_PHOTO_MAX_BYTES): { type: OrgChartPhotoType; buf: Buffer } | { error: string } {
  const m = uri.trim().match(DATA_URI);
  if (!m) return { error: 'Inline photos must be PNG, JPEG or WebP data URIs' };
  if ((m[2]!.length * 3) / 4 > maxBytes + 4) return { error: 'Inline photo is over 2 MB' };
  const buf = Buffer.from(m[2]!.replace(/\s/g, ''), 'base64');
  if (buf.length > maxBytes) return { error: 'Inline photo is over 2 MB' };
  const type = sniffImage(buf);
  const declared = m[1]!.toLowerCase().replace('jpg', 'jpeg');
  if (!type || type !== declared) return { error: 'Inline photo is not a real PNG, JPEG or WebP image' };
  return { type, buf };
}

function photoOf(v: unknown): HtmlPhoto | { error: string } | null {
  const s = typeof v === 'string' ? v.trim() : str(v, ['url', 'src', 'contentUrl']);
  if (!s) return null;
  if (s.startsWith('data:')) {
    const d = decodeDataImage(s);
    return 'error' in d ? d : { kind: 'data', ...d };
  }
  const u = cleanHttpsUrl(s);
  return u ? { kind: 'url', url: u } : { error: 'Photo URL must be https' };
}

// ── field aliases (JSON keys and table headers) ────────────────────────────
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  ref: ['id', 'uid', 'key', 'personid', 'employeeid', 'identifier'],
  name: ['name', 'fullname', 'displayname', 'person', 'employee'],
  first: ['first', 'firstname', 'givenname'],
  last: ['last', 'lastname', 'familyname', 'surname'],
  title: ['title', 'jobtitle', 'position', 'role', 'designation'],
  email: ['email', 'mail', 'emailaddress', 'workemail', 'e-mail'],
  phone: ['phone', 'telephone', 'mobile', 'mobilephone', 'workphone', 'phonenumber', 'tel', 'cell'],
  linkedin: ['linkedin', 'linkedinurl', 'linkedinprofile', 'li'],
  photo: ['photo', 'photourl', 'image', 'avatar', 'avatarurl', 'picture', 'headshot'],
  managerRef: ['parent', 'parentid', 'managerid', 'reportstoid', 'supervisorid'],
  manager: ['manager', 'reportsto', 'supervisor', 'managername', 'boss'],
  managerEmail: ['manageremail', 'reportstoemail', 'supervisoremail'],
  function: ['department', 'func', 'function', 'team', 'dept'],
  businessUnit: ['unit', 'unitraw', 'businessunit', 'division', 'bu', 'org', 'orgunit'],
  region: ['country', 'region'],
  location: ['location', 'loc', 'city', 'office', 'workplace', 'address'],
  tenure: ['tenure', 'yearsatcompany', 'timeincompany'],
  startDate: ['startdate', 'hiredate', 'joined', 'since'],
  headline: ['headline', 'tagline'],
  summary: ['bio', 'summary', 'about', 'rolenow', 'description'],
  employer: ['company', 'employer', 'worksfor', 'vendor'],
} as const;
type Field = keyof typeof ALIASES;
const ALIAS_INDEX = new Map<string, Field>();
for (const [f, keys] of Object.entries(ALIASES)) for (const k of keys) ALIAS_INDEX.set(norm(k), f as Field);

/** A string out of a scalar or a {value|url|name|text} object. */
function str(v: unknown, keys = ['value', 'url', 'name', 'text', 'email', 'id']): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of keys) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'string' || typeof x === 'number') return String(x);
    }
  }
  return null;
}

function fieldsOf(obj: Record<string, unknown>): Partial<Record<Field, unknown>> {
  const out: Partial<Record<Field, unknown>> = {};
  for (const [k, v] of Object.entries(obj)) {
    const f = ALIAS_INDEX.get(norm(k));
    if (f && out[f] === undefined && v !== null && v !== '') out[f] = v;
  }
  return out;
}

const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);

// ── person builder (shared by every layout) ────────────────────────────────
interface Raw {
  f: Partial<Record<Field, unknown>>;
  obj?: Record<string, unknown>;
  links?: string[];
  imgs?: string[];
}

function build(line: number, raw: Raw, errors: HtmlParseResult['errors'], warnings: HtmlParseResult['warnings']): HtmlPerson | null {
  const { f, obj } = raw;
  const first = cleanText(str(f.first), 100);
  const last = cleanText(str(f.last), 100);
  let name = cleanText(str(f.name, ['name', 'value', 'text']), 200);
  if (!name && (first || last)) name = cleanText([first, last].filter(Boolean).join(' '), 200);
  if (!name) {
    errors.push({ line, message: 'Person has no name' });
    return null;
  }
  // Bad optional fields are dropped with a warning; they never block the import.
  const fail = (message: string) => warnings.push({ line, message: `${message} (left empty)`, name });
  const links = [...(raw.links ?? [])];
  const sameAs = obj?.sameAs;
  if (typeof sameAs === 'string') links.push(sameAs);
  else for (const x of list(sameAs, 20)) if (typeof x === 'string') links.push(x);

  const emailRaw = str(f.email) ?? links.find((l) => /^mailto:/i.test(l)) ?? null;
  const email = emailRaw ? cleanEmail(emailRaw) : null;
  if (emailRaw && !email) fail(`Invalid email: ${cleanText(emailRaw, 80)}`);

  const phoneRaw = str(f.phone) ?? links.find((l) => /^tel:/i.test(l)) ?? null;
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) fail(`Invalid phone: ${cleanText(phoneRaw, 40)}`);

  const liObj = f.linkedin && typeof f.linkedin === 'object' ? (f.linkedin as Record<string, unknown>) : null;
  const liRaw = str(f.linkedin, ['url', 'value', 'href']) ?? links.find((l) => /linkedin\.com/i.test(l)) ?? null;
  const linkedinUrl = liRaw ? normalizeLinkedinUrl(liRaw) : null;
  if (liRaw && !linkedinUrl && liRaw.trim()) fail('LinkedIn must be a https linkedin.com/in/ profile');

  let photo: HtmlPhoto | null = null;
  const ph = obj?.ph;
  if (typeof ph === 'number' && Number.isInteger(ph) && ph >= 0 && ph < 10_000) photo = { kind: 'sprite', index: ph };
  else {
    const p = photoOf(f.photo ?? raw.imgs?.[0]);
    if (p && 'error' in p) fail(p.error);
    else photo = p;
  }

  const mgr = f.manager;
  const managerRef = cleanText(str(f.managerRef, ['id', 'value']) ?? (mgr && typeof mgr === 'object' ? str(mgr, ['id', '@id']) : null), 200);
  const managerEmail = cleanEmail(str(f.managerEmail) ?? (mgr && typeof mgr === 'object' ? str(mgr, ['email']) : typeof mgr === 'string' && mgr.includes('@') ? mgr : null));
  const managerName = managerEmail ? null : cleanText(mgr && typeof mgr === 'object' ? str(mgr, ['name']) : typeof mgr === 'string' ? mgr : null, 200);

  const profile: OrgChartProfile = {};
  const put = <K extends keyof OrgChartProfile>(k: K, v: OrgChartProfile[K] | null | undefined) => {
    if (v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) profile[k] = v;
  };
  put('headline', cleanText(str(f.headline), 300));
  put('summary', cleanText(str(f.summary), 1000));
  put('location', cleanText(str(f.location, ['value', 'name', 'addressLocality', 'text']), 200));
  put('tenure', cleanText(str(f.tenure), 600));
  put('startDate', cleanText(str(f.startDate), 40));
  const employer = cleanText(str(f.employer, ['name', 'value']), 200);
  if (obj) {
    put('workMode', cleanText(str(obj.mode ?? obj.workMode), 40));
    put('personKind', cleanText(str(obj.kind ?? obj.type), 40));
    put('tier', cleanText(str(obj.tier), 20));
    put('languages', list(obj.langs ?? obj.languages, 10).map((x) => cleanText(str(x), 200)).filter((x): x is string => !!x));
    put('sites', list(obj.sites, 20).map((x) => cleanText(str(x), 120)).filter((x): x is string => !!x));
    put('themes', list(obj.themes ?? obj.skills ?? obj.tags, 20).map((x) => cleanText(str(x), 120)).filter((x): x is string => !!x));
    put(
      'career',
      list(obj.career ?? obj.experience, 15)
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const role = cleanText(str(o.role ?? o.title), 200);
          return role ? { role, org: cleanText(str(o.org ?? o.company), 200), period: cleanText(str(o.period ?? o.dates), 80) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    );
    put(
      'education',
      list(obj.edu ?? obj.education, 10)
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const school = cleanText(str(o.school ?? o.name), 200);
          return school ? { school, detail: cleanText(str(o.detail ?? o.degree), 300) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    );
    const linkItems = (v: unknown, titleKeys: string[]) =>
      list(v, 10)
        .map((x) => {
          const o = (x ?? {}) as Record<string, unknown>;
          const title = cleanText(titleKeys.map((k) => str(o[k])).find(Boolean) ?? null, 300);
          return title ? { title, url: cleanHttpsUrl(o.url), date: cleanText(str(o.date), 40) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x);
    put('signals', linkItems(obj.signals, ['what', 'title', 'text']));
    put('footprint', linkItems(obj.foot ?? obj.footprint ?? obj.publications, ['title', 'what']));
    const fit = obj.fit as { score?: unknown; why?: unknown } | undefined;
    if (fit && typeof fit.score === 'number' && Number.isFinite(fit.score)) {
      const score = Math.round(Math.min(Math.max(fit.score, 0), 100) * 10) / 10;
      put('fit', { score, why: list(fit.why, 5).map((x) => cleanText(str(x), 300)).filter((x): x is string => !!x) });
    }
    if (employer && obj.kind !== 'internal') put('employer', employer);
  } else put('employer', employer);
  if (liObj) put('linkedinConfidence', cleanText(str(liObj.conf ?? liObj.confidence), 20));
  const socials = links.map(socialOf).filter((x): x is NonNullable<typeof x> => !!x);
  put('socials', [...new Map(socials.map((s) => [s.url, s])).values()].slice(0, 10));

  return {
    line,
    ref: cleanText(str(f.ref), 200),
    name,
    title: cleanText(str(f.title, ['name', 'value']), 200),
    email,
    phone,
    linkedinUrl,
    photo,
    managerRef,
    managerEmail,
    managerName,
    function: cleanText(str(f.function, ['name', 'value']), 40),
    businessUnit: cleanText(str(f.businessUnit, ['name', 'value']), 120),
    region: cleanText(str(f.region, ['name', 'value', 'addressCountry']), 40),
    profile,
  };
}

// ── layout 1: JSON data islands ────────────────────────────────────────────
const SKIP_KINDS = new Set(['system', 'bot', 'service', 'shared', 'room']);
const isPersonish = (o: unknown): o is Record<string, unknown> => {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const f = fieldsOf(o as Record<string, unknown>);
  const t = (o as Record<string, unknown>)['@type'];
  return t === 'Person' || (!!(str(f.name) || (str(f.first) && str(f.last))) && !!(f.title || f.email || f.manager || f.managerRef || f.function || f.linkedin || f.phone));
};

function findPeopleArrays(v: unknown, depth = 0, out: { arr: Record<string, unknown>[]; root: Record<string, unknown> | null }[] = [], root: Record<string, unknown> | null = null) {
  if (depth > 6 || !v || typeof v !== 'object') return out;
  if (Array.isArray(v)) {
    const sample = v.slice(0, 50);
    if (sample.length && sample.filter(isPersonish).length >= Math.max(1, Math.ceil(sample.length / 2))) {
      out.push({ arr: v.filter(isPersonish), root });
      return out;
    }
    for (const x of v.slice(0, 200)) findPeopleArrays(x, depth + 1, out, root);
    return out;
  }
  const o = v as Record<string, unknown>;
  if (depth === 0 && isPersonish(o)) out.push({ arr: [o], root });
  for (const x of Object.values(o)) findPeopleArrays(x, depth + 1, out, root ?? o);
  return out;
}

function jsonIslands(doc: Doc): unknown[] {
  const out: unknown[] = [];
  for (const s of DomUtils.getElementsByTagName('script', doc, true)) {
    const type = (DomUtils.getAttributeValue(s, 'type') ?? '').toLowerCase().trim();
    if (type !== 'application/json' && type !== 'application/ld+json') continue;
    const text = DomUtils.textContent(s);
    if (text.length > ORG_CHART_HTML_MAX_BYTES) continue;
    try {
      out.push(JSON.parse(text));
    } catch {
      /* not JSON: ignored */
    }
  }
  return out;
}

/** The biggest raster data URI in <style>, used as an avatar sprite sheet. */
function spriteFromStyles(doc: Doc): { type: OrgChartPhotoType; buf: Buffer } | null {
  let best: { type: OrgChartPhotoType; buf: Buffer } | null = null;
  for (const st of DomUtils.getElementsByTagName('style', doc, true)) {
    const css = DomUtils.textContent(st);
    for (const m of css.matchAll(/url\(\s*["']?(data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+)["']?\s*\)/gi)) {
      const d = decodeDataImage(m[1]!, 4 * 1024 * 1024);
      if (!('error' in d) && (!best || d.buf.length > best.buf.length)) best = d;
    }
  }
  return best;
}

// ── layouts 2 and 3: microdata, hCard, tables ──────────────────────────────
const elText = (e: AnyNode) => DomUtils.textContent(e);
function linksIn(e: AnyNode): string[] {
  return DomUtils.findAll((x) => x.name === 'a', [e as never])
    .map((a) => DomUtils.getAttributeValue(a, 'href') ?? '')
    .filter((h) => /^(mailto:|tel:|https:)/i.test(h.trim()))
    .map((h) => h.trim());
}
function imgsIn(e: AnyNode): string[] {
  return DomUtils.findAll((x) => x.name === 'img', [e as never])
    .map((i) => (DomUtils.getAttributeValue(i, 'src') ?? '').trim())
    .filter(Boolean);
}

function microdataPeople(doc: Doc): Raw[] {
  const items = DomUtils.findAll((e) => /schema\.org\/Person/i.test(DomUtils.getAttributeValue(e, 'itemtype') ?? ''), doc.children);
  return items.map((item) => {
    const obj: Record<string, unknown> = {};
    for (const p of DomUtils.findAll((e) => DomUtils.hasAttrib(e, 'itemprop'), item.children)) {
      const prop = DomUtils.getAttributeValue(p, 'itemprop')!;
      const v = DomUtils.getAttributeValue(p, 'content') ?? DomUtils.getAttributeValue(p, 'href') ?? DomUtils.getAttributeValue(p, 'src') ?? elText(p);
      if (obj[prop] === undefined) obj[prop] = v;
    }
    return { f: fieldsOf(obj), links: linksIn(item), imgs: imgsIn(item) };
  });
}

function hcardPeople(doc: Doc): Raw[] {
  const cls = (e: El, c: string) => (DomUtils.getAttributeValue(e, 'class') ?? '').split(/\s+/).includes(c);
  return DomUtils.findAll((e) => cls(e, 'vcard') || cls(e, 'h-card'), doc.children).map((card) => {
    const pick = (...names: string[]) => {
      const el = DomUtils.findOne((e) => names.some((n) => cls(e, n)), card.children);
      return el ? (DomUtils.getAttributeValue(el, 'href') ?? DomUtils.getAttributeValue(el, 'src') ?? elText(el)) : undefined;
    };
    const obj = { name: pick('fn', 'p-name'), title: pick('title', 'p-job-title', 'role'), email: pick('email', 'u-email'), phone: pick('tel', 'p-tel'), photo: pick('photo', 'u-photo'), department: pick('org', 'p-org') };
    return { f: fieldsOf(obj), links: linksIn(card), imgs: imgsIn(card) };
  });
}

function tablePeople(doc: Doc): Raw[] {
  for (const table of DomUtils.getElementsByTagName('table', doc, true)) {
    const rows = DomUtils.getElementsByTagName('tr', table, true);
    if (rows.length < 2) continue;
    const cells = (r: El) => r.children.filter((c): c is El => (c as El).name === 'td' || (c as El).name === 'th');
    const header = cells(rows[0]!).map((c) => ALIAS_INDEX.get(norm(elText(c))) ?? null);
    if (!header.includes('name') && !(header.includes('first') && header.includes('last'))) continue;
    return rows.slice(1).map((r) => {
      const f: Partial<Record<Field, unknown>> = {};
      cells(r).forEach((c, i) => {
        const field = header[i];
        if (!field) return;
        const href = DomUtils.findOne((x) => x.name === 'a', c.children);
        const img = DomUtils.findOne((x) => x.name === 'img', c.children);
        const v = field === 'photo' && img ? DomUtils.getAttributeValue(img, 'src') : (field === 'linkedin' || field === 'email' || field === 'phone') && href ? DomUtils.getAttributeValue(href, 'href') : elText(c);
        if (v && f[field] === undefined) f[field] = v;
      });
      return { f, links: linksIn(r), imgs: imgsIn(r) };
    });
  }
  return [];
}

// ── entry point ────────────────────────────────────────────────────────────
export function parseOrgChartHtml(html: string): HtmlParseResult {
  const errors: HtmlParseResult['errors'] = [];
  const warnings: HtmlParseResult['warnings'] = [];
  const empty = (format: HtmlParseResult['format'] = 'none'): HtmlParseResult => ({ format, people: [], found: 0, skipped: 0, sprite: null, errors, warnings });
  if (Buffer.byteLength(html, 'utf8') > ORG_CHART_HTML_MAX_BYTES) {
    errors.push({ line: 1, message: 'The HTML file is over 5 MB' });
    return empty();
  }
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });

  let format: HtmlParseResult['format'] = 'none';
  let raws: Raw[] = [];
  let sprite: HtmlSprite | null = null;
  let skipped = 0;
  for (const island of jsonIslands(doc)) {
    const found = findPeopleArrays(island).sort((a, b) => b.arr.length - a.arr.length)[0];
    if (!found || found.arr.length <= raws.length) continue;
    format = 'json';
    raws = [];
    skipped = 0;
    for (const obj of found.arr) {
      const kind = typeof obj.kind === 'string' ? obj.kind.toLowerCase() : '';
      if (SKIP_KINDS.has(kind)) {
        skipped++;
        continue;
      }
      raws.push({ f: fieldsOf(obj), obj });
    }
    const cols = found.root?.phCols ?? found.root?.spriteCols;
    if (typeof cols === 'number' && Number.isInteger(cols) && cols > 0 && cols <= 200 && raws.some((r) => typeof r.obj?.ph === 'number')) {
      const sheet = spriteFromStyles(doc);
      if (sheet) sprite = { ...sheet, cols };
      else warnings.push({ line: 1, message: 'Avatar sprite sheet not found; photos skipped' });
    }
  }
  if (!raws.length) {
    // Markup layouts: the one that yields the most people wins (ties: microdata, hCard, table).
    const best = (
      [
        ['microdata', microdataPeople(doc)],
        ['hcard', hcardPeople(doc)],
        ['table', tablePeople(doc)],
      ] as const
    ).reduce((a, b) => (b[1].length > a[1].length ? b : a));
    if (best[1].length) [format, raws] = [best[0], [...best[1]]];
  }
  if (!raws.length) {
    errors.push({ line: 1, message: 'No people found. Use a table with a Name column, schema.org Person markup, hCards, or a JSON people list.' });
    return empty(format);
  }
  if (raws.length > ORG_CHART_MAX_NODES) {
    errors.push({ line: 1, message: `Too many people (max ${ORG_CHART_MAX_NODES})` });
    return { ...empty(format), found: raws.length, skipped };
  }
  const people: HtmlPerson[] = [];
  raws.forEach((r, i) => {
    const p = build(i + 1, r, errors, warnings);
    if (!p) return;
    if (p.photo?.kind === 'sprite' && !sprite) p.photo = null;
    people.push(p);
  });
  return { format, people, found: raws.length + skipped, skipped, sprite, errors, warnings };
}
