/**
 * Rules that read partner evidence (slice 15): relationship type and domain
 * for public items; context, remarks and sentiment for our own records.
 *
 * Everything here is deterministic. A remark is only produced when the
 * sentence names the firm, names a dimension (quality, price, speed, domain)
 * and carries a polarity word; who it favours follows the grammatical
 * subject ("we were faster than KPMG" favours us, "KPMG was cheaper"
 * favours KPMG, "KPMG was slow" favours us).
 */
import { matchFirms, type ConsultingFirm, type FirmMention } from './firms.js';
import type {
  PartnerContext,
  PartnerDomain,
  PartnerRelationship,
  PartnerRemark,
  PartnerSentiment,
  RemarkDimension,
} from './types.js';

const RELATIONSHIP_RULES: Array<[PartnerRelationship, RegExp]> = [
  ['audit', /\b(audit(?:or|ors|ed|ing|s)?|statutory audit|assurance)\b/i],
  ['strategic_partner', /\b(strategic (?:partner|partnership|alliance)|alliance partner|joint venture)\b/i],
  ['managed_services', /\b(managed services?|outsourc\w*|application management|run and maintain|service desk|operations? contract)\b/i],
  ['engineering', /\b(engineering services?|R&D services|product engineering|embedded software|testing and validation|design services|engineering partner)\b/i],
  ['implementation', /\b(implement\w*|deploy\w*|roll[- ]?out|migrat\w*|system integrat\w*|go[- ]live|selects?|selected|chooses|chose|chosen|appoint\w*|awarded|contract (?:with|to))\b/i],
  ['advisory', /\b(advis\w*|consult\w*|strategy|transformation|due diligence|tax)\b/i],
  ['strategic_partner', /\b(partner(?:s|ship|ed|ing)?|alliance|teams? up|collaborat\w*)\b/i],
];

/** First matching relationship rule, or null. */
export function classifyRelationship(text: string): PartnerRelationship | null {
  for (const [kind, re] of RELATIONSHIP_RULES) if (re.test(text)) return kind;
  return null;
}

const DOMAIN_RULES: Array<[PartnerDomain, RegExp]> = [
  ['sap', /\bSAP\b|S\/4\s?HANA|SuccessFactors|\bAriba\b/],
  ['cloud', /\bcloud\b|\bAzure\b|\bAWS\b|Amazon Web Services|Google Cloud|landing zone/i],
  ['data', /\bdata\b|analytics|artificial intelligence|machine learning|Databricks|Snowflake/i],
  ['data', /\bAI\b|\bGenAI\b/],
  ['cyber', /cyber|security operations|\bSOC\b|identity and access|zero trust/i],
  ['digital', /\bdigital\b|e-?commerce|customer experience|mobile app|omnichannel/i],
  ['engineering', /\bengineering\b|\bR&D\b|embedded|powertrain|thermal|e-mobility|vehicle|manufacturing|\bPLM\b/i],
  ['hema_pharma', /pharma|clinical|life sciences|regulatory affairs|\bGxP\b|\bdrugs?\b|biotech|medical device|healthcare/i],
  ['it', /\bIT\b|\bERP\b|infrastructure|\bapplications?\b|service desk|technology/],
];

/** Every domain the text speaks to, in a stable order. */
export function classifyDomains(text: string): PartnerDomain[] {
  const out: PartnerDomain[] = [];
  for (const [d, re] of DOMAIN_RULES) if (!out.includes(d) && re.test(text)) out.push(d);
  return out;
}

const CONTEXT_RULES: Array<[PartnerContext, RegExp]> = [
  ['incumbent', /\b(incumbent|currently (?:runs|delivers|supports|provides|holds)|existing (?:supplier|provider|vendor|partner)|holds the contract|in place)\b/i],
  ['competing', /\b(compet\w*|shortlist\w*|bid(?:ding)? against|up against|rival|also bidding|lost to|won against|beat|tender|RFP)\b/i],
  ['client_feedback', /\b(feedback|(?:client|customer|they|she|he) (?:said|says|told|mentioned|felt|complained|praised|noted))\b/i],
];

/** Role of the firm in an internal record. */
export function classifyContext(text: string): PartnerContext {
  for (const [c, re] of CONTEXT_RULES) if (re.test(text)) return c;
  return 'mention';
}

