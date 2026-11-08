/**
 * Ranked whitespace (slice 13b). Extends evaluateLeverage: the same MSA and
 * account activity decide which group lines are missing, then seven factors
 * score how strong the opening is (0-100). Each factor shows its points and
 * the evidence behind them. Pure: loaders live in the API.
 */
import { EXPANSION_LINES, labelBusinessLine } from './business-lines.js';
import { evaluateLeverage, type AccountActivity, type LeverageMsaInput } from './leverage.js';
import type { WhitespaceCitation, WhitespaceFactor, WhitespaceFactorKey } from '../schemas/msa-whitespace.js';

export const WHITESPACE_FACTOR_MAX: Record<WhitespaceFactorKey, number> = {
  scope: 25,
  coverage: 15,
  affiliates: 10,
  rate_card: 15,
  renewal: 10,
  intel: 15,
  size: 10,
};

export const WHITESPACE_DISMISS_DAYS = 90;

const FACTOR_LABEL: Record<WhitespaceFactorKey, string> = {
  scope: 'Scope of services',
  coverage: 'Country coverage',
  affiliates: 'Affiliates clause',
  rate_card: 'Rate card roles',
  renewal: 'Renewal window',
  intel: 'Account signals',
  size: 'Account size',
};

export interface WhitespaceRateLine {
  role: string;
}

export interface WhitespaceIntel {
  hiring: Array<{ title: string; skills: string[]; url: string | null }>;
  themes: Array<{ title: string; url: string | null }>;
  news: Array<{ title: string; url: string | null }>;
}

export interface WhitespaceInput {
  msa: LeverageMsaInput & { countries: string[]; rateCard: WhitespaceRateLine[] };
  activity: AccountActivity;
  /** Countries the account (and its affiliates) operates in. */
  accountCountries: string[];
  intel: WhitespaceIntel;
  size: { employees: number | null };
}

export interface WhitespaceEvaluation {
  id: string;
  msaId: string;
  msaTitle: string;
  companyId: string;
  companyName: string;
  signingEntity: LeverageMsaInput['signingEntity'];
  global: boolean;
  countries: string[];
  lines: string[];
  headline: string;
  score: number;
  factors: WhitespaceFactor[];
  scopeAllowsOtherServices: boolean | null;
  scopeNeedsAmendment: boolean;
  expiryDate: string | null;
  evidenceHash: string;
}

// Word-boundary matchers for roles, job titles and themes. "Engineer" alone
// reads as IT when an IT word is present ("Cloud Data Engineer").
const IT_RE = /\b(it|information technology|software|cloud|cyber\w*|sap|s\/4hana|erp|infrastructure|data|devops|platform|aws|azure|salesforce|servicenow|network|security)\b/i;
const ENG_STRONG_RE = /\b(mechanical|industrial|manufacturing|automation|validation|r&d|plant|aerospace|automotive|process engineering)\b/i;
const ENG_WEAK_RE = /\bengineer(ing)?\b/i;
const DIGITAL_RE = /\b(digital|ux|ui|product design|e-commerce|ecommerce|transformation|customer experience)\b/i;

export function linesInText(text: string): string[] {
  const out = new Set<string>();
  const it = IT_RE.test(text);
  if (it) out.add('it');
  if (ENG_STRONG_RE.test(text) || (!it && ENG_WEAK_RE.test(text))) out.add('engineering');
  if (DIGITAL_RE.test(text)) out.add('digital');
  return [...out];
}

export function joinLineLabels(lines: readonly string[]): string {
  const labels = lines.map(labelBusinessLine);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}

const GLOBAL_RE = /\b(global|worldwide|world-wide|all countries|all territories|any country)\b/i;

export function isGlobalMsa(msa: { msaTitle: string; scopeOfServices: string | null; affiliatesClause: string | null; countries: string[] }): boolean {
  if (msa.countries.length >= 5) return true;
  return GLOBAL_RE.test([msa.msaTitle, msa.scopeOfServices ?? '', msa.affiliatesClause ?? ''].join('\n'));
}

