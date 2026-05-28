/**
 * Unit tests for rfp-story-match.ts pure scoring functions.
 *
 * These tests exercise the hybrid retrieval scoring pipeline in isolation —
 * no Redis, no Prisma, no Cohere required. vi.mock blocks for Prisma and
 * BullMQ ensure the module-level side-effect registrations never run.
 */

import { describe, expect, it, vi } from 'vitest';

// ─── Module-level mocks (must precede imports) ──────────────────────────────

vi.mock('@bidstack/db', () => ({
  prisma: {
    requirement: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
  })),
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    on: vi.fn(),
  })),
}));

vi.mock('@bidstack/shared', () => ({
  RFP_STORY_MATCH: {
    name: 'rfp.story-match',
    defaultJobOptions: { attempts: 4, backoff: { type: 'exponential', delay: 5000 } },
  },
}));

import {
  tokenize,
  keywordOverlapBps,
  tagOverlapBps,
  recencyBps,
  mmrPrune,
  type ScoredCandidate,
} from '../rfp-story-match.js';

// ─── tokenize() ─────────────────────────────────────────────────────────────

describe('tokenize()', () => {
  it('lowercases all tokens', () => {
    const result = tokenize('UPPER lower MiXeD');
    expect(result.has('upper')).toBe(true);
    expect(result.has('lower')).toBe(true);
    expect(result.has('mixed')).toBe(true);
  });

  it('strips punctuation by splitting on non-word characters', () => {
    const result = tokenize('hello, world! foo-bar baz.qux');
    // "hello", "world", "foo", "bar", "baz", "qux" — filter keeps length > 2
    expect(result.has('hello')).toBe(true);
    expect(result.has('world')).toBe(true);
    // "foo" length is 3 which IS > 2 — kept (needed for 3-letter bid acronyms)
    expect(result.has('foo')).toBe(true);
    expect(result.has('bar')).toBe(true);
  });

  it('filters out tokens with length <= 2 (min-length 3)', () => {
    const result = tokenize('the a is for from compliance');
    // "a"(1), "is"(2) dropped; "the"(3) kept, "for"(3) kept, "from"(4) kept
    // WHY: tokenize keeps 3-letter tokens to preserve RFP/SLA/API-class acronyms
    expect(result.has('a')).toBe(false);
    expect(result.has('is')).toBe(false);
    expect(result.has('the')).toBe(true); // length 3 > 2
    expect(result.has('for')).toBe(true); // length 3 > 2
    expect(result.has('from')).toBe(true);
    expect(result.has('compliance')).toBe(true);
  });

  it('returns a Set (deduplicates repeated tokens)', () => {
    const result = tokenize('cloud cloud cloud');
    expect(result.size).toBe(1);
    expect(result.has('cloud')).toBe(true);
  });

  it('returns an empty Set for an empty string', () => {
    expect(tokenize('').size).toBe(0);
  });

  it('returns an empty Set for a string with only 1- and 2-character words', () => {
    // Only tokens with length <= 2 are filtered. "a"(1), "is"(2), "an"(2) are all dropped.
    // "the"(3) and "of"(2) — "the" is kept, "of" is dropped.
    const result = tokenize('a is an of');
    expect(result.has('a')).toBe(false);
    expect(result.has('is')).toBe(false);
    expect(result.has('an')).toBe(false);
    expect(result.has('of')).toBe(false);
    expect(result.size).toBe(0);
  });

  it('handles numbers mixed with text', () => {
    const result = tokenize('ISO 27001 compliance framework');
    expect(result.has('compliance')).toBe(true);
    expect(result.has('framework')).toBe(true);
    // "27001" length is 5 so it passes the filter
    expect(result.has('27001')).toBe(true);
  });
});

// ─── keywordOverlapBps() ────────────────────────────────────────────────────

