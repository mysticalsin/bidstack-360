/**
 * Deterministic MSA field extractor. Reads labelled clauses from plain text
 * (PDF text layer or DOCX). Missing values stay blank. Nothing is invented.
 */
import type { MsaCitation, MsaExtractedField, MsaExtractedFields, MsaParty } from '../schemas/msa-intake.js';
import { unitsTextToMicros } from '../utils/money.js';

export const LOW_CONFIDENCE_BPS = 6500;
const LABELLED = 8500;
const PATTERN = 7000;
const WEAK = 5200;

export interface TextPage {
  page: number | null;
  text: string;
}

const EMPTY: Omit<MsaExtractedField, 'key'> = {
  value: null,
  found: false,
  confidenceBps: 0,
  citation: null,
};

function field(key: string, value: unknown, confidenceBps: number, citation: MsaCitation | null): MsaExtractedField {
  if (value === null || value === undefined || value === '') {
    return { key, ...EMPTY };
  }
  return { key, value, found: true, confidenceBps, citation };
}

function toIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function clauseNear(text: string, index: number): string | null {
  const window = text.slice(Math.max(0, index - 400), index + 40);
  const matches = [...window.matchAll(/\b(?:clause|article|section)\s+(\d+(?:\.\d+)*)\b/gi)];
  const last = matches.at(-1);
  return last ? last[0] : null;
}

function excerptAt(text: string, index: number, length = 180): string {
  const start = Math.max(0, index - 20);
  return text.slice(start, start + length).replace(/\s+/g, ' ').trim();
}

function findInPages(
  pages: TextPage[],
  re: RegExp,
): { match: RegExpMatchArray; page: number | null; source: string } | null {
  for (const page of pages) {
    const match = page.text.match(re);
    if (match && match.index != null) return { match, page: page.page, source: page.text };
  }
  return null;
}

function cite(source: string, index: number, page: number | null): MsaCitation {
  return {
    page,
    clause: clauseNear(source, index),
    excerpt: excerptAt(source, index),
  };
}

function first(pages: TextPage[], patterns: RegExp[], confidence = LABELLED): {
  text: string;
  confidenceBps: number;
  citation: MsaCitation;
} | null {
  for (const re of patterns) {
    const hit = findInPages(pages, re);
    if (!hit) continue;
    const captured = matchGroup(hit.match) ?? hit.match[0];
    const raw = captured.replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '');
    if (!raw) continue;
    return {
      text: raw,
      confidenceBps: confidence,
      citation: cite(hit.source, hit.match.index ?? 0, hit.page),
    };
  }
  return null;
}

function matchGroup(m: RegExpMatchArray): string | undefined {
  return m[1] ?? m[2] ?? undefined;
}

function detectParties(pages: TextPage[]): {
  parties: MsaParty[];
  client: string | null;
  ours: string | null;
  citation: MsaCitation | null;
  confidenceBps: number;
} {
  // Prefer a labelled "Clause N. Parties" line so the citation names a clause,
  // then fall back to the preamble "between X (Client) and Y (Supplier)".
  const named = findInPages(
    pages,
    /the parties are\s+([\s\S]{8,160}?)\s+\((?:Client|Customer|Company)\)\s+and\s+([\s\S]{8,160}?)\s+\((?:Supplier|Provider|Consultant|Contractor)\)/i,
  );
  const labeledClient = findInPages(
    pages,
    /between\s+([\s\S]{8,280}?)\s+\("?(?:Client|Customer|Company)"?\)/i,
  );
  const labeledOurs = findInPages(
    pages,
    /(?:and|&)\s+([\s\S]{8,280}?)\s+\("?(?:Supplier|Provider|Consultant|Contractor)"?\)/i,
  );
  const between = first(pages, [
    /between\s+([\s\S]{8,220}?)\s+\("?(?:Client|Customer|Company)"?\)/i,
    /between\s+([^.]{8,160}?)\s+and\s+([^.]{8,160}?)(?:\s*\(|,|\.)/i,
  ], PATTERN);
  if (!named && !labeledClient && !between) return { parties: [], client: null, ours: null, citation: null, confidenceBps: 0 };

  const client = cleanParty(named?.match[1] ?? labeledClient?.match[1] ?? between?.text.split(/\s+and\s+/i)[0] ?? '');
  const ours = cleanParty(named?.match[2] ?? labeledOurs?.match[1] ?? between?.text.split(/\s+and\s+/i)[1] ?? '');
  const address = first(pages, [/registered office is at\s+([^.]{8,160})/i], WEAK);
  const email = first(pages, [/email\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i], PATTERN);
  const parties: MsaParty[] = [];
  if (client) parties.push({ name: client, role: 'client', address: address?.text ?? null, email: email?.text ?? null });
  if (ours) parties.push({ name: ours, role: 'ours', address: null, email: null });
  const hit = named ?? labeledClient;
  return {
    parties,
    client: client || null,
    ours: ours || null,
    citation: hit
      ? cite(hit.source, hit.match.index ?? 0, hit.page)
      : between?.citation ?? null,
    confidenceBps: named || labeledClient ? PATTERN : between?.confidenceBps ?? 0,
  };
}

function cleanParty(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^(?:and|&)\s+/i, '')
    .replace(/,?\s*whose registered office is at.*$/i, '')
    .replace(/\s+\("?(?:Client|Customer|Company|Supplier|Provider)"?\)?$/i, '')
    .trim();
}

