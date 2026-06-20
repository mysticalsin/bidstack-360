// Document library categorization.
//
// Classifies a document into a library category from its filename so MSAs, rate
// cards, win/loss debriefs, RFPs, and proposals are organized automatically —
// no schema column required (computed at read time). Deterministic + pure, so it
// is unit-tested and can run client- or server-side. A later phase can persist
// an authoritative, user-overridable category; this is the zero-migration start.

export const DOCUMENT_CATEGORIES = [
  'msa',
  'rate_card',
  'proposal',
  'rfp',
  'win_loss',
  'nda',
  'reference',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

// Order matters: specific patterns (MSA, rate card, NDA) are tested before
// generic ones (proposal) so a "Master Service Agreement" is never mis-tagged.
const CATEGORY_PATTERNS: Array<{ category: DocumentCategory; test: RegExp }> = [
  { category: 'msa', test: /\b(msa|master\s*service|framework\s*agreement)\b/i },
  {
    category: 'rate_card',
    test: /\b(rate[\s_-]?card|price[\s_-]?list|day\s*rate|tariff|pricing\s*(sheet|workbook))\b/i,
  },
  { category: 'nda', test: /\b(nda|non[\s_-]?disclosure|confidentiality)\b/i },
  {
    category: 'win_loss',
    test: /\b(win[\s_-]?loss|winloss|debrief|award\s*(notification|letter)|outcome\s*(note|letter|report))\b/i,
  },
  { category: 'rfp', test: /\b(rfp|rfi|rfq|itt|tender|invitation\s*to\s*tender)\b/i },
  { category: 'proposal', test: /\b(proposal|sow|statement\s*of\s*work|bid\s*response)\b/i },
];

/**
 * Classify a document by filename into a library category. `contentType` is
 * accepted for future weighting but filename is the reliable signal today.
 * Returns 'other' when nothing matches.
 */
export function classifyDocument(name: string, _contentType?: string): DocumentCategory {
  const haystack = name.toLowerCase();
  for (const { category, test } of CATEGORY_PATTERNS) {
    if (test.test(haystack)) return category;
  }
  return 'other';
}

// Default English labels — UI should prefer i18n keys (documentCategory.<key>)
// and fall back to these.
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  msa: 'MSA',
  rate_card: 'Rate card',
  proposal: 'Proposal',
  rfp: 'RFP / Tender',
  win_loss: 'Win / Loss',
  nda: 'NDA',
  reference: 'Reference',
  other: 'Other',
};
