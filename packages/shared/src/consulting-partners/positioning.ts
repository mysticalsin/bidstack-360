/**
 * Positioning per consulting partner (slice 15).
 *
 * Scores come only from evidence the caller can read: quality, price, speed
 * and domain from remarks in our records, win/loss reasons and bid
 * competitor fields; relationship from our engagement count against the
 * partner's evidenced engagements. A dimension with no evidence is
 * 'no_evidence' with null scores, never a guess.
 */
import { firmMonogram, type ConsultingFirm } from './firms.js';
import {
  PARTNER_DOMAIN_LABEL,
  PARTNER_RELATIONSHIP_LABEL,
  POSITIONING_DIMENSION_LABEL,
  type ConsultingPartnerCard,
  type ConsultingPartnersSummary,
  type DimensionScore,
  type PartnerDomain,
  type PartnerEvidence,
  type PartnerRelationship,
  type PartnerRemark,
  type PartnerRunStatus,
  type PositioningAngle,
  type RemarkDimension,
} from './types.js';

const DAY = 86_400_000;
const REMARK_DIMENSIONS: RemarkDimension[] = ['quality', 'price', 'speed', 'domain'];
const MAX_PARTNERS = 12;
const MAX_TIMELINE = 24;
const MAX_CITES = 5;

/** Our engagements on the account (counts only). */
export interface OurEngagements {
  won: number;
  open: number;
}

function when(e: PartnerEvidence): string {
  return e.date ?? e.fetchedAt;
}

function vote(remarks: PartnerRemark[], dim: RemarkDimension): 'us' | 'partner' | 'neutral' | null {
  const mine = remarks.filter((r) => r.dimension === dim);
  if (!mine.length) return null;
  let n = 0;
  for (const r of mine) n += r.favours === 'us' ? 1 : r.favours === 'partner' ? -1 : 0;
  return n > 0 ? 'us' : n < 0 ? 'partner' : 'neutral';
}

/** Partner-side engagements: public relationship evidence and internal incumbent mentions. */
function partnerEngagements(items: PartnerEvidence[]): PartnerEvidence[] {
  return items.filter((e) => (e.origin === 'public' && e.relationship !== null) || e.context === 'incumbent');
}

/** Score card for one partner: four remark dimensions plus relationship. */
export function scorePartner(items: PartnerEvidence[], ours: OurEngagements): DimensionScore[] {
  const out: DimensionScore[] = [];
  for (const dim of REMARK_DIMENSIONS) {
    const votes = items.map((e) => ({ id: e.id, v: vote(e.remarks, dim) })).filter((x) => x.v !== null);
    if (!votes.length) {
      out.push({ dimension: dim, status: 'no_evidence', us: null, partner: null, evidenceCount: 0, evidenceIds: [] });
      continue;
    }
    const pts = votes.reduce((s, x) => s + (x.v === 'us' ? 1 : x.v === 'neutral' ? 0.5 : 0), 0);
    const us = Math.round((100 * pts) / votes.length);
    out.push({ dimension: dim, status: 'scored', us, partner: 100 - us, evidenceCount: votes.length, evidenceIds: votes.map((x) => x.id) });
  }
  const theirs = partnerEngagements(items);
  const ourCount = Math.max(0, ours.won) + Math.max(0, ours.open);
  const n = ourCount + theirs.length;
  if (n === 0) {
    out.push({ dimension: 'relationship', status: 'no_evidence', us: null, partner: null, evidenceCount: 0, evidenceIds: [] });
  } else {
    const us = Math.round((100 * ourCount) / n);
    out.push({ dimension: 'relationship', status: 'scored', us, partner: 100 - us, evidenceCount: n, evidenceIds: theirs.map((e) => e.id) });
  }
  return out;
}

/** Link strength: evidence count weighted by recency (one year half life). */
export function partnerStrength(items: PartnerEvidence[], now: Date): ConsultingPartnerCard['strength'] {
  let score = 0;
  for (const e of items) {
    const age = Math.max(0, now.getTime() - new Date(when(e)).getTime()) / DAY;
    score += 0.5 ** (age / 365);
  }
  const rounded = Math.round(score * 100) / 100;
  return { level: rounded >= 3 ? 'strong' : rounded >= 1.5 ? 'medium' : 'weak', score: rounded, evidenceCount: items.length };
}