/**
 * Contract text to a dot-decimal unit string.
 * `250,000` is thousands. A leading group longer than three, such as `1234,567`, is cents.
 */
export function normalizeContractAmount(raw: string): string {
  const text = raw.replace(/[\s\u00a0\u202f]/g, '');
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const decimalIsDot = lastDot > lastComma;
    const thousands = decimalIsDot ? ',' : '.';
    const decimal = decimalIsDot ? '.' : ',';
    return text.split(thousands).join('').replace(decimal, '.');
  }
  if (lastComma >= 0) {
    const parts = text.split(',');
    const head = parts[0] ?? '';
    const grouped = head.length >= 1 && head.length <= 3 && parts.slice(1).every((part) => part.length === 3);
    if (grouped && parts.length > 1) return parts.join('');
    return `${parts.slice(0, -1).join('')}.${parts[parts.length - 1] ?? ''}`;
  }
  return text;
}

/** Contract text to integer micros. A figure that does not fit a safe integer is omitted. */
export function contractMicros(raw: string): number | null {
  const micros = unitsTextToMicros(normalizeContractAmount(raw));
  if (micros == null || micros <= 0n || micros > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(micros);
}

/** A cap object safe to store. A sentence such as "amount not readable" is not a cap. */
export function storableLiabilityCap(value: unknown): { amountMicros: number; currency: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const cap = value as { amountMicros?: unknown; currency?: unknown };
  if (typeof cap.amountMicros !== 'number' || !Number.isSafeInteger(cap.amountMicros) || cap.amountMicros < 0) return null;
  if (typeof cap.currency !== 'string' || !/^[A-Za-z]{3}$/.test(cap.currency)) return null;
  return { amountMicros: cap.amountMicros, currency: cap.currency.toUpperCase() };
}

function detectLiability(pages: TextPage[]): { amountMicros: number | null; currency: string; citation: MsaCitation; confidenceBps: number } | null {
  const hit = findInPages(pages, /liability[^.%]{0,120}?(?:capped at|cap(?:ped)? of|not exceed)\s*([€£$])?\s*([\d,.\s]{3,16})\s*(EUR|USD|GBP|CHF)?/i);
  if (!hit) return null;
  const symbol = hit.match[1];
  const code = (hit.match[3] ?? (symbol === '€' ? 'EUR' : symbol === '£' ? 'GBP' : symbol === '$' ? 'USD' : 'EUR')).toUpperCase();
  return {
    amountMicros: contractMicros(hit.match[2] ?? ''),
    currency: code,
    citation: cite(hit.source, hit.match.index ?? 0, hit.page),
    confidenceBps: LABELLED,
  };
}

/** Rows safe to store on the agreement. An unreadable rate stays on the review and is left off the record. */
export function storableRateCard(value: unknown): Array<{ role: string; rateMicros: number; unit: 'day' | 'hour' | 'month' | 'year' }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ role: string; rateMicros: number; unit: 'day' | 'hour' | 'month' | 'year' }> = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const item = row as { role?: unknown; rateMicros?: unknown; unit?: unknown };
    if (typeof item.role !== 'string' || !item.role.trim()) continue;
    if (typeof item.rateMicros !== 'number' || !Number.isSafeInteger(item.rateMicros) || item.rateMicros < 0) continue;
    if (item.rateMicros > 1_000_000_000_000) continue;
    const unit = item.unit === 'hour' || item.unit === 'month' || item.unit === 'year' ? item.unit : 'day';
    out.push({ role: item.role.trim(), rateMicros: item.rateMicros, unit });
  }
  return out;
}