describe('keywordOverlapBps()', () => {
  it('returns 10000 (100%) when req and ref share all tokens', () => {
    // Both tokenize to {"cloud", "compliance"} — Jaccard = 2/2 = 1.0
    expect(keywordOverlapBps('cloud compliance', 'cloud compliance')).toBe(10000);
  });

  it('returns 0 when there is no token overlap', () => {
    // Jaccard = 0/union
    expect(keywordOverlapBps('cloud compliance', 'vendor procurement')).toBe(0);
  });

  it('computes Jaccard similarity correctly for partial overlap', () => {
    // reqTokens = {cloud, compliance}, refTokens = {cloud, security}
    // overlap = 1, union = 3, Jaccard = 1/3 ≈ 3333 bps
    const bps = keywordOverlapBps('cloud compliance', 'cloud security');
    expect(bps).toBe(3333);
  });

  it('returns 0 when refTitle is null', () => {
    expect(keywordOverlapBps('cloud compliance', null)).toBe(0);
  });

  it('returns 0 when refTitle is undefined', () => {
    expect(keywordOverlapBps('cloud compliance', undefined)).toBe(0);
  });

  it('returns 0 when refTitle is an empty string', () => {
    expect(keywordOverlapBps('cloud compliance', '')).toBe(0);
  });

  it('returns 0 when reqText tokenizes to empty (only 1–2 char words)', () => {
    // "a"(1), "is"(2) — both dropped; tokenize result is empty
    expect(keywordOverlapBps('a is', 'cloud compliance')).toBe(0);
  });

  it('returns 0 when both sides tokenize to empty', () => {
    // "a"(1), "is"(2), "or"(2), "an"(2) — all dropped
    expect(keywordOverlapBps('a is', 'or an')).toBe(0);
  });

  it('is case-insensitive (tokenize lowercases both sides)', () => {
    expect(keywordOverlapBps('CLOUD COMPLIANCE', 'cloud compliance')).toBe(10000);
  });
});

// ─── tagOverlapBps() ────────────────────────────────────────────────────────

describe('tagOverlapBps()', () => {
  it('returns 10000 when all tags appear in reqText', () => {
    // 2/2 tags matched
    expect(tagOverlapBps('cloud security compliance assessment', ['cloud', 'security'])).toBe(
      10000,
    );
  });

  it('returns 0 when no tags appear in reqText', () => {
    expect(tagOverlapBps('procurement vendor selection', ['cloud', 'security'])).toBe(0);
  });

  it('returns partial score when some tags match', () => {
    // 1 of 2 tags matched → 5000 bps
    expect(tagOverlapBps('cloud architecture design', ['cloud', 'security'])).toBe(5000);
  });

  it('returns 0 for an empty refTags array', () => {
    expect(tagOverlapBps('cloud security compliance', [])).toBe(0);
  });

  it('is case-insensitive for tag matching', () => {
    expect(tagOverlapBps('CLOUD SECURITY', ['cloud', 'security'])).toBe(10000);
    expect(tagOverlapBps('cloud security', ['CLOUD', 'SECURITY'])).toBe(10000);
  });

  it('matches tags via substring (partial word match)', () => {
    // "cloud" is a substring of "cloudwatch"
    expect(tagOverlapBps('cloudwatch metrics', ['cloud'])).toBe(10000);
  });

  it('handles single tag arrays correctly', () => {
    expect(tagOverlapBps('gdpr data protection regulation', ['gdpr'])).toBe(10000);
    expect(tagOverlapBps('vendor management', ['gdpr'])).toBe(0);
  });
});

// ─── recencyBps() ───────────────────────────────────────────────────────────

describe('recencyBps()', () => {
  it('returns exactly 5000 for null closedAt (unknown date → neutral)', () => {
    expect(recencyBps(null)).toBe(5000);
  });

  it('returns exactly 5000 for undefined closedAt', () => {
    expect(recencyBps(undefined)).toBe(5000);
  });

  it('returns near 10000 for a very recent date (yesterday)', () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const bps = recencyBps(yesterday);
    // exp(-ln2 * 1/365) ≈ 0.9981 → ~9981 bps
    expect(bps).toBeGreaterThan(9900);
    expect(bps).toBeLessThanOrEqual(10000);
  });

  it('returns near 0 for a very old date (10 years ago)', () => {
    const tenYearsAgo = new Date(Date.now() - 10 * 365 * 86_400_000);
    const bps = recencyBps(tenYearsAgo);
    // exp(-ln2 * 3650/365) ≈ exp(-7.0) ≈ 0.0009 → ~9 bps
    expect(bps).toBeLessThan(100);
    expect(bps).toBeGreaterThanOrEqual(0);
  });

  it('returns approximately 5000 bps at exactly one half-life (365 days)', () => {
    // exp(-ln2 * 365/365) = exp(-ln2) = 0.5 → 5000 bps
    const halfLifeAgo = new Date(Date.now() - 365 * 86_400_000);
    const bps = recencyBps(halfLifeAgo);
    // Allow ±50 bps tolerance for floating-point rounding
    expect(bps).toBeGreaterThan(4950);
    expect(bps).toBeLessThan(5050);
  });

  it('returns exactly 10000 for a future date (clamped by Math.min)', () => {
    // Negative age → exp(positive) > 1 → Math.min(10000, ...) clamps to 10000.
    // WHY clamp exists: data entry errors can produce future closedAt values;
    // clamping prevents scores exceeding 10000 in the final weighted formula.
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(recencyBps(tomorrow)).toBe(10000);
  });
});