function byFrequency<T extends string>(values: T[]): T[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const year = (iso: string) => new Date(iso).getUTCFullYear();

/** Won and lost bids against the partner. */
export function partnerRecord(items: PartnerEvidence[]): ConsultingPartnerCard['record'] {
  const decided = items.filter((e) => e.outcome !== null);
  const years = decided.map((e) => year(when(e))).filter(Number.isFinite);
  return {
    wins: decided.filter((e) => e.outcome === 'won').length,
    losses: decided.filter((e) => e.outcome === 'lost').length,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
  };
}

/** One to three cited angles; none when there is nothing to cite. */
export function partnerAngles(
  name: string,
  clientName: string,
  items: PartnerEvidence[],
  scorecard: DimensionScore[],
  record: ConsultingPartnerCard['record'],
): PositioningAngle[] {
  const out: PositioningAngle[] = [];
  const publicLinks = items.filter((e) => e.origin === 'public' && e.relationship !== null);
  if (publicLinks.length) {
    const rels = byFrequency(publicLinks.map((e) => e.relationship as PartnerRelationship)).slice(0, 2);
    const doms = byFrequency(publicLinks.flatMap((e) => e.domains)).slice(0, 2);
    const since = Math.min(...publicLinks.map((e) => year(when(e))));
    const relText = joinWords(rels.map((r) => PARTNER_RELATIONSHIP_LABEL[r].toLowerCase()));
    const domText = doms.length ? ` in ${joinWords(doms.map((d) => PARTNER_DOMAIN_LABEL[d]))}` : '';
    out.push({
      text: `${name} works on ${relText} at ${clientName}${domText}, ${plural(publicLinks.length, 'public source', 'public sources')} since ${since}.`,
      basis: publicLinks.every((e) => e.inferred) ? 'inferred' : 'observed',
      evidenceIds: publicLinks.slice(0, MAX_CITES).map((e) => e.id),
    });
  }
  if (record.wins + record.losses > 0) {
    const decided = items.filter((e) => e.outcome !== null);
    const span = record.firstYear === record.lastYear ? ` in ${record.lastYear}` : ` since ${record.firstYear}`;
    out.push({
      text: `${plural(record.wins, 'win', 'wins')} vs ${plural(record.losses, 'loss', 'losses')} against ${name}${span}.`,
      basis: 'observed',
      evidenceIds: decided.slice(0, MAX_CITES).map((e) => e.id),
    });
  }
  const scored = scorecard.filter((d) => d.status === 'scored' && d.dimension !== 'relationship' && d.us !== null && d.partner !== null);
  const byEdge = [...scored].sort((a, b) => (b.us! - b.partner!) - (a.us! - a.partner!));
  const best = byEdge[0];
  const worst = byEdge.at(-1);
  const favouring = (d: DimensionScore, side: 'us' | 'partner') =>
    d.evidenceIds.filter((id) => vote(items.find((e) => e.id === id)?.remarks ?? [], d.dimension as RemarkDimension) === side).length;
  if (best && best.us! > best.partner!) {
    const k = favouring(best, 'us');
    out.push({
      text: `We lead ${name} on ${POSITIONING_DIMENSION_LABEL[best.dimension].toLowerCase()}: ${k} of ${plural(best.evidenceCount, 'cited record', 'cited records')} favour us.`,
      basis: 'inferred',
      evidenceIds: best.evidenceIds.slice(0, MAX_CITES),
    });
  } else if (worst && worst.partner! > worst.us!) {
    const k = favouring(worst, 'partner');
    out.push({
      text: `${name} leads on ${POSITIONING_DIMENSION_LABEL[worst.dimension].toLowerCase()}: ${k} of ${plural(worst.evidenceCount, 'cited record', 'cited records')} favour them.`,
      basis: 'inferred',
      evidenceIds: worst.evidenceIds.slice(0, MAX_CITES),
    });
  }
  return out.slice(0, 3);
}

/** Inputs for the account summary. */
export interface ComposePartnersInput {
  companyId: string;
  clientName: string;
  firms: readonly ConsultingFirm[];
  /** Evidence the caller may read (internal items already access filtered). */
  evidence: PartnerEvidence[];
  engagements: OurEngagements;
  run: PartnerRunStatus;
  now: Date;
}

/** The account summary: one card per partner, strongest first. */
export function composeConsultingPartners(input: ComposePartnersInput): ConsultingPartnersSummary {
  const byFirm = new Map<string, PartnerEvidence[]>();
  for (const e of input.evidence) {
    const list = byFirm.get(e.firmKey) ?? [];
    list.push(e);
    byFirm.set(e.firmKey, list);
  }
  const catalog = new Map(input.firms.map((f) => [f.key, f]));
  const partners: ConsultingPartnerCard[] = [];
  for (const [firmKey, items] of byFirm) {
    items.sort((a, b) => when(b).localeCompare(when(a)));
    const firm = catalog.get(firmKey);
    const name = firm?.name ?? items[0]!.firmName;
    const scorecard = scorePartner(items, input.engagements);
    const record = partnerRecord(items);
    const dates = items.map(when).sort();
    partners.push({
      firmKey,
      name,
      monogram: firmMonogram(name),
      website: firm?.domains[0] ? `https://www.${firm.domains[0]}` : null,
      relationships: byFrequency(items.map((e) => e.relationship).filter((r): r is PartnerRelationship => r !== null)),
      domains: byFrequency(items.flatMap((e) => e.domains) as PartnerDomain[]),
      firstSeen: dates[0] ?? null,
      lastSeen: dates.at(-1) ?? null,
      strength: partnerStrength(items, input.now),
      publicCount: items.filter((e) => e.origin === 'public').length,
      internalCount: items.filter((e) => e.origin === 'internal').length,
      record,
      scorecard,
      angles: partnerAngles(name, input.clientName, items, scorecard, record),
      timeline: items.slice(0, MAX_TIMELINE).map((e) => ({
        id: e.id,
        date: when(e),
        origin: e.origin,
        source: e.source,
        label: (e.title ?? e.excerpt).slice(0, 120),
      })),
      sample: items.some((e) => e.sample),
    });
  }
  partners.sort((a, b) => b.strength.score - a.strength.score || a.name.localeCompare(b.name));
  const shown = partners.slice(0, MAX_PARTNERS);
  return { companyId: input.companyId, partners: shown, run: input.run, sample: shown.some((p) => p.sample) };
}
