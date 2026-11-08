/**
 * Evidence drafts (slice 15): what the worker and the demo seed store for
 * one firm read out of one public item or one internal record. The store
 * keys every draft on `key`, so a rescan updates in place.
 */
import { createHashKey } from './hash.js';
import { classifyDomains, classifyRelationship, partnerExcerpt, readPartnerMentions, redactContactDetails } from './classify.js';
import { matchFirms, namesClient, type ConsultingFirm } from './firms.js';
import type {
  PartnerContext,
  PartnerDomain,
  PartnerEvidenceMethod,
  PartnerEvidenceOrigin,
  PartnerEvidenceSource,
  PartnerRelationship,
  PartnerRemark,
  PartnerSentiment,
  RemarkDimension,
} from './types.js';

/** One evidence row before it is stored. */
export interface PartnerEvidenceDraft {
  firmKey: string;
  firmName: string;
  origin: PartnerEvidenceOrigin;
  source: PartnerEvidenceSource;
  method: PartnerEvidenceMethod;
  inferred: boolean;
  key: string;
  url: string | null;
  recordType: string | null;
  recordId: string | null;
  /** Opportunity the record hangs off, for access checks. */
  opportunityId: string | null;
  title: string | null;
  excerpt: string;
  occurredAt: Date | null;
  relationship: PartnerRelationship | null;
  domains: PartnerDomain[];
  context: PartnerContext | null;
  sentiment: PartnerSentiment | null;
  remarks: PartnerRemark[];
  outcome: 'won' | 'lost' | null;
  sample: boolean;
}

/** A public article, press release or case study. */
export interface PartnerPublicItem {
  source: Extract<PartnerEvidenceSource, 'gdelt' | 'google_news' | 'firm_site' | 'company_newsroom' | 'account_news' | 'fixture'>;
  url: string | null;
  title: string;
  description: string;
  publishedAt: Date | null;
  /** Host the item was published on, when known. */
  host?: string | null;
}

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** Never read items published on these hosts (no LinkedIn content). */
const BLOCKED_HOSTS = ['linkedin.com', 'lnkd.in'];

const onDomain = (host: string | null, domains: readonly string[]) => Boolean(host && domains.some((d) => host === d || host.endsWith(`.${d}`)));

/**
 * Firms linked to the client by one public item. The item must name the
 * client; a news item must also carry a relationship word. A case study on
 * the firm's own site counts without one and is marked inferred.
 */
export function readPublicItem(item: PartnerPublicItem, clientName: string, firms: readonly ConsultingFirm[]): PartnerEvidenceDraft[] {
  const text = redactContactDetails(`${item.title}. ${item.description}`.trim());
  if (!namesClient(text, clientName)) return [];
  const host = item.host?.toLowerCase() ?? hostOf(item.url);
  if (onDomain(host, BLOCKED_HOSTS) || onDomain(hostOf(item.url), BLOCKED_HOSTS)) return [];
  const siteOwners = firms.filter((f) => onDomain(host, f.domains)).map((f) => f.key);
  const keys = [...new Set([...matchFirms(text, firms).map((m) => m.firmKey), ...siteOwners])];
  const out: PartnerEvidenceDraft[] = [];
  for (const firmKey of keys) {
    const firm = firms.find((f) => f.key === firmKey)!;
    const excerpt = partnerExcerpt(text, firmKey, firms);
    const relationship = classifyRelationship(text);
    const ownSite = siteOwners.includes(firmKey);
    if (!relationship && !ownSite) continue;
    out.push({
      firmKey,
      firmName: firm.name,
      origin: 'public',
      source: ownSite && item.source !== 'fixture' ? 'firm_site' : item.source,
      method: item.source === 'fixture' ? 'fixture' : 'keyword_match',
      inferred: relationship === null,
      key: `pub:${createHashKey(item.url ?? text)}`,
      url: item.url,
      recordType: null,
      recordId: null,
      opportunityId: null,
      title: redactContactDetails(item.title).slice(0, 300),
      excerpt,
      occurredAt: item.publishedAt,
      relationship,
      domains: classifyDomains(text),
      context: null,
      sentiment: null,
      remarks: [],
      outcome: null,
      sample: item.source === 'fixture',
    });
  }
  return out;
}

/** One internal record with text. */
export interface PartnerInternalRecord {
  source: Extract<PartnerEvidenceSource, 'meeting' | 'email' | 'activity' | 'note' | 'competitor_insight'>;
  recordType: string;
  recordId: string;
  opportunityId?: string | null;
  title: string | null;
  text: string;
  occurredAt: Date | null;
  sample?: boolean;
}

/** Firms mentioned in one internal record, with context, sentiment and remarks. */
export function readInternalRecord(rec: PartnerInternalRecord, firms: readonly ConsultingFirm[]): PartnerEvidenceDraft[] {
  const text = [rec.title, rec.text].filter(Boolean).join('. ');
  return readPartnerMentions(text, firms).map((r) => ({
    firmKey: r.firmKey,
    firmName: firms.find((f) => f.key === r.firmKey)?.name ?? r.firmKey,
    origin: 'internal' as const,
    source: rec.source,
    method: 'keyword_match' as const,
    inferred: false,
    key: `int:${rec.recordType}:${rec.recordId}`,
    url: null,
    recordType: rec.recordType,
    recordId: rec.recordId,
    opportunityId: rec.opportunityId ?? null,
    title: rec.title ? redactContactDetails(rec.title).slice(0, 300) : null,
    excerpt: r.excerpt,
    occurredAt: rec.occurredAt,
    relationship: null,
    domains: r.domains,
    context: r.context,
    sentiment: r.sentiment,
    remarks: r.remarks,
    outcome: null,
    sample: rec.sample ?? false,
  }));
}