/** Sentences of `text` (split on end punctuation, semicolons and line breaks). */
export function splitPartnerSentences(text: string): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const re = /[^.!?;\n]+[.!?;]?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const t = m[0];
    const lead = t.length - t.trimStart().length;
    const trimmed = t.trim();
    if (trimmed) out.push({ text: trimmed, start: m.index + lead });
  }
  return out;
}

const DIMENSION_RE: Record<RemarkDimension, RegExp> = {
  quality: /\b(quality|rework|defects?|reliab\w*|delivery|deliverables?)\b/i,
  price: /\b(prices?|priced|pricing|costs?|cheap\w*|expensive|pricier|rates?|budget|fees?|commercials?)\b/i,
  speed: /\b(speed|fast\w*|slow\w*|quick\w*|delays?|delayed|late|on time|timeline|turnaround|mobili[sz]\w*|ramp[- ]up)\b/i,
  domain: /\b(expertise|domain|know[- ]how|speciali[sz]\w*|depth|experience|sector knowledge|niche)\b/i,
};

const GENERIC_POS = 'beat|beats|outperform\\w*|outbid|edged out|won on|preferred|praised';
const GENERIC_NEG = 'lost on|lost to|fell short';

const POLARITY: Record<RemarkDimension, { pos: string; neg: string }> = {
  quality: {
    pos: `high(?:er)? quality|better|excellent|great|strong(?:er)?|solid|praised|impressed|reliable|best|good|${GENERIC_POS}`,
    neg: `low(?:er)? quality|worse|poor(?:er)?|weak(?:er)?|lack(?:ed|ing)|struggl\\w*|disappoint\\w*|complain\\w*|issues|problems|rework|defects|${GENERIC_NEG}`,
  },
  price: {
    pos: `cheaper|lower (?:price|prices|cost|costs|rates?|fees?)|less expensive|competitive(?:ly)? pric\\w*|better (?:price|pricing|rates?)|undercut\\w*|value for money|${GENERIC_POS}`,
    neg: `more expensive|pricier|too expensive|expensive|higher (?:price|prices|cost|costs|rates?|fees?)|overpriced|costly|${GENERIC_NEG}`,
  },
  speed: {
    pos: `faster|quicker|quickly|quick|fast|on time|ahead of schedule|rapid\\w*|${GENERIC_POS}`,
    neg: `slower|slow|late|delays?|delayed|behind schedule|took longer|${GENERIC_NEG}`,
  },
  domain: {
    pos: `deeper|deep|stronger|strong|better|more experience|specialists?|experts?|${GENERIC_POS}`,
    neg: `shallow|lack(?:ed|ing)|weaker|weak|less experience|generalists?|no experience|${GENERIC_NEG}`,
  },
};

const PARITY = /\b(same|similar|comparable|on par|as good as|matched|level with)\b/i;
const US_RE = /(?<![\p{L}\p{N}])(we|We|our|Our|us|ours|Mantu|Amaris|our team)(?![\p{L}\p{N}])/gu;

interface Hit {
  at: number;
  sign: 1 | -1;
  phrase: string;
}

function polarityHits(sentence: string, dim: RemarkDimension): Hit[] {
  const hits: Hit[] = [];
  let masked = sentence;
  const pos = new RegExp(`(?<![\\p{L}])(?:${POLARITY[dim].pos})(?![\\p{L}])`, 'giu');
  for (let m = pos.exec(sentence); m; m = pos.exec(sentence)) {
    hits.push({ at: m.index, sign: 1, phrase: m[0] });
    masked = masked.slice(0, m.index) + ' '.repeat(m[0].length) + masked.slice(m.index + m[0].length);
  }
  const neg = new RegExp(`(?<![\\p{L}])(?:${POLARITY[dim].neg})(?![\\p{L}])`, 'giu');
  for (let m = neg.exec(masked); m; m = neg.exec(masked)) hits.push({ at: m.index, sign: -1, phrase: m[0] });
  return hits.sort((a, b) => a.at - b.at);
}

function usPositions(sentence: string): number[] {
  const out: number[] = [];
  US_RE.lastIndex = 0;
  for (let m = US_RE.exec(sentence); m; m = US_RE.exec(sentence)) out.push(m.index);
  return out;
}

