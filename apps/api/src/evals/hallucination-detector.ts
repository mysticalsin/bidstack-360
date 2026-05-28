/**
 * Phantom-metric hallucination detector for RFP section drafts.
 *
 * WHY: The rfp-section-draft worker calls Dust to generate proposal sections
 * grounded in matched success story context. A "phantom metric" is any
 * specific number, percentage, or dollar amount in the draft that does NOT
 * appear in the source story context — indicating the LLM fabricated it.
 *
 * Design:
 * - Extracts all "specific metrics" from the draft (regex-based)
 * - Checks each against the source context (normalised whitespace comparison)
 * - Returns a report with phantomRate: 0-1 (0 = no phantoms)
 *
 * Excluded from phantom detection (allow-listed as non-hallucinations):
 * - Round percentages: 100%, 0% — universal claims
 * - Generic ordinals: 1st, 2nd — ranking words
 * - Pure years: 2020-2030 — used for date ranges, common knowledge
 * - Single-digit integers: 1-9 — too common to flag
 */

export interface HallucinationReport {
  /** All specific metrics found in the draft. */
  allMetrics: string[];
  /** Metrics present in the draft but absent from the source story context. */
  phantomMetrics: string[];
  /** Metrics that appear in both draft and source context. */
  groundedMetrics: string[];
  /** phantomMetrics.length / allMetrics.length; 0 when allMetrics is empty. */
  phantomRate: number;
}

/**
 * Normalise a string for comparison: collapse whitespace, lowercase, strip
 * commas and hyphens (so "22-month" matches "22 months" in source context).
 */
function normalise(s: string): string {
  return s.replace(/,/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

/** Patterns for "specific" metrics that should be grounded in source context. */
const METRIC_PATTERNS: RegExp[] = [
  // Currency amounts: $2.3M, €450K, $1,200,000
  /(?:[€$£])\s*[\d,]+(?:\.\d+)?(?:\s*[BKMG])?/gi,
  // Percentages with decimals: 34.7%, 12.5% — NOT round numbers
  /\b\d+\.\d+%/g,
  // Round percentages 10-99% (not 100% which is a universal claim)
  /\b(?:1[0-9]|[2-9]\d)%/g,
  // Large numbers with commas: 1,200 / 45,000
  /\b\d{1,3}(?:,\d{3})+\b/g,
  // Duration specifics: "18 months", "6-week" (not single digits alone)
  /\b(?:1[0-9]|[2-9]\d)\s*-?\s*(?:month|week|day|year)s?\b/gi,
  // Named version numbers or scores: v2.3, 9.2/10
  /\bv\d+\.\d+\b|\b\d+\.\d+\/\d+\b/g,
];

/** Allow-list patterns — match these and skip phantom detection. */
const ALLOWLIST: RegExp[] = [
  /^100%$/, // universal "all"
  /^0%$/, // universal "none"
  /^\d[a-z]{2}$/, // ordinals: 1st, 2nd
  /^20[12]\d$/, // years 2010-2029 (common knowledge)
  /^\d$/, // single digits
];

function isAllowListed(metric: string): boolean {
  const m = normalise(metric).trim();
  return ALLOWLIST.some((re) => re.test(m));
}

/**
 * Detect phantom metrics in an AI-generated draft.
 *
 * @param draft The AI-generated proposal section text.
 * @param sourceContext The story context injected into the draft prompt.
 */
export function detectPhantomMetrics(draft: string, sourceContext: string): HallucinationReport {
  const normSource = normalise(sourceContext);

  // Collect all metric matches across all patterns; deduplicate.
  const rawMatches = new Set<string>();
  for (const pattern of METRIC_PATTERNS) {
    for (const m of draft.matchAll(pattern)) {
      rawMatches.add(m[0].trim());
    }
  }

  const allMetrics: string[] = [];
  const phantomMetrics: string[] = [];
  const groundedMetrics: string[] = [];

  for (const raw of rawMatches) {
    if (isAllowListed(raw)) continue;

    allMetrics.push(raw);

    // Strip currency symbols and commas for fuzzy source match.
    const normalised = normalise(raw).replace(/[€$£]/g, '').trim();
    const foundInSource = normSource.includes(normalised);

    if (foundInSource) {
      groundedMetrics.push(raw);
    } else {
      phantomMetrics.push(raw);
    }
  }

  const phantomRate = allMetrics.length === 0 ? 0 : phantomMetrics.length / allMetrics.length;

  return { allMetrics, phantomMetrics, groundedMetrics, phantomRate };
}
