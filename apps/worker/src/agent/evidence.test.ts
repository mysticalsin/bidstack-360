import { describe, expect, it } from 'vitest';

import {
  BAND_FLOOR,
  CEILING,
  CONTRADICTED,
  WEIGHTS,
  bandFor,
  scoreEvidence,
  toConfidenceBps,
  type EvidenceKind,
  type Observation,
} from './evidence.js';

/** Terse observation factory — the detail text never affects the arithmetic. */
function obs(kind: EvidenceKind, detail = `observed ${kind}`): Observation {
  return { kind, detail };
}

describe('the constants ADR-0004 forbids tuning', () => {
  it('pins the ceiling, the contradiction clamp and the three band floors by value', () => {
    expect(CEILING).toBe(0.99);
    expect(CONTRADICTED).toBe(0.45);
    expect(BAND_FLOOR).toEqual({ VERIFIED: 0.85, PROBABLE: 0.55, POSSIBLE: 0.3 });
  });

  it('pins the bid vocabulary and its starting weights', () => {
    expect(
      Object.fromEntries(
        Object.entries(WEIGHTS).map(([kind, w]) => [kind, [w.weight, w.primary]]),
      ),
    ).toEqual({
      'rfp.stated-in-document': [0.95, true],
      'library.delivered-project': [0.85, true],
      'crm.client-correspondence': [0.85, true],
      'proposal.prior-submission': [0.8, true],
      'compliance.certificate-on-file': [0.8, true],
      'web.cited-claim': [0.4, false],
      'competitor.insight': [0.35, false],
      'similar-requirement-only': [0.2, false],
      contradiction: [0, false],
    });
  });

  it('carries no CRM identity kinds — the vocabulary is bid-shaped', () => {
    const kinds = Object.keys(WEIGHTS);
    expect(kinds).not.toContain('linkedin.employer-and-name');
    expect(kinds).not.toContain('github.account-identity');
    expect(kinds).not.toContain('employer-only');
  });
});

describe('noisy-OR combination', () => {
  // Each expectation is hand-computed as 1 - Π(1 - w), then min(0.99, …).
  it('a single source scores its own weight', () => {
    expect(scoreEvidence([obs('rfp.stated-in-document')]).score).toBeCloseTo(0.95, 10);
    expect(scoreEvidence([obs('proposal.prior-submission')]).score).toBeCloseTo(0.8, 10);
  });

  it('two 0.80 sources remove doubt multiplicatively: 1 - 0.2*0.2 = 0.96', () => {
    const scored = scoreEvidence([
      obs('proposal.prior-submission'),
      obs('compliance.certificate-on-file'),
    ]);
    expect(scored.score).toBeCloseTo(0.96, 10);
  });

  it('three supporting web claims reach 1 - 0.6^3 = 0.784, never a sum', () => {
    const scored = scoreEvidence([
      obs('web.cited-claim'),
      obs('web.cited-claim'),
      obs('web.cited-claim'),
    ]);
    expect(scored.score).toBeCloseTo(0.784, 10);
    // A sum would have been 1.2 — the whole point of the combination.
    expect(scored.score).toBeLessThan(1);
  });

  it('mixed supporting sources: 1 - 0.6*0.65 = 0.61', () => {
    expect(scoreEvidence([obs('web.cited-claim'), obs('competitor.insight')]).score).toBeCloseTo(
      0.61,
      10,
    );
  });

  it('two near-worthless observations still fall short: 1 - 0.8^2 = 0.36', () => {
    expect(
      scoreEvidence([obs('similar-requirement-only'), obs('similar-requirement-only')]).score,
    ).toBeCloseTo(0.36, 10);
  });

  it('contradiction contributes nothing to the combination (weight 0)', () => {
    const withClash = scoreEvidence([obs('web.cited-claim'), obs('contradiction')]);
    // 1 - 0.6*1 = 0.4, and 0.4 is already under the 0.45 clamp.
    expect(withClash.score).toBeCloseTo(0.4, 10);
  });
});

describe('the 0.99 ceiling', () => {
  it('caps three strong primaries at exactly 0.99', () => {
    const scored = scoreEvidence([
      obs('rfp.stated-in-document'),
      obs('library.delivered-project'),
      obs('crm.client-correspondence'),
    ]);
    expect(scored.score).toBe(CEILING);
  });

  it('nothing is ever certain — every primary kind at once still stops at 0.99', () => {
    const everything = (Object.keys(WEIGHTS) as EvidenceKind[])
      .filter((kind) => WEIGHTS[kind].primary)
      .map((kind) => obs(kind));
    // Raw combination is 0.999955; the ceiling is a floor under doubt, not a
    // rounding guard.
    expect(scoreEvidence(everything).score).toBe(0.99);
  });
});