function detectRateCard(pages: TextPage[]): { role: string; rateMicros: number | null; unit: 'day' | 'hour' | 'month' | 'year' }[] {
  const lines: { role: string; rateMicros: number | null; unit: 'day' | 'hour' | 'month' | 'year' }[] = [];
  const unitMap: Record<string, 'day' | 'hour' | 'month' | 'year'> = {
    day: 'day',
    daily: 'day',
    hour: 'hour',
    month: 'month',
    year: 'year',
  };
  for (const page of pages) {
    for (const raw of page.text.split(/\r?\n/)) {
      const m = raw.match(
        /^\s*([A-Za-z][A-Za-z /&'-]{2,60}?)\s*[:.\t|]*\s*[€£$]?\s*([\d.,]{2,24})\s*(?:EUR|USD|GBP)?\s*(?:\/|per|par)?\s*(day|daily|hour|month|year)\b/i,
      );
      if (!m) continue;
      const role = m[1]!.trim().replace(/[:.-]+$/, '');
      const rateMicros = contractMicros(m[2] ?? '');
      const unit = unitMap[m[3]!.toLowerCase()] ?? 'day';
      if (!role) continue;
      lines.push({ role, rateMicros, unit });
    }
  }
  return lines.slice(0, 50);
}

export function extractMsaFields(input: string | TextPage[]): MsaExtractedFields {
  const pages: TextPage[] = Array.isArray(input)
    ? input
    : input.split(/\f/g).map((text, i, all) => ({ page: all.length > 1 ? i + 1 : null, text }));
  const joined = pages.map((p) => p.text).join('\n');
  if (!joined.trim()) {
    return emptyFields();
  }

  const parties = detectParties(pages);
  const effective = first(pages, [
    /effective date\s*[:.]?\s*(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i,
    /entered into as of\s+(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
  ]);
  const expiry = first(pages, [
    /expires? on\s+(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
    /(?:expiry|expiration)\s*(?:date)?\s*[:.]?\s*(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
  ]);
  const termMonths = first(pages, [/term is\s+(\d{1,3})\s+months/i, /for a (?:period|term) of\s+(\d{1,3})\s+months/i]);
  const termText = first(pages, [/the term is[^.]+/i, /for a (?:period|term) of[^.]+/i], PATTERN);
  const auto = findInPages(pages, /auto-?renew|shall renew automatically|renews automatically/i);
  const renewal = first(pages, [/auto-?renew[^.]+/i, /successive\s+\d+[^.]+periods[^.]+/i], PATTERN);
  const law = first(pages, [
    /governed by the laws? of\s+([^.]{2,80})/i,
    /governing law\s*[:.]?\s*([^.\n]{2,80})/i,
  ]);
  const pay = first(pages, [
    /payable\s+(net\s+\d{1,3}\s+days[^.]* )/i,
    /payment terms\s*[:.]?\s*([^.\n]{3,120})/i,
    /(net\s+\d{1,3}\s+days[^.]* )/i,
  ]);
  const notice = first(pages, [
    /(\d{1,3})\s+days(?:\s+\w+){0,6}\s+notice/i,
    /notice of non-renewal/i,
  ]);
  const noticeDays = notice?.text.match(/(\d{1,3})/)?.[1];
  const ip = first(pages, [/intellectual property[^.]*\.[^.]{0,240}/i, /pre-existing intellectual property[^.]+/i], PATTERN);
  const conf = first(pages, [/confidential[^.]*secret[^.]+/i, /keep confidential information[^.]+/i], PATTERN);
  const nonSolicit = first(pages, [/shall not solicit[^.]+/i, /non-?solicit[^.]+/i], PATTERN);
  const exclusivity = first(pages, [/exclusive provider[^.]+/i, /exclusivity[^.]+/i], PATTERN);
  const insurance = first(pages, [/professional indemnity insurance[^.]+/i, /shall maintain[^.]*insurance[^.]+/i], PATTERN);
  const indexation = first(pages, [/no indexation[^.]* /i, /index(?:ed|ation)[^.]+/i], PATTERN);
  const scope = first(pages, [/scope of services[:\s]+([^.]+(?:\.[^.]{0,200})?)/i, /shall provide[^.]+/i], PATTERN);
  const affiliates = first(pages, [/affiliates[^.]+/i], PATTERN);
  const liability = detectLiability(pages);
  const rateCard = detectRateCard(pages);
  const rateCite = findInPages(pages, /rate card|senior consultant|per day/i);

  return {
    parties: field('parties', parties.parties.length ? parties.parties : null, parties.confidenceBps, parties.citation),
    clientParty: field('clientParty', parties.client, parties.confidenceBps, parties.citation),
    ourParty: field('ourParty', parties.ours, parties.confidenceBps, parties.citation),
    effectiveDate: field('effectiveDate', effective ? toIsoDate(effective.text) : null, effective?.confidenceBps ?? 0, effective?.citation ?? null),
    termMonths: field('termMonths', termMonths ? Number(termMonths.text) : null, termMonths?.confidenceBps ?? 0, termMonths?.citation ?? null),
    termText: field('termText', termText?.text ?? null, termText?.confidenceBps ?? 0, termText?.citation ?? null),
    autoRenew: auto
      ? field('autoRenew', true, PATTERN, cite(auto.source, auto.match.index ?? 0, auto.page))
      : { key: 'autoRenew', ...EMPTY },
    renewalTerms: field('renewalTerms', renewal?.text ?? null, renewal?.confidenceBps ?? 0, renewal?.citation ?? null),
    expiryDate: field('expiryDate', expiry ? toIsoDate(expiry.text) : null, expiry?.confidenceBps ?? 0, expiry?.citation ?? null),
    governingLaw: field('governingLaw', law?.text ?? null, law?.confidenceBps ?? 0, law?.citation ?? null),
    liabilityCap: liability
      ? liability.amountMicros == null
        ? {
            key: 'liabilityCap',
            value: 'amount not readable',
            found: true,
            confidenceBps: liability.confidenceBps,
            citation: liability.citation,
          }
        : field(
            'liabilityCap',
            { amountMicros: liability.amountMicros, currency: liability.currency },
            liability.confidenceBps,
            liability.citation,
          )
      : { key: 'liabilityCap', ...EMPTY },
    paymentTerms: field('paymentTerms', pay?.text ?? null, pay?.confidenceBps ?? 0, pay?.citation ?? null),
    noticePeriodDays: field('noticePeriodDays', noticeDays ? Number(noticeDays) : null, notice?.confidenceBps ?? 0, notice?.citation ?? null),
    ip: field('ip', ip?.text ?? null, ip?.confidenceBps ?? 0, ip?.citation ?? null),
    confidentiality: field('confidentiality', conf?.text ?? null, conf?.confidenceBps ?? 0, conf?.citation ?? null),
    nonSolicit: field('nonSolicit', nonSolicit?.text ?? null, nonSolicit?.confidenceBps ?? 0, nonSolicit?.citation ?? null),
    exclusivity: field('exclusivity', exclusivity?.text ?? null, exclusivity?.confidenceBps ?? 0, exclusivity?.citation ?? null),
    insurance: field('insurance', insurance?.text ?? null, insurance?.confidenceBps ?? 0, insurance?.citation ?? null),
    rateCard: field('rateCard', rateCard.length ? rateCard : null, rateCard.length ? PATTERN : 0, rateCite ? cite(rateCite.source, rateCite.match.index ?? 0, rateCite.page) : null),
    indexation: field('indexation', indexation?.text ?? null, indexation?.confidenceBps ?? 0, indexation?.citation ?? null),
    scopeOfServices: field('scopeOfServices', scope?.text ?? null, scope?.confidenceBps ?? 0, scope?.citation ?? null),
    affiliatesClause: field('affiliatesClause', affiliates?.text ?? null, affiliates?.confidenceBps ?? 0, affiliates?.citation ?? null),
  };
}

export function emptyFields(): MsaExtractedFields {
  const keys: Array<keyof MsaExtractedFields> = [
    'parties',
    'clientParty',
    'ourParty',
    'effectiveDate',
    'termMonths',
    'termText',
    'autoRenew',
    'renewalTerms',
    'expiryDate',
    'governingLaw',
    'liabilityCap',
    'paymentTerms',
    'noticePeriodDays',
    'ip',
    'confidentiality',
    'nonSolicit',
    'exclusivity',
    'insurance',
    'rateCard',
    'indexation',
    'scopeOfServices',
    'affiliatesClause',
  ];
  const out = {} as MsaExtractedFields;
  for (const key of keys) out[key] = { key, ...EMPTY };
  return out;
}

export function stringField(fields: MsaExtractedFields, key: keyof MsaExtractedFields): string | null {
  const value = fields[key].value;
  return typeof value === 'string' && value.trim() ? value : null;
}

export function citationsFromFields(fields: MsaExtractedFields): Record<string, MsaCitation> {
  const out: Record<string, MsaCitation> = {};
  for (const [key, fieldValue] of Object.entries(fields)) {
    if (fieldValue.citation) out[key] = fieldValue.citation;
  }
  return out;
}
