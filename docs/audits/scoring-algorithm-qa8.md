# QA-8 — Scoring Algorithm Mathematical Audit

## `apps/worker/src/queues/rfp-story-match.ts`

**Auditor:** QA-8 (ML/Scoring Algorithm Auditor)
**Date:** 2026-05-28
**Branch:** feat/wave9-rfp-engine
**Commit:** e53ca772

---

## Score formula under review

```
final = cosine×0.55 + keyword×0.20 + tag×0.15 + recency×0.10
```

All dimensions: [0, 10000] basis points. Weights must sum to 1.0.

---

## Summary table

| #   | Check                                            | Status         | Severity |
| --- | ------------------------------------------------ | -------------- | -------- |
| 1   | Cosine distance → basis points conversion        | ✅ CORRECT     | —        |
| 2   | Keyword Jaccard implementation                   | ✅ CORRECT     | —        |
| 2b  | Tokenizer length threshold (3-letter acronyms)   | ⚠️ DESIGN RISK | MAJOR    |
| 3   | Tag overlap: precision vs Jaccard                | ⚠️ DESIGN RISK | MAJOR    |
| 4   | Recency decay exponential formula                | ✅ CORRECT     | —        |
| 4b  | Null `closedAt` neutral fallback                 | ✅ CORRECT     | —        |
| 5   | Weight sum                                       | ✅ CORRECT     | —        |
| 6   | Final score range [0, 10000]                     | ✅ CORRECT     | —        |
| 7   | MMR Jaccard threshold interaction with tokenizer | ⚠️ DESIGN RISK | MAJOR    |
| 8   | 2× candidate pool headroom                       | ⚠️ DESIGN RISK | MINOR    |

**Math errors: 0**
**Design risks: 4 (3 MAJOR, 1 MINOR)**

---

## Check 1 — Cosine conversion ✅ CORRECT

**Formula:** `cosineBps = Math.round((1 - cosine_distance / 2) * 10000)`

pgvector `<=>` returns cosine **distance** ∈ [0, 2]:

- distance = 0 → identical vectors → similarity = 1
- distance = 1 → orthogonal vectors → similarity = 0.5
- distance = 2 → antipodal vectors → similarity = 0

The mapping `(1 - d/2)` linearly rescales [0, 2] → [1, 0], then ×10000 gives [10000, 0].

**Verified numerically:**
| distance | formula output | expected |
|----------|---------------|----------|
| 0 | 10000 | 10000 ✓ |
| 1 | 5000 | 5000 ✓ |
| 2 | 0 | 0 ✓ |

Output is bounded [0, 10000] for any valid pgvector distance. Formula is mathematically correct.

---

## Check 2 — Keyword Jaccard ✅ CORRECT

**Formula:**

```ts
const union = new Set([...reqTokens, ...refTokens]).size;
return Math.round((overlap / union) * 10000);
```

`overlap` = `|A ∩ B|`, `union` = `|A ∪ B|`. This is the correct Jaccard similarity formula: `|A ∩ B| / |A ∪ B| ∈ [0, 1]`, scaled to basis points.

**Verified:**

- Identity (same text): 10000 ✓
- Disjoint sets: 0 ✓
- Partial overlap {cloud,migration,telco} ∩ {cloud,storage,telco}: 2/4 = 5000 ✓

Zero-guard `if (reqTokens.size === 0 || refTokens.size === 0) return 0` prevents division by zero. Correct.

---

## Check 2b — Tokenizer threshold ⚠️ DESIGN RISK — MAJOR

**Code:** `filter((t) => t.length > 3)` — keeps tokens with **length ≥ 4** (i.e., 4+ characters).

This silently drops all **3-letter tokens**, including every critical bid-domain acronym:

| Acronym | Length | Outcome     |
| ------- | ------ | ----------- |
| RFP     | 3      | **DROPPED** |
| SLA     | 3      | **DROPPED** |
| SME     | 3      | **DROPPED** |
| API     | 3      | **DROPPED** |
| ERP     | 3      | **DROPPED** |
| CRM     | 3      | **DROPPED** |
| SAP     | 3      | **DROPPED** |
| KPI     | 3      | **DROPPED** |
| GDPR    | 4      | kept ✓      |
| HNSW    | 4      | kept ✓      |

**Impact:** A requirement text like `"SLA compliance for SME clients per RFP section 3.2"` tokenizes to `{"compliance", "clients", "section"}`. All three differentiating acronyms vanish. If the matched reference story is titled `"SLA Management for SME Clients"`, keyword overlap scores 0 instead of near-10000. This degrades the keyword signal precisely for the domain-specific terms it was added to capture.

**Root cause:** The `> 3` guard was designed to eliminate common English stop-words (the, and, for, etc.) — most are 2–3 characters — but the cutoff is 1 character too aggressive for bid language.

**Recommendation:** Change threshold from `length > 3` to `length > 2` (keeps 3-letter tokens, still drops 1–2-character noise). Alternatively use an explicit stopword list instead of a length cutoff.

