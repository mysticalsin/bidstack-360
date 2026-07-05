/**
 * paletteFuzzy — pure fuzzy-match scorer for the command palette.
 *
 * Model: a query matches when its characters appear in order AND every
 * matched character is either (a) anchored on a word/camelCase boundary or
 * (b) the immediate continuation of the previous matched character — plus a
 * whole-query substring fallback for mid-word fragments ("ritz" → A"ritz"ia).
 *
 * WHY not accept any scattered subsequence (fzf-style): on short queries a
 * loose subsequence matches absurd rows ("ari" → "Go to Bid/No-Bid Matrix"
 * via M-a-t-r-i-x) which makes the palette feel random. Anchored-or-
 * contiguous keeps acronym matches ("gtd" → "Go to Dashboard") and camelCase
 * jumps while rejecting noise — and keeps every ranked row explainable via
 * the character highlight fed by `indices`.
 *
 * No dependencies, no DOM — safe for tests and future server reuse.
 */

export interface FuzzyMatch {
  /** Relative relevance — only meaningful for comparing candidates against
   *  the SAME query; never display it or persist it. */
  score: number;
  /** Positions in `text` of each matched query character, ascending —
   *  drives match highlighting in CommandPalette. */
  indices: number[];
}

// Guard rails: palette labels are short. Bail out rather than burn CPU on
// pathological inputs — the matcher runs per keystroke over every candidate.
const MAX_QUERY = 64;
const MAX_TEXT = 200;

const SCORE_CHAR = 4; // every matched character
const BONUS_TEXT_START = 10; // match at index 0 (prefix match)
const BONUS_WORD_START = 8; // match after a separator — "word boundary beats mid-word"
const BONUS_CAMEL = 6; // match at a lower→upper camelCase transition
const BONUS_CONSECUTIVE = 6; // match immediately continuing the previous one
const BONUS_EXACT = 24; // query equals the whole text
const MAX_GAP_PENALTY = 6; // skipped-char cost is capped so long labels can still acronym-match

const SEPARATOR = /[^0-9A-Za-z]/;

/** Boundary bonus for placing a match at `text[i]` (0 = not a boundary). */
function boundaryBonus(text: string, i: number): number {
  if (i === 0) return BONUS_TEXT_START;
  const prev = text.charAt(i - 1);
  if (SEPARATOR.test(prev)) return BONUS_WORD_START;
  const cur = text.charAt(i);
  if (prev >= 'a' && prev <= 'z' && cur >= 'A' && cur <= 'Z') return BONUS_CAMEL;
  return 0;
}

/**
 * Score `query` against `text`. Returns null when the query does not match
 * under the anchored-or-contiguous model (see module doc). Case-insensitive.
 *
 * Implementation: row-by-row DP over (query char, text position) with parent
 * pointers for highlight reconstruction. Gap penalties are capped, so each
 * row costs O(m · MAX_GAP_PENALTY) via a running far-window max.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  const n = q.length;
  const m = t.length;
  if (n === 0 || n > m || n > MAX_QUERY || m > MAX_TEXT) return null;

  const NEG = Number.NEGATIVE_INFINITY;
  const bonus: number[] = new Array<number>(m);
  for (let i = 0; i < m; i++) bonus[i] = boundaryBonus(text, i);

  // Row 0: the first query char may only sit on a boundary — mid-word starts
  // are handled by the substring fallback below.
  let prev: number[] = new Array<number>(m).fill(NEG);
  const parents: Int32Array[] = [new Int32Array(m).fill(-1)];
  const q0 = q.charAt(0);
  for (let i = 0; i < m; i++) {
    const b = bonus[i] ?? 0;
    if (t.charAt(i) === q0 && b > 0) prev[i] = SCORE_CHAR + b;
  }

  for (let k = 1; k < n; k++) {
    const cur: number[] = new Array<number>(m).fill(NEG);
    const par = new Int32Array(m).fill(-1);
    const qc = q.charAt(k);
    // Running max over prev-row cells far enough back that their gap penalty
    // has hit the cap — keeps the transition scan bounded.
    let farBest = NEG;
    let farBestIdx = -1;
    for (let i = 0; i < m; i++) {
      const farJ = i - 1 - MAX_GAP_PENALTY;
      if (farJ >= 0 && (prev[farJ] ?? NEG) > farBest) {
        farBest = prev[farJ] ?? NEG;
        farBestIdx = farJ;
      }
      if (t.charAt(i) !== qc) continue;
      const b = bonus[i] ?? 0;
      let best = NEG;
      let from = -1;
      // Contiguous continuation — allowed anywhere, even mid-word.
      const contiguous = i > 0 ? (prev[i - 1] ?? NEG) : NEG;
      if (contiguous > NEG) {
        best = contiguous + BONUS_CONSECUTIVE;
        from = i - 1;
      }
      // Word-anchored placement — may jump a gap (penalized, capped).
      if (b > 0) {
        for (let j = Math.max(0, i - MAX_GAP_PENALTY); j <= i - 2; j++) {
          const s = (prev[j] ?? NEG) - (i - j - 1);
          if (s > best) {
            best = s;
            from = j;
          }
        }
        const s = farBest - MAX_GAP_PENALTY;
        if (s > best) {
          best = s;
          from = farBestIdx;
        }
      }
      if (best > NEG) {
        cur[i] = best + SCORE_CHAR + b;
        par[i] = from;
      }
    }
    parents.push(par);
    prev = cur;
  }

  let result: FuzzyMatch | null = null;
  let bestScore = NEG;
  let bestEnd = -1;
  for (let i = 0; i < m; i++) {
    const s = prev[i] ?? NEG;
    if (s > bestScore) {
      bestScore = s;
      bestEnd = i;
    }
  }
  if (bestEnd >= 0) {
    const indices = new Array<number>(n);
    let at = bestEnd;
    for (let k = n - 1; k > 0; k--) {
      indices[k] = at;
      at = parents[k]?.[at] ?? -1;
    }
    indices[0] = at;
    result = { score: bestScore, indices };
  }

  // Whole-query substring fallback: accepts the mid-word fragments the
  // anchored pass rejects, at a score a boundary-anchored match of the same
  // length always beats (no boundary bonus on the first char).
  let from = t.indexOf(q);
  while (from !== -1) {
    let score = 0;
    for (let k = 0; k < n; k++) {
      score += SCORE_CHAR + (k === 0 ? (bonus[from] ?? 0) : BONUS_CONSECUTIVE + (bonus[from + k] ?? 0));
    }
    if (!result || score > result.score) {
      result = { score, indices: Array.from({ length: n }, (_, k) => from + k) };
    }
    from = t.indexOf(q, from + 1);
  }

  if (result && q === t) result.score += BONUS_EXACT;
  return result;
}
