// Pure view helpers over a BidFact. No React, no i18n — so the rules that
// decide "is this disagreement or is this just weak evidence" are unit-testable
// on their own, and the components stay dumb.

import type { useTranslation } from 'react-i18next';

import type { BidFact, BidFactCitation } from '@/hooks/agent/useBidFacts';

/** i18next's `t`, as handed out by `useTranslation`. Type-only — no runtime dep. */
export type Translate = ReturnType<typeof useTranslation>['t'];

/**
 * A held fact is one the agent REFUSED to average: two sources disagree, so
 * `scoreEvidence` clamps the score to CONTRADICTED (0.45) and writes a rationale
 * that opens with "Held:" (apps/worker/src/agent/evidence.ts:136-215).
 *
 * WHY the rationale prefix and not a flag: `BidFact` has no `contradicted`
 * column and the list endpoint exposes none, so the rationale IS the only
 * transported signal. Band alone cannot carry it — POSSIBLE also means "weak
 * but consistent evidence", and the whole point of the amber treatment is that
 * disagreement must NOT look like low confidence. The confidence clamp is
 * checked as a second, corroborating signal so a rationale that merely starts
 * with the English word "held" in some other sense cannot promote a 0.9-score
 * fact into the amber band.
 *
 * KNOWN GAP (Round 3): add `contradicted Boolean` to BidFact and read it here;
 * the prefix test is a string sniff on worker-authored English, and a rationale
 * that is ever localised or reworded silently degrades this to "not held",
 * which fails SAFE (an amber row renders as an ordinary proposal) rather than
 * dangerous (a held row never renders as verified).
 */
export function isHeldFact(fact: Pick<BidFact, 'rationale' | 'confidenceBps'>): boolean {
  if (!fact.rationale) return false;
  if (!/^\s*held\b/i.test(fact.rationale)) return false;
  // CONTRADICTED = 0.45 → 4500 bps is the ceiling a clamped score can reach.
  return fact.confidenceBps === null || fact.confidenceBps <= 4500;
}

export type FactTone = 'held' | 'verified' | 'probable' | 'possible' | 'unknown';

/** The single visual verb for a fact. `held` outranks every band. */
export function factTone(fact: Pick<BidFact, 'rationale' | 'confidenceBps' | 'band'>): FactTone {
  if (isHeldFact(fact)) return 'held';
  if (fact.band === 'VERIFIED') return 'verified';
  if (fact.band === 'PROBABLE') return 'probable';
  if (fact.band === 'POSSIBLE') return 'possible';
  return 'unknown';
}

/**
 * Page range as one printable token: "14", "14–16", or null when the extractor
 * had no page anchor. Null must render as nothing — never "p. 0", never "p. —".
 */
export function pageRange(citation: Pick<BidFactCitation, 'pageStart' | 'pageEnd'>): string | null {
  const { pageStart, pageEnd } = citation;
  if (pageStart === null && pageEnd === null) return null;
  if (pageStart !== null && pageEnd !== null && pageEnd !== pageStart) {
    return `${pageStart}–${pageEnd}`;
  }
  return String(pageStart ?? pageEnd);
}

/** Percent for display. Null confidence stays null — never rendered as 0%. */
export function confidencePct(confidenceBps: number | null): number | null {
  return confidenceBps === null ? null : Math.round(confidenceBps / 100);
}

/**
 * The rationale with the worker's "Held:" prefix removed, because the amber
 * chip beside it already says "Held" — printing both reads as a stutter. Any
 * other rationale is returned untouched.
 */
export function rationaleDetail(fact: Pick<BidFact, 'rationale' | 'confidenceBps'>): string | null {
  if (!fact.rationale) return null;
  if (!isHeldFact(fact)) return fact.rationale;
  return fact.rationale.replace(/^\s*held\s*[::]\s*/i, '').trim() || null;
}

/** Newest first. The ledger is append-only, so createdAt is a total order. */
export function newestFirst(facts: readonly BidFact[]): BidFact[] {
  return [...facts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The strip's one-line rationale: "filled from Meridian delivery model, p. 14 —
 * the bid library states this directly". Provenance first (it explains the
 * trust), then the worker's reasoning (it explains the verdict). A held fact
 * appends the note that the disagreement was NOT averaged away — the part a
 * reviewer would otherwise assume happened.
 */
export function rationaleLineFor(fact: BidFact, t: Translate): string | null {
  const parts: string[] = [];

  const source = fact.citations[0];
  if (source?.documentName) {
    const pages = pageRange(source);
    parts.push(
      pages
        ? t('agent.filledFromPage', 'filled from {{document}}, p. {{pages}}', {
            document: source.documentName,
            pages,
          })
        : t('agent.filledFrom', 'filled from {{document}}', { document: source.documentName }),
    );
  }

  const detail = rationaleDetail(fact);
  if (detail) parts.push(detail);

  if (isHeldFact(fact)) {
    parts.push(t('agent.heldNote', 'not averaged — resolve the disagreement first'));
  }

  return parts.length > 0 ? parts.join(' — ') : null;
}