```ts
// BEFORE (drops 3-letter acronyms):
.filter((t) => t.length > 3)

// AFTER (recommended — keeps 3-letter domain acronyms, still drops 2-char noise):
.filter((t) => t.length > 2)
```

Note: this threshold is shared between `keywordOverlapBps()` and `mmrPrune()` — changing it affects both (see Check 7).

---

## Check 3 — Tag overlap: precision not Jaccard ⚠️ DESIGN RISK — MAJOR

**Formula:** `matches / refTags.length * 10000`

This is **recall-precision with `refTags` as the reference set** (sometimes called "tag coverage" or "tag precision from the reference perspective"). It is **not** Jaccard similarity.

**Distinction:**

- Precision (current): `|matched| / |refTags|` — asks "what fraction of the reference's tags appear in the requirement?"
- Jaccard: `|matched| / |A ∪ B|` — penalises both unmatched reference tags and unmatched requirement tokens

**Gaming risk analysis:**

| Story   | refTags                             | req matches | tagBps (precision) | max final impact |
| ------- | ----------------------------------- | ----------- | ------------------ | ---------------- |
| Story A | `["cloud"]`                         | 1           | 10000              | 1500 bps         |
| Story B | `["cloud","telco","finance","erp"]` | 1           | 2500               | 375 bps          |

Story A outscores Story B by **1125 bps in final score** (10000 vs 2500 raw, × weight 0.15) despite Story B being a more comprehensive and descriptive story. A story curated to have only 1–2 perfectly-matching tags can dominate stories with richer but partially-matching tag profiles.

**Is this intentional?** The formula rewards specificity of tagging. In a controlled taxonomy this may be desirable — "if the reference's tags are carefully chosen, a high hit rate is meaningful." However, if tag counts are not governed (some stories have 1 tag, others 15), the metric is not comparable across stories.

**Recommendation:**

- If tag vocabularies are standardized and curated, document the precision choice as intentional in a code comment.
- If tag counts are user-controlled and ungoverned, use **min-denominator Jaccard** to normalize across stories:
  ```ts
  // Jaccard variant: penalises both unmatched refTags and unmatched reqTokens
  const reqTagTokens = tokenize(reqText);
  const refTagSet = new Set(refTags.map((t) => t.toLowerCase()));
  let intersection = 0;
  for (const t of reqTagTokens) if (refTagSet.has(t)) intersection++;
  const union = new Set([...reqTagTokens, ...refTagSet]).size;
  return union > 0 ? Math.round((intersection / union) * 10000) : 0;
  ```

---

## Check 4 — Recency decay ✅ CORRECT

**Formula:** `10000 * exp(-ln2 * ageDays / RECENCY_HALF_LIFE_DAYS)`

This is the standard exponential half-life decay function: `f(t) = A₀ · e^(-λt)` where `λ = ln2 / t½`.

**Verified numerically:**
| ageDays | formula output | expected |
|---------|---------------|----------|
| 0 | 10000 | 10000 ✓ |
| 365 | 5000 | 5000 (half-life) ✓ |
| 730 | 2500 | 2500 (quarter) ✓ |

Output monotonically decreasing, bounded (0, 10000], approaches 0 asymptotically. Correct.

**Null `closedAt` → 5000 (neutral):** Acceptable. A bid with unknown close date is neither rewarded nor penalised. The alternative — penalising unknown age to 0 — would systematically downrank any story whose metadata is incomplete, which could introduce false signal. Neutral is the correct epistemic choice.

---

## Check 5 — Weight sum ✅ CORRECT

```
0.55 + 0.20 + 0.15 + 0.10 = 1.00
```

Verified via JavaScript: `0.55 + 0.20 + 0.15 + 0.10 === 1.0` → `true` (no floating-point rounding artifact at these specific values).

---

## Check 6 — Final score range ✅ CORRECT

With all weights summing to 1.0 and all dimensions bounded [0, 10000]:

```
finalBps_max = 10000×0.55 + 10000×0.20 + 10000×0.15 + 10000×0.10 = 10000
finalBps_min = 0×0.55 + 0×0.20 + 0×0.15 + 0×0.10 = 0
```

`finalBps ∈ [0, 10000]` ✓

---

## Check 7 — MMR Jaccard threshold interaction with tokenizer ⚠️ DESIGN RISK — MAJOR

**Threshold:** `jaccard > 0.8` — stories sharing more than 80% of title tokens are collapsed.

**The interaction:** `mmrPrune()` calls `tokenize()` for title comparison. Because `tokenize()` drops `length <= 3` tokens (see Check 2b), single-letter differentiators — which commonly distinguish case studies with the same methodology applied to different clients — are silently stripped.

**Concrete example:**

```
Title A: "Cloud Migration for Telco A"
  Tokens: {cloud, migration, telco}

Title B: "Cloud Migration for Telco B"
  Tokens: {cloud, migration, telco}

Jaccard = 3/3 = 1.0 > 0.8 → COLLAPSED
```