function entityShortName(entity: { slug: string; name: string }): string {
  return entity.slug === 'hema' ? 'HEMA' : entity.name;
}

export function whitespaceHeadline(global: boolean, entity: { slug: string; name: string }, lines: readonly string[]): string {
  return `${global ? 'Global MSA' : 'MSA'} via ${entityShortName(entity)}, no ${joinLineLabels(lines)} business yet`;
}

/** FNV-1a 32-bit; stable across runtimes, enough to notice changed evidence. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function factor(key: WhitespaceFactorKey, points: number, detail: string, citations: WhitespaceCitation[]): WhitespaceFactor {
  return {
    key,
    label: FACTOR_LABEL[key],
    points: Math.max(0, Math.min(WHITESPACE_FACTOR_MAX[key], Math.round(points))),
    max: WHITESPACE_FACTOR_MAX[key],
    detail,
    citations,
  };
}

function matchesLines(text: string, lines: readonly string[]): string[] {
  return linesInText(text).filter((l) => lines.includes(l));
}

const DAY_MS = 86_400_000;

export function evaluateWhitespace(input: WhitespaceInput, now = Date.now()): WhitespaceEvaluation | null {
  const leverage = evaluateLeverage(input.msa, input.activity, now);
  if (!leverage) return null;
  const missing = leverage.missingLines.filter((l) => (EXPANSION_LINES as readonly string[]).includes(l));
  if (missing.length === 0) return null;
  const { msa, intel } = input;

  const rateHits = msa.rateCard
    .map((r) => ({ role: r.role, lines: matchesLines(r.role, missing) }))
    .filter((r) => r.lines.length > 0);
  const hiringHits = intel.hiring
    .map((h) => ({ ...h, lines: matchesLines(`${h.title} ${h.skills.join(' ')}`, missing) }))
    .filter((h) => h.lines.length > 0);
  const themeHits = intel.themes.map((t) => ({ ...t, lines: matchesLines(t.title, missing) })).filter((t) => t.lines.length > 0);
  const newsHits = intel.news.map((n) => ({ ...n, lines: matchesLines(n.title, missing) })).filter((n) => n.lines.length > 0);

  // Lines with the most evidence lead the headline; ties keep group order.
  const evidence = new Map<string, number>(missing.map((l) => [l, 0]));
  for (const hit of [...rateHits, ...hiringHits, ...themeHits, ...newsHits]) {
    for (const l of hit.lines) evidence.set(l, (evidence.get(l) ?? 0) + 1);
  }
  const anyEvidence = [...evidence.values()].some((n) => n > 0);
  const lines = anyEvidence
    ? missing.filter((l) => (evidence.get(l) ?? 0) > 0).sort((a, b) => (evidence.get(b) ?? 0) - (evidence.get(a) ?? 0) || missing.indexOf(a) - missing.indexOf(b))
    : [...missing];

  const global = isGlobalMsa(msa);
  const factors: WhitespaceFactor[] = [];

  // Scope: can we sell these lines under the MSA as signed?
  const scopeCitations: WhitespaceCitation[] = leverage.scopeCitation
    ? [{ kind: 'clause', label: leverage.scopeCitation.clause ?? 'Scope of services', clause: leverage.scopeCitation.clause, page: leverage.scopeCitation.page, excerpt: leverage.scopeCitation.excerpt }]
    : [];
  if (leverage.scopeAllowsOtherServices === true) factors.push(factor('scope', 25, 'Scope covers other group services', scopeCitations));
  else if (leverage.scopeAllowsOtherServices === null) factors.push(factor('scope', 10, 'Scope not captured yet', scopeCitations));
  else factors.push(factor('scope', 5, 'Scope needs an amendment', scopeCitations));

  // Coverage: global MSA, or the share of the account's countries it covers.
  const countryCitation: WhitespaceCitation[] = msa.countries.length ? [{ kind: 'countries', label: msa.countries.join(', ') }] : [];
  if (global) {
    factors.push(factor('coverage', 15, 'Global coverage', countryCitation.length ? countryCitation : scopeCitations));
  } else if (input.accountCountries.length > 0) {
    const covered = input.accountCountries.filter((c) => msa.countries.includes(c));
    factors.push(
      factor('coverage', (15 * covered.length) / input.accountCountries.length, `${covered.length} of ${input.accountCountries.length} account countries`, countryCitation),
    );
  } else {
    factors.push(factor('coverage', msa.countries.length >= 2 ? 8 : msa.countries.length === 1 ? 5 : 0, `${msa.countries.length} countries`, countryCitation));
  }

  // Affiliates: can other entities of the client order under it?
  const affText = msa.affiliatesClause ?? '';
  const affCitation: WhitespaceCitation[] = msa.affiliatesCitation
    ? [{ kind: 'clause', label: msa.affiliatesCitation.clause ?? 'Affiliates', clause: msa.affiliatesCitation.clause, page: msa.affiliatesCitation.page, excerpt: msa.affiliatesCitation.excerpt }]
    : affText
      ? [{ kind: 'clause', label: 'Affiliates', excerpt: affText.slice(0, 400) }]
      : [];
  if (!affText.trim()) factors.push(factor('affiliates', 0, 'No affiliates clause', []));
  else if (/\bmay not\b|\bnot permitted\b|without (?:an |a written )?amendment/i.test(affText)) factors.push(factor('affiliates', 2, 'Affiliates restricted', affCitation));
  else if (/affiliat|group compan/i.test(affText)) factors.push(factor('affiliates', 10, 'Affiliates may order', affCitation));
  else factors.push(factor('affiliates', 4, 'Affiliates clause present', affCitation));

  // Rate card: roles already priced for these lines but never sold.
  factors.push(
    factor(
      'rate_card',
      rateHits.length >= 2 ? 15 : rateHits.length === 1 ? 10 : 0,
      rateHits.length ? `${rateHits.length} priced roles unused` : 'No priced roles for these lines',
      rateHits.slice(0, 5).map((r) => ({ kind: 'rate_card' as const, label: r.role })),
    ),
  );

  // Renewal: an expiry in sight is the moment to widen scope.
  const expiry = msa.expiryDate ? Date.parse(msa.expiryDate) : null;
  const days = expiry ? Math.round((expiry - now) / DAY_MS) : null;
  const renewalCitation: WhitespaceCitation[] = msa.expiryDate ? [{ kind: 'renewal', label: `Expires ${msa.expiryDate.slice(0, 10)}` }] : [];
  if (days === null) factors.push(factor('renewal', 3, 'No expiry date', []));
  else if (days <= 180) factors.push(factor('renewal', 10, `Renews in ${days} days`, renewalCitation));
  else if (days <= 365) factors.push(factor('renewal', 6, `Renews in ${days} days`, renewalCitation));
  else factors.push(factor('renewal', 2, `Renews in ${days} days`, renewalCitation));

  // Account signals: hiring, investment themes, news in these lines.
  const hiringPts = hiringHits.length >= 3 ? 8 : hiringHits.length === 2 ? 6 : hiringHits.length === 1 ? 4 : 0;
  const intelPts = hiringPts + (themeHits.length ? 4 : 0) + (newsHits.length ? 3 : 0);
  const intelParts = [
    hiringHits.length ? `${hiringHits.length} open roles` : null,
    themeHits.length ? `${themeHits.length} investment themes` : null,
    newsHits.length ? `${newsHits.length} news items` : null,
  ].filter(Boolean);
  factors.push(
    factor('intel', intelPts, intelParts.length ? intelParts.join(', ') : 'No signals in these lines', [
      ...hiringHits.slice(0, 3).map((h) => ({ kind: 'hiring' as const, label: h.title, url: h.url })),
      ...themeHits.slice(0, 2).map((t) => ({ kind: 'theme' as const, label: t.title, url: t.url })),
      ...newsHits.slice(0, 2).map((n) => ({ kind: 'news' as const, label: n.title, url: n.url })),
    ]),
  );

  // Size: bigger accounts carry bigger openings.
  const employees = input.size.employees;
  const sizePts = employees === null ? 2 : employees >= 10_000 ? 10 : employees >= 1_000 ? 6 : employees >= 100 ? 3 : 1;
  factors.push(
    factor('size', sizePts, employees === null ? 'Size unknown' : `${employees.toLocaleString('en-US')} employees`, employees === null ? [] : [{ kind: 'firmographics', label: `${employees} employees` }]),
  );

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  const evidenceHash = fnv1a(
    JSON.stringify({ lines, factors: factors.map((f) => [f.key, f.points, f.citations.map((c) => `${c.kind}:${c.label}:${c.url ?? ''}`)]) }),
  );

  return {
    id: `${msa.msaId}:${lines.join('+')}`,
    msaId: msa.msaId,
    msaTitle: msa.msaTitle,
    companyId: msa.companyId,
    companyName: msa.companyName,
    signingEntity: msa.signingEntity,
    global,
    countries: msa.countries,
    lines,
    headline: whitespaceHeadline(global, msa.signingEntity, lines),
    score,
    factors,
    scopeAllowsOtherServices: leverage.scopeAllowsOtherServices,
    scopeNeedsAmendment: leverage.scopeNeedsAmendment,
    expiryDate: msa.expiryDate,
    evidenceHash,
  };
}

export function rankWhitespace<T extends { score: number; companyName: string }>(flags: readonly T[]): T[] {
  return [...flags].sort((a, b) => b.score - a.score || a.companyName.localeCompare(b.companyName));
}

export interface WhitespaceDecisionInput {
  line: string;
  state: 'accepted' | 'dismissed';
  evidenceHash: string;
  decidedAt: string;
  reason: string | null;
}

/**
 * State of one line on one MSA. A dismissal hides the line for 90 days, or
 * until the evidence behind the flag changes. The latest decision wins.
 */