/** Who a polarity word in the sentence is about: us, this firm, or someone else. */
function subjectOf(sentence: string, at: number, firmKey: string, mentions: FirmMention[], us: number[]): 'us' | 'firm' | 'other' {
  const lower = sentence.toLowerCase();
  const than = lower.indexOf(' than ');
  if (than >= 0) {
    const after = than + 6;
    const target = mentions.find((m) => m.start >= after && m.start <= after + 5);
    if (target) return target.firmKey === firmKey ? 'us' : 'other';
    if (us.some((u) => u >= after && u <= after + 5)) {
      const firmBefore = mentions.filter((m) => m.start < than).at(-1);
      return firmBefore?.firmKey === firmKey ? 'firm' : 'other';
    }
  }
  const before: Array<{ at: number; who: 'us' | 'firm' | 'other' }> = [
    ...mentions.filter((m) => m.start < at).map((m) => ({ at: m.start, who: (m.firmKey === firmKey ? 'firm' : 'other') as 'firm' | 'other' })),
    ...us.filter((u) => u < at).map((u) => ({ at: u, who: 'us' as const })),
  ].sort((a, b) => b.at - a.at);
  if (before[0]) return before[0].who;
  return mentions.some((m) => m.firmKey === firmKey) ? 'firm' : 'other';
}

/** Quality, price, speed and domain remarks about `firmKey` in `text`. */
export function extractRemarks(text: string, firmKey: string, firms: readonly ConsultingFirm[]): PartnerRemark[] {
  const out: PartnerRemark[] = [];
  for (const s of splitPartnerSentences(text)) {
    const mentions = matchFirms(s.text, firms);
    if (!mentions.some((m) => m.firmKey === firmKey)) continue;
    const us = usPositions(s.text);
    for (const dim of Object.keys(DIMENSION_RE) as RemarkDimension[]) {
      if (!DIMENSION_RE[dim].test(s.text)) continue;
      const hits = polarityHits(s.text, dim);
      if (!hits.length) {
        if (PARITY.test(s.text)) out.push({ dimension: dim, favours: 'neutral', phrase: s.text.slice(0, 200) });
        continue;
      }
      const score = { us: 0, partner: 0 };
      for (const h of hits) {
        const who = subjectOf(s.text, h.at, firmKey, mentions, us);
        if (who === 'other') continue;
        const favoursUs = (who === 'us') === (h.sign === 1);
        score[favoursUs ? 'us' : 'partner']++;
      }
      if (score.us === score.partner) continue;
      out.push({ dimension: dim, favours: score.us > score.partner ? 'us' : 'partner', phrase: s.text.slice(0, 200) });
    }
  }
  return out;
}

/** Tone towards the partner, from its remarks. */
export function sentimentFromRemarks(remarks: PartnerRemark[]): PartnerSentiment {
  let n = 0;
  for (const r of remarks) n += r.favours === 'partner' ? 1 : r.favours === 'us' ? -1 : 0;
  return n > 0 ? 'positive' : n < 0 ? 'negative' : 'neutral';
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

/** Text with email addresses and phone numbers removed. Excerpts never carry contact details. */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL_RE, '[email removed]').replace(PHONE_RE, '[phone removed]');
}

/** The sentences around each mention of `firmKey`, at most `max` characters, contact details removed. */
export function partnerExcerpt(text: string, firmKey: string, firms: readonly ConsultingFirm[], max = 300): string {
  const picked = splitPartnerSentences(text).filter((s) => matchFirms(s.text, firms).some((m) => m.firmKey === firmKey));
  const joined = redactContactDetails((picked.length ? picked.map((s) => s.text) : [text]).join(' ')).replace(/\s+/g, ' ').trim();
  return joined.length > max ? `${joined.slice(0, max - 1).trimEnd()}\u2026` : joined;
}

/** One firm read out of one internal record. */
export interface PartnerMentionRead {
  firmKey: string;
  excerpt: string;
  context: PartnerContext;
  sentiment: PartnerSentiment;
  remarks: PartnerRemark[];
  domains: PartnerDomain[];
}

/** Every firm in an internal record with context, sentiment, remarks and domains. */
export function readPartnerMentions(text: string, firms: readonly ConsultingFirm[]): PartnerMentionRead[] {
  const keys = [...new Set(matchFirms(text, firms).map((m) => m.firmKey))];
  return keys.map((firmKey) => {
    const excerpt = partnerExcerpt(text, firmKey, firms);
    const remarks = extractRemarks(text, firmKey, firms);
    return {
      firmKey,
      excerpt,
      context: classifyContext(excerpt),
      sentiment: sentimentFromRemarks(remarks),
      remarks,
      domains: classifyDomains(excerpt),
    };
  });
}