describe('the contradiction clamp — it holds, it never averages', () => {
  it('a 0.95 primary plus a contradiction lands on 0.45 and drops to POSSIBLE', () => {
    const scored = scoreEvidence([
      obs('rfp.stated-in-document', 'RFP §4.2 requires EU-only hosting'),
      obs('contradiction', 'amendment 2 permits US processing for support'),
    ]);
    expect(scored.score).toBe(CONTRADICTED);
    expect(scored.score).toBe(0.45);
    // 0.45 sits below PROBABLE's 0.55 floor by construction.
    expect(scored.score).toBeLessThan(BAND_FLOOR.PROBABLE);
    expect(scored.band).toBe('POSSIBLE');
    // The primary source is still recorded — the clash does not erase it.
    expect(scored.hasPrimary).toBe(true);
  });

  it('is a minimum, not an assignment — it never raises a weak score', () => {
    const scored = scoreEvidence([obs('similar-requirement-only'), obs('contradiction')]);
    expect(scored.score).toBeCloseTo(0.2, 10);
    expect(scored.band).toBeNull();
  });

  it('clamps the ceiling case too: a maximal stack plus one clash is still held', () => {
    const scored = scoreEvidence([
      obs('rfp.stated-in-document'),
      obs('library.delivered-project'),
      obs('crm.client-correspondence'),
      obs('contradiction', 'the amendment says otherwise'),
    ]);
    expect(scored.score).toBe(0.45);
    expect(scored.band).toBe('POSSIBLE');
  });

  it('explains the clash rather than the support', () => {
    const scored = scoreEvidence([
      obs('rfp.stated-in-document'),
      obs('contradiction', 'amendment 2 permits US processing'),
    ]);
    expect(scored.rationale).toBe('Held: amendment 2 permits US processing.');
  });

  it('holds on a contradiction alone, with no supporting observation at all', () => {
    const scored = scoreEvidence([obs('contradiction', 'the two documents disagree')]);
    expect(scored.score).toBe(0);
    expect(scored.band).toBeNull();
    expect(scored.hasPrimary).toBe(false);
    expect(scored.rationale).toBe('Held: the two documents disagree.');
  });

  it('passes an empty detail straight through — the CRM fallback is `??`, not `||`', () => {
    // Verbatim parity with `D:\CRM\apps\agent\agent\lib\evidence.ts:146`: the
    // "sources disagree" fallback only covers a missing item, which cannot
    // happen inside this branch. An empty detail is a tool bug, and it shows.
    expect(scoreEvidence([{ kind: 'contradiction', detail: '' }]).rationale).toBe('Held: .');
  });
});

describe('band floors', () => {
  it('pins VERIFIED at exactly 0.85, and 0.85 - ε is not VERIFIED', () => {
    expect(bandFor(0.85, true)).toBe('VERIFIED');
    expect(bandFor(0.8499999, true)).toBe('PROBABLE');
  });

  it('pins PROBABLE at exactly 0.55', () => {
    expect(bandFor(0.55, false)).toBe('PROBABLE');
    expect(bandFor(0.5499999, false)).toBe('POSSIBLE');
  });

  it('pins POSSIBLE at exactly 0.3, and below it there is no band at all', () => {
    expect(bandFor(0.3, false)).toBe('POSSIBLE');
    expect(bandFor(0.2999999, false)).toBeNull();
    expect(bandFor(0, false)).toBeNull();
  });

  it('one reference project reaches VERIFIED at exactly the floor (ADR-0004 risk row)', () => {
    const scored = scoreEvidence([obs('library.delivered-project')]);
    expect(scored.score).toBe(0.85);
    expect(scored.band).toBe('VERIFIED');
  });
});

describe('the hasPrimary gate', () => {
  it('score >= 0.85 without a primary source is NOT VERIFIED', () => {
    // Four cited public pages: 1 - 0.6^4 = 0.8704, comfortably over the floor.
    const scored = scoreEvidence([
      obs('web.cited-claim'),
      obs('web.cited-claim'),
      obs('web.cited-claim'),
      obs('web.cited-claim'),
    ]);
    expect(scored.score).toBeCloseTo(0.8704, 10);
    expect(scored.score).toBeGreaterThanOrEqual(BAND_FLOOR.VERIFIED);
    expect(scored.hasPrimary).toBe(false);
    expect(scored.band).toBe('PROBABLE');
  });

  it('bandFor refuses VERIFIED on arithmetic alone, at any score', () => {
    expect(bandFor(0.99, false)).toBe('PROBABLE');
    expect(bandFor(0.99, true)).toBe('VERIFIED');
  });

  it('a single primary observation flips the same score into VERIFIED', () => {
    const withoutPrimary = scoreEvidence([obs('web.cited-claim'), obs('web.cited-claim')]);
    const withPrimary = scoreEvidence([obs('rfp.stated-in-document')]);
    expect(withoutPrimary.band).toBe('PROBABLE');
    expect(withPrimary.band).toBe('VERIFIED');
  });
});

