// Relevance scoring for global search. Pure + deterministic so it can be unit
// tested independently of the DB. The old scorer only matched the WHOLE query
// as one substring, so a multi-term query like "acme paris" scored 0 unless that
// exact phrase appeared. This tokenizes the query and scores per-term coverage
// across weighted fields, with a whole-phrase bonus and a word-start boost, so
// the most relevant record surfaces first.

/** Lowercase, split on whitespace, de-duplicate, drop empties. */
export function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
    ),
  );
}

export interface ScoredField {
  text: string | null | undefined;
  /** Relative importance of this field (e.g. a name weighs more than an email). */
  weight: number;
}

const WHOLE_EXACT = 100;
const WHOLE_PREFIX = 60;
const WHOLE_SUBSTRING = 35;
const TOKEN_WORD_START = 12;
const TOKEN_MID_WORD = 6;

/**
 * Relevance score for `query` against a record's weighted fields. Higher is more
 * relevant. Returns 0 when no token matches any field.
 */
export function scoreMatch(query: string, fields: ScoredField[]): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;

  const lowerQ = query.trim().toLowerCase();
  const present = fields
    .map((f) => ({ text: (f.text ?? '').toLowerCase(), weight: f.weight }))
    .filter((f) => f.text.length > 0);
  if (present.length === 0) return 0;

  let score = 0;

  // Whole-phrase bonus: take the single best field the full query appears in.
  let phraseBonus = 0;
  for (const f of present) {
    let tier = 0;
    if (f.text === lowerQ) tier = WHOLE_EXACT;
    else if (f.text.startsWith(lowerQ)) tier = WHOLE_PREFIX;
    else if (f.text.includes(lowerQ)) tier = WHOLE_SUBSTRING;
    phraseBonus = Math.max(phraseBonus, tier * f.weight);
  }
  score += phraseBonus;

  // Per-token coverage: each token contributes its best weighted field match,
  // boosted when it lands at a word boundary (a real prefix, not mid-word noise).
  for (const tok of tokens) {
    let best = 0;
    for (const f of present) {
      const idx = f.text.indexOf(tok);
      if (idx < 0) continue;
      const atWordStart = idx === 0 || /\W/.test(f.text.charAt(idx - 1));
      const tokScore = (atWordStart ? TOKEN_WORD_START : TOKEN_MID_WORD) * f.weight;
      if (tokScore > best) best = tokScore;
    }
    score += best;
  }

  return Math.round(score);
}