/** Win/loss reason codes that speak to one dimension. */
const REASON_DIMENSION: Record<string, RemarkDimension | undefined> = {
  price: 'price',
  timing: 'speed',
  product_fit: 'domain',
  scope: 'domain',
};

/** A win/loss record whose competitor (or note) names a firm. */
export interface WinLossInput {
  id: string;
  opportunityId: string;
  opportunityName: string;
  outcome: 'won' | 'lost';
  reason: string;
  competitor: string | null;
  note: string | null;
  decidedAt: Date;
}

/** Evidence from a win/loss record: outcome against the firm, the reason as a remark. */
export function readWinLoss(raw: WinLossInput, firms: readonly ConsultingFirm[]): PartnerEvidenceDraft[] {
  const w = { ...raw, note: raw.note ? redactContactDetails(raw.note) : null };
  const fromField = w.competitor ? [...new Set(matchFirms(w.competitor, firms).map((m) => m.firmKey))] : [];
  const keys = fromField.length ? fromField : [...new Set(matchFirms(w.note ?? '', firms).map((m) => m.firmKey))];
  const dim = REASON_DIMENSION[w.reason];
  const reasonText = w.reason.replace(/_/g, ' ');
  return keys.map((firmKey) => {
    const remarks: PartnerRemark[] = dim
      ? [{ dimension: dim, favours: w.outcome === 'won' ? 'us' : 'partner', phrase: `${w.outcome === 'won' ? 'Won' : 'Lost'} on ${reasonText}` }]
      : [];
    const excerpt = [`${w.outcome === 'won' ? 'Won' : 'Lost'} against ${w.competitor ?? firmKey}, reason: ${reasonText}.`, w.note ?? ''].join(' ').trim().slice(0, 300);
    return {
      firmKey,
      firmName: firms.find((f) => f.key === firmKey)?.name ?? firmKey,
      origin: 'internal' as const,
      source: 'win_loss' as const,
      method: fromField.length ? ('record_field' as const) : ('keyword_match' as const),
      inferred: !fromField.length,
      key: `int:win_loss:${w.id}`,
      url: null,
      recordType: 'win_loss',
      recordId: w.id,
      opportunityId: w.opportunityId,
      title: w.opportunityName.slice(0, 300),
      excerpt,
      occurredAt: w.decidedAt,
      relationship: null,
      domains: classifyDomains(`${w.opportunityName} ${w.note ?? ''}`),
      context: 'competing' as const,
      sentiment: w.outcome === 'won' ? ('negative' as const) : ('positive' as const),
      remarks,
      outcome: w.outcome,
      sample: false,
    };
  });
}

/** One competitor entry in an opportunity's bid intel. */
export interface BidCompetitorInput {
  opportunityId: string;
  opportunityName: string;
  vendor: string;
  score: number | null;
  strengths: string[];
  weaknesses: string[];
  at: Date | null;
}

const DIMENSION_WORDS: Array<[RemarkDimension, RegExp]> = [
  ['price', /\b(cost|costs|price|pricing|rates?|expensive|cheap\w*|fees?)\b/i],
  ['speed', /\b(speed|fast|slow|agility|agile|time to market|delivery time|ramp[- ]up)\b/i],
  ['domain', /\b(depth|expertise|domain|know[- ]how|speciali[sz]\w*|experience|sector)\b/i],
  ['quality', /\b(quality|reliab\w*|delivery|track record)\b/i],
];

/** Evidence from a bid competitor field: strengths favour the firm, weaknesses favour us. */
export function readBidCompetitor(raw: BidCompetitorInput, firms: readonly ConsultingFirm[]): PartnerEvidenceDraft[] {
  const b = { ...raw, strengths: raw.strengths.map(redactContactDetails), weaknesses: raw.weaknesses.map(redactContactDetails) };
  const keys = [...new Set(matchFirms(b.vendor, firms).map((m) => m.firmKey))];
  const remarks: PartnerRemark[] = [];
  for (const [list, favours] of [[b.strengths, 'partner'], [b.weaknesses, 'us']] as const) {
    for (const s of list) {
      const dim = DIMENSION_WORDS.find(([, re]) => re.test(s))?.[0];
      if (dim) remarks.push({ dimension: dim, favours, phrase: `${favours === 'partner' ? 'Strength' : 'Weakness'}: ${s}` });
    }
  }
  const parts = [
    b.strengths.length ? `Strengths: ${b.strengths.join(', ')}.` : '',
    b.weaknesses.length ? `Weaknesses: ${b.weaknesses.join(', ')}.` : '',
    b.score !== null ? `Bid score ${b.score}.` : '',
  ].filter(Boolean);
  return keys.map((firmKey) => ({
    firmKey,
    firmName: firms.find((f) => f.key === firmKey)?.name ?? b.vendor,
    origin: 'internal' as const,
    source: 'bid_intel' as const,
    method: 'record_field' as const,
    inferred: false,
    key: `int:bid_intel:${b.opportunityId}:${firmKey}`,
    url: null,
    recordType: 'opportunity',
    recordId: b.opportunityId,
    opportunityId: b.opportunityId,
    title: b.opportunityName.slice(0, 300),
    excerpt: `Competing on ${b.opportunityName}. ${parts.join(' ')}`.trim().slice(0, 300),
    occurredAt: b.at,
    relationship: null,
    domains: classifyDomains(b.opportunityName),
    context: 'competing' as const,
    sentiment: null,
    remarks,
    outcome: null,
    sample: false,
  }));
}