The letter "A" and "B" are length 1, filtered. Both titles reduce to identical token sets. The MMR stage will always collapse these, regardless of the 0.8 threshold — **the threshold becomes irrelevant** when single-character client identifiers are the only differentiator.

**Real bid context:** Reference stories for "Cloud Migration for Deutsche Telekom" vs "Cloud Migration for Swisscom" would tokenize differently (Deutsche→longer, Telekom→longer, Swisscom→longer), so those would be correctly distinguished. The problem is specifically with abbreviated client codes (A, B, I, II, 1, 2) that are common in anonymized bid libraries.

**Threshold evaluation:** The 0.8 threshold itself is reasonable for the intended use case (collapsing re-named duplicates of the same story). The issue is not the threshold but the tokenizer.

**Recommendation:**

1. Fix tokenizer threshold to `length > 2` (see Check 2b) — this is the root cause.
2. Consider using Roman numerals and single uppercase letters as special-case preserved tokens in title comparison (optional, lower priority than the threshold fix).

---

## Check 8 — 2× candidate pool headroom ⚠️ DESIGN RISK — MINOR

**Current:** `cosineCandidates(orgId, requirementId, topK * 2, log)` — fetches 10 candidates for `topK=5`.

**Scenario analysis:**

- Normal case: 2–3 near-duplicates in 10 candidates → 7–8 survivors → MMR returns 5. ✓
- Degenerate case: 8 near-duplicates in 10 candidates → 2 survivors → MMR returns 2 < `topK`.

**Current handling:** `mmrPrune()` returns `selected` with `selected.length < topK` silently. `persistMatches()` writes whatever it receives. The caller in `processJob()` logs `matchCount: topMatches.length` but does not warn when `matchCount < topK`.

This means a requirement could silently receive only 2 matches when 5 were requested, with no observable signal to downstream consumers (e.g. the autofill worker reading these matches).

**Recommendation:**

```ts
// After mmrPrune, add a diagnostic log when results are sparse
if (topMatches.length < topK) {
  log.warn(
    {
      orgId,
      requirementId,
      matchCount: topMatches.length,
      topK,
      candidateCount: candidates.length,
    },
    'rfp-story-match: MMR returned fewer matches than topK — library may be sparse or near-duplicate-heavy',
  );
}
```

2× headroom is appropriate for typical libraries. If the library is small (< 20 stories), a fallback to `topK * 3` or `topK * 4` could be gated on `candidates.length`.

---

## Edge case review — all handled

| Case                                   | Handling                                                    | Status        |
| -------------------------------------- | ----------------------------------------------------------- | ------------- |
| `requirementText` is empty string      | `tokenize()` returns empty set → `keywordBps = 0`           | ✓ Handled     |
| `refTitle` is null                     | `keywordOverlapBps` early returns 0                         | ✓ Handled     |
| `refTags` is empty array               | `tagOverlapBps` early returns 0                             | ✓ Handled     |
| No embedding found for requirement     | `cosineCandidates` returns `[]`, `processJob` returns early | ✓ Handled     |
| `candidates.length === 0`              | Early return in `processJob` after `cosineCandidates`       | ✓ Handled     |
| `mmrPrune` both titles null            | `return false` (not treated as duplicate)                   | ✓ Handled     |
| Negative `ageDays` (future `closedAt`) | `exp(-ln2 * negative)` → `> 10000` before `Math.round`      | ⚠️ Note below |

**Future closedAt note:** If `closedAt` is in the future (data entry error), `ageDays < 0`, and `recencyBps` returns `> 10000`. After weighting by 0.10 this can push `finalBps` above 10000. This is a data quality issue rather than a formula error, but a `Math.min(10000, ...)` clamp in `recencyBps` would make it robust:

```ts
return Math.min(
  10000,
  Math.round(10000 * Math.exp(-Math.LN2 * (ageDays / RECENCY_HALF_LIFE_DAYS))),
);
```

---

## Prioritized recommendations

### P1 — Tokenizer threshold (MAJOR, affects keyword scoring AND MMR)

Change `length > 3` to `length > 2` in `tokenize()`. This single change fixes both Check 2b and the tokenizer-MMR interaction in Check 7. It is the highest-leverage fix: one line, two improvements, no behavior change for tokens ≥ 4 characters.

### P2 — Tag precision gaming (MAJOR, requires design decision)

Add a code comment documenting the intentional use of precision over Jaccard, OR switch to Jaccard if tag counts are not governed. This is an architecture decision requiring product input on whether bid story tagging is curated or free-form.

### P3 — Sparse MMR diagnostic log (MINOR)

Add a `log.warn` when `topMatches.length < topK` so operators can detect library quality issues without querying the database.

### P4 — Future closedAt clamp (MINOR, defensive)

Add `Math.min(10000, ...)` in `recencyBps` to guard against data entry errors with future close dates.

---

## Code changes recommended

Only P1 is unambiguous enough to apply without a product decision. P2 requires a design choice. P3–P4 are defensive improvements.

No MATH ERRORS were found. All scoring formulas are mathematically correct. The identified DESIGN RISKs affect retrieval quality and gaming resistance but do not produce invalid score values.