// ─── mmrPrune() ─────────────────────────────────────────────────────────────

describe('mmrPrune()', () => {
  function makeCandidate(
    referenceId: string,
    title: string | null,
    finalBps: number,
  ): ScoredCandidate {
    return {
      referenceId,
      cosineBps: finalBps,
      title,
      tags: [],
      closedAt: null,
      keywordBps: 0,
      tagBps: 0,
      recencyBps: 5000,
      finalBps,
    };
  }

  it('returns at most topK candidates', () => {
    // Titles must be distinct enough (Jaccard <= 0.8) so MMR does not collapse them.
    // Single-digit numbers like "0", "1" are filtered by tokenize (length <= 2),
    // making all "Unique Title N Something Long" titles identical after tokenization.
    // Use domain-distinct phrases so each pair has Jaccard well below 0.8.
    const distinctTitles = [
      'cloud security compliance assessment programme',
      'vendor management procurement lifecycle review',
      'agile methodology training delivery framework',
      'data privacy gdpr regulation audit report',
      'financial forecasting budget allocation strategy',
      'stakeholder engagement communication planning',
      'infrastructure migration modernisation roadmap',
      'risk management governance oversight framework',
      'talent acquisition workforce planning strategy',
      'digital transformation innovation leadership',
    ];
    const candidates: ScoredCandidate[] = distinctTitles.map((title, i) =>
      makeCandidate(`ref-${i}`, title, 10000 - i * 100),
    );
    const pruned = mmrPrune(candidates, 3);
    expect(pruned.length).toBe(3);
  });

  it('returns fewer than topK when candidates list is shorter', () => {
    const candidates = [
      makeCandidate('ref-1', 'Cloud Security Assessment', 9000),
      makeCandidate('ref-2', 'Data Privacy Compliance', 8000),
    ];
    const pruned = mmrPrune(candidates, 5);
    expect(pruned.length).toBe(2);
  });

  it('deduplicates near-identical titles (Jaccard > 0.8)', () => {
    // Title pair: "ISO compliance framework standard audit" (5 tokens)
    // vs "ISO compliance framework standard review audit" (6 tokens)
    // shared=5, union=6, Jaccard=0.833 > 0.8 → second is pruned as near-duplicate.
    const candidates = [
      makeCandidate('ref-1', 'ISO compliance framework standard audit', 9000),
      makeCandidate('ref-2', 'ISO compliance framework standard review audit', 8500),
      makeCandidate('ref-3', 'vendor procurement platform selection', 7000),
    ];
    const pruned = mmrPrune(candidates, 5);
    // ref-1 selected first; ref-2 Jaccard=0.833 > 0.8 → pruned
    // ref-3 has a distinct title (Jaccard=0) → included
    const ids = pruned.map((c) => c.referenceId);
    expect(ids).toContain('ref-1');
    expect(ids).not.toContain('ref-2');
    expect(ids).toContain('ref-3');
  });

  it('does NOT deduplicate titles with Jaccard <= 0.8 (distinct enough)', () => {
    // Titles share some tokens but overlap is below 0.8 threshold
    const candidates = [
      makeCandidate('ref-1', 'cloud security assessment programme', 9000),
      makeCandidate('ref-2', 'cloud vendor procurement assessment', 8000),
    ];
    const pruned = mmrPrune(candidates, 5);
    expect(pruned.map((c) => c.referenceId)).toEqual(['ref-1', 'ref-2']);
  });

  it('preserves order (highest score first from sorted input)', () => {
    const candidates = [
      makeCandidate('ref-a', 'agile methodology training programme', 9500),
      makeCandidate('ref-b', 'cloud security audit baseline', 8500),
      makeCandidate('ref-c', 'vendor management procurement cycle', 7000),
    ];
    const pruned = mmrPrune(candidates, 5);
    expect(pruned[0]?.referenceId).toBe('ref-a');
    expect(pruned[1]?.referenceId).toBe('ref-b');
    expect(pruned[2]?.referenceId).toBe('ref-c');
  });

  it('handles candidates with null titles without throwing', () => {
    const candidates = [
      makeCandidate('ref-1', null, 9000),
      makeCandidate('ref-2', null, 8000),
      makeCandidate('ref-3', null, 7000),
    ];
    // Null titles → isDuplicate always returns false → all pass through
    const pruned = mmrPrune(candidates, 2);
    expect(pruned.length).toBe(2);
  });

  it('returns empty array for empty input', () => {
    expect(mmrPrune([], 5)).toEqual([]);
  });

  it('returns empty array when topK is 0', () => {
    const candidates = [makeCandidate('ref-1', 'cloud security assessment', 9000)];
    expect(mmrPrune(candidates, 0)).toEqual([]);
  });
});