export function resolveWhitespaceDecision(
  decisions: readonly WhitespaceDecisionInput[],
  line: string,
  evidenceHash: string,
  now = Date.now(),
): { state: 'new' | 'accepted' | 'dismissed'; suppressed: boolean; decision?: WhitespaceDecisionInput } {
  const latest = decisions
    .filter((d) => d.line === line)
    .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt))[0];
  if (!latest) return { state: 'new', suppressed: false };
  if (latest.state === 'accepted') return { state: 'accepted', suppressed: false, decision: latest };
  const fresh = now - Date.parse(latest.decidedAt) < WHITESPACE_DISMISS_DAYS * DAY_MS;
  if (fresh && latest.evidenceHash === evidenceHash) return { state: 'dismissed', suppressed: true, decision: latest };
  return { state: 'new', suppressed: false };
}

export const WHITESPACE_DIGEST_SIZE = 3;

export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface WhitespaceDigestFlag {
  msaId: string;
  companyName: string;
  score: number;
  headline: string;
  state: 'new' | 'accepted' | 'dismissed';
  evidenceHash: string;
}

export interface WhitespaceDigest<T extends WhitespaceDigestFlag> {
  flags: T[];
  url: string;
  title: string;
  body: string;
  /** Draft only. Nothing sends it; the owner copies it if they want to. */
  email: { subject: string; body: string };
}

/** Weekly digest for one owner: their top 3 new flags, in-app plus an email draft. */
export function buildWhitespaceDigest<T extends WhitespaceDigestFlag>(
  flags: readonly T[],
  opts: { ownerName: string; week: string },
): WhitespaceDigest<T> | null {
  const top = rankWhitespace(flags.filter((f) => f.state === 'new')).slice(0, WHITESPACE_DIGEST_SIZE);
  if (!top.length) return null;
  const n = top.length;
  const lines = top.map((f) => `${f.score} ${f.headline}`);
  return {
    flags: top,
    url: `/agreements/whitespace?digest=${opts.week}`,
    title: `${n} whitespace flag${n === 1 ? '' : 's'} this week`,
    body: lines.join('\n'),
    email: {
      subject: `Whitespace: ${n} flag${n === 1 ? '' : 's'} for ${opts.week}`,
      body: [`Hi ${opts.ownerName},`, '', ...top.map((f) => `- ${f.companyName}: ${f.headline} (score ${f.score})`), ''].join('\n'),
    },
  };
}