describe('the computed table in ADR-0004', () => {
  const rows: Array<{ kinds: EvidenceKind[]; score: number; primary: boolean; band: string | null }> =
    [
      { kinds: ['rfp.stated-in-document'], score: 0.95, primary: true, band: 'VERIFIED' },
      { kinds: ['library.delivered-project'], score: 0.85, primary: true, band: 'VERIFIED' },
      { kinds: ['proposal.prior-submission'], score: 0.8, primary: true, band: 'PROBABLE' },
      {
        kinds: ['proposal.prior-submission', 'compliance.certificate-on-file'],
        score: 0.96,
        primary: true,
        band: 'VERIFIED',
      },
      {
        kinds: [
          'rfp.stated-in-document',
          'library.delivered-project',
          'crm.client-correspondence',
        ],
        score: 0.99,
        primary: true,
        band: 'VERIFIED',
      },
      {
        kinds: ['web.cited-claim', 'web.cited-claim', 'web.cited-claim'],
        score: 0.784,
        primary: false,
        band: 'PROBABLE',
      },
      {
        kinds: ['web.cited-claim', 'competitor.insight'],
        score: 0.61,
        primary: false,
        band: 'PROBABLE',
      },
      {
        kinds: ['similar-requirement-only', 'similar-requirement-only'],
        score: 0.36,
        primary: false,
        band: 'POSSIBLE',
      },
      { kinds: ['similar-requirement-only'], score: 0.2, primary: false, band: null },
      {
        kinds: ['rfp.stated-in-document', 'contradiction'],
        score: 0.45,
        primary: true,
        band: 'POSSIBLE',
      },
    ];

  it.each(rows)('$kinds -> $score / $band', ({ kinds, score, primary, band }) => {
    const scored = scoreEvidence(kinds.map((kind) => obs(kind)));
    expect(scored.score).toBeCloseTo(score, 10);
    expect(scored.hasPrimary).toBe(primary);
    expect(scored.band).toBe(band);
  });
});

describe('no evidence, and evidence below the floor', () => {
  it('empty evidence short-circuits to score 0 / band null / "No evidence."', () => {
    expect(scoreEvidence([])).toEqual({
      score: 0,
      band: null,
      hasPrimary: false,
      rationale: 'No evidence.',
    });
  });

  it('a lone similar-requirement match scores below the storage floor', () => {
    const scored = scoreEvidence([
      obs('similar-requirement-only', 'we answered UK data residency, this clause says EU'),
    ]);
    expect(scored.score).toBeLessThan(BAND_FLOOR.POSSIBLE);
    // band null means the fact is refused, not stored with a low number.
    expect(scored.band).toBeNull();
  });
});

describe('the rationale a bid manager reads', () => {
  it('lists the supporting observations when a primary source carries the claim', () => {
    const scored = scoreEvidence([
      obs('rfp.stated-in-document'),
      obs('compliance.certificate-on-file'),
    ]);
    expect(scored.rationale).toBe(
      'The RFP itself states it at a citable page and a certificate or attestation on file covers it',
    );
  });

  it('joins three or more reasons with commas and a trailing "and"', () => {
    const scored = scoreEvidence([
      obs('rfp.stated-in-document'),
      obs('library.delivered-project'),
      obs('crm.client-correspondence'),
    ]);
    expect(scored.rationale).toBe(
      'The RFP itself states it at a citable page, a delivered project in our reference library satisfies it and correspondence with this client on file states it',
    );
  });

  it('says so plainly when nothing on file states the requirement directly', () => {
    const scored = scoreEvidence([obs('web.cited-claim'), obs('competitor.insight')]);
    expect(scored.rationale).toMatch(/— but nothing on file states this requirement directly\.$/);
  });
});

describe('the law: a tool reports what it observed, never a confidence', () => {
  it('the observation type has no numeric field to fill', () => {
    const observation = obs('web.cited-claim');
    expect(Object.keys(observation).sort()).toEqual(['detail', 'kind']);
  });

  it('a smuggled confidence changes nothing — the score comes from the kind alone', () => {
    // Typed `never` on Observation, so this needs the cast to exist at all.
    // The runtime assertion below is the second lock: even if a future edit
    // relaxed the type, the arithmetic reads `kind` and nothing else.
    const smuggled = {
      kind: 'similar-requirement-only',
      detail: 'we are extremely confident about this',
      confidenceBps: 9_900,
      score: 0.99,
    } as unknown as Observation;
    expect(scoreEvidence([smuggled]).score).toBeCloseTo(0.2, 10);
    expect(scoreEvidence([smuggled]).band).toBeNull();
  });

  it('rejects a caller-supplied score at the type level', () => {
    // @ts-expect-error — `score` is typed `never`; a tool may not price itself.
    const invalid: Observation = { kind: 'web.cited-claim', detail: 'a page', score: 0.9 };
    expect(invalid.kind).toBe('web.cited-claim');
  });
});

describe('toConfidenceBps', () => {
  it('converts the score to the basis points BidFact.confidenceBps stores', () => {
    expect(toConfidenceBps(scoreEvidence([obs('rfp.stated-in-document')]).score)).toBe(9_500);
    expect(toConfidenceBps(0.99)).toBe(9_900);
    expect(toConfidenceBps(CONTRADICTED)).toBe(4_500);
    expect(toConfidenceBps(0)).toBe(0);
  });
});
