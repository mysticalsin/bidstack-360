/**
 * LLM-as-judge eval suite — CI gate.
 *
 * Verifies two properties:
 *
 * 1. Golden fixtures (category: "golden-good") — the 10 known-good drafts:
 *    - Individual phantom rate per fixture must be 0 (fully grounded drafts).
 *    - Aggregate phantom rate across all 10 fixtures must be < 5%.
 *    - Overall judge score must be >= 0.85.
 *
 * 2. Adversarial fixtures (category: "adversarial") — the 3 intentionally-bad drafts:
 *    - Phantom rate must be >= 0.30 (judge must detect hallucinations).
 *    - This validates the detector's sensitivity (avoid false negatives).
 *
 * WHY run in CI: phantom metrics in AI-generated proposals are the highest-risk
 * quality failure — a proposal claiming "€15.8M in savings" when no such number
 * appeared in the evidence base damages client trust and creates legal liability.
 * The heuristic judge catches this class of failure without live LLM calls.
 *
 * EVAL_MODE=full: set this env var to use the real Claude judge (adds ~10s and
 * API cost per fixture; not suitable for every CI push).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

import { judgeFixture } from './llm-judge.js';
import type { GoldenFixture } from './types.js';

// ─── Load fixtures from disk ─────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'golden-fixtures');

let allFixtures: GoldenFixture[] = [];
let goldenFixtures: GoldenFixture[] = [];
let adversarialFixtures: GoldenFixture[] = [];

beforeAll(() => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  allFixtures = files.map(
    (f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as GoldenFixture,
  );
  goldenFixtures = allFixtures.filter((f) => f.expectations.category === 'golden-good');
  adversarialFixtures = allFixtures.filter((f) => f.expectations.category === 'adversarial');
});

// ─── CI threshold constants ──────────────────────────────────────────────────

/** Individual golden fixture: max allowable phantom rate. */
const PER_FIXTURE_MAX_PHANTOM_RATE = 0.0;
/** Aggregate across all golden fixtures: max allowable phantom rate. */
const AGGREGATE_MAX_PHANTOM_RATE = 0.05;
/** Golden fixture minimum overall judge score. */
const MIN_OVERALL_SCORE = 0.85;
/** Adversarial fixture minimum phantom rate (detector must flag this high). */
const ADVERSARIAL_MIN_PHANTOM_RATE = 0.3;

// ─── Fixture count guard ─────────────────────────────────────────────────────

describe('eval suite — fixture integrity', () => {
  it('has exactly 10 golden-good fixtures', () => {
    expect(goldenFixtures).toHaveLength(10);
  });

  it('has at least 3 adversarial fixtures', () => {
    expect(adversarialFixtures.length).toBeGreaterThanOrEqual(3);
  });

  it('all fixtures have unique ids', () => {
    const ids = allFixtures.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── Golden fixture quality gate ─────────────────────────────────────────────

describe('golden fixtures — individual phantom rate (must be 0)', () => {
  // One it() per fixture so each failure names the fixture.
  const fixtureIds = [
    'good-01-executive-summary',
    'good-02-technical-approach',
    'good-03-team-credentials',
    'good-04-methodology',
    'good-05-past-performance',
    'good-06-risk-mitigation',
    'good-07-innovation-ai',
    'good-08-sustainability',
    'good-09-pricing',
    'good-10-quality-assurance',
  ];

  for (const id of fixtureIds) {
    it(`${id} — phantom rate must be 0`, async () => {
      const fixture = goldenFixtures.find((f) => f.id === id);
      expect(fixture, `fixture ${id} not found`).toBeDefined();

      const score = await judgeFixture(fixture!);
      expect(
        score.phantomRate,
        `${id} has ${score.phantomMetrics.length} phantom metrics: ${score.phantomMetrics.join(', ')}`,
      ).toBeLessThanOrEqual(PER_FIXTURE_MAX_PHANTOM_RATE);
    });
  }
});

describe('golden fixtures — individual overall score', () => {
  for (const id of [
    'good-01-executive-summary',
    'good-02-technical-approach',
    'good-03-team-credentials',
    'good-04-methodology',
    'good-05-past-performance',
    'good-06-risk-mitigation',
    'good-07-innovation-ai',
    'good-08-sustainability',
    'good-09-pricing',
    'good-10-quality-assurance',
  ]) {
    it(`${id} — overall score >= ${MIN_OVERALL_SCORE}`, async () => {
      const fixture = goldenFixtures.find((f) => f.id === id);
      expect(fixture, `fixture ${id} not found`).toBeDefined();

      const score = await judgeFixture(fixture!);
      expect(
        score.overall,
        `${id} overall=${score.overall.toFixed(2)} relevance=${score.relevanceScore.toFixed(2)} completeness=${score.completenessScore.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(MIN_OVERALL_SCORE);
    });
  }
});

describe('golden fixtures — aggregate phantom rate (CI gate)', () => {
  it(`aggregate phantom rate across all 10 golden fixtures < ${AGGREGATE_MAX_PHANTOM_RATE * 100}%`, async () => {
    const scores = await Promise.all(goldenFixtures.map((f) => judgeFixture(f)));
    const totalPhantoms = scores.reduce((sum, s) => sum + s.phantomMetrics.length, 0);
    const aggrPhantomRate = scores.reduce((sum, s) => sum + s.phantomRate, 0) / scores.length;

    expect(
      aggrPhantomRate,
      `Aggregate phantom rate ${(aggrPhantomRate * 100).toFixed(2)}% exceeds ${(AGGREGATE_MAX_PHANTOM_RATE * 100).toFixed(1)}% threshold. Total phantom count: ${totalPhantoms}`,
    ).toBeLessThan(AGGREGATE_MAX_PHANTOM_RATE);
  });
});

// ─── Adversarial fixture sensitivity gate ────────────────────────────────────

describe('adversarial fixtures — detector sensitivity', () => {
  it('adversarial-01-phantom-percentages is correctly flagged', async () => {
    const fixture = adversarialFixtures.find((f) => f.id === 'adversarial-01-phantom-percentages');
    expect(fixture).toBeDefined();

    const score = await judgeFixture(fixture!);
    expect(
      score.phantomRate,
      `detector missed adversarial-01: phantomRate=${(score.phantomRate * 100).toFixed(1)}% < ${ADVERSARIAL_MIN_PHANTOM_RATE * 100}%`,
    ).toBeGreaterThanOrEqual(ADVERSARIAL_MIN_PHANTOM_RATE);
  });

  it('adversarial-02-phantom-revenue is correctly flagged', async () => {
    const fixture = adversarialFixtures.find((f) => f.id === 'adversarial-02-phantom-revenue');
    expect(fixture).toBeDefined();

    const score = await judgeFixture(fixture!);
    expect(
      score.phantomRate,
      `detector missed adversarial-02: phantomRate=${(score.phantomRate * 100).toFixed(1)}% < ${ADVERSARIAL_MIN_PHANTOM_RATE * 100}%`,
    ).toBeGreaterThanOrEqual(ADVERSARIAL_MIN_PHANTOM_RATE);
  });

  it('adversarial-03-phantom-certifications is correctly flagged', async () => {
    const fixture = adversarialFixtures.find(
      (f) => f.id === 'adversarial-03-phantom-certifications',
    );
    expect(fixture).toBeDefined();

    const score = await judgeFixture(fixture!);
    expect(
      score.phantomRate,
      `detector missed adversarial-03: phantomRate=${(score.phantomRate * 100).toFixed(1)}% < ${ADVERSARIAL_MIN_PHANTOM_RATE * 100}%`,
    ).toBeGreaterThanOrEqual(ADVERSARIAL_MIN_PHANTOM_RATE);
  });
});

// ─── Hallucination detector unit tests ──────────────────────────────────────

describe('hallucination-detector — unit tests', () => {
  // Re-import the detector directly for isolated unit tests.
  // WHY: these tests exercise the detector logic without loading fixtures,
  // making failures fast and diagnostic.

  it('returns phantomRate=0 when no metrics in draft', async () => {
    const { detectPhantomMetrics } = await import('./hallucination-detector.js');
    const report = detectPhantomMetrics(
      'Amaris is a trusted partner with proven delivery experience.',
      'Amaris delivered across multiple European markets.',
    );
    expect(report.phantomRate).toBe(0);
    expect(report.allMetrics).toHaveLength(0);
  });

  it('returns phantomRate=0 when all draft metrics appear in source', async () => {
    const { detectPhantomMetrics } = await import('./hallucination-detector.js');
    const source = 'We reduced costs by €1.2M and achieved 87% test coverage over 22 months.';
    const draft =
      'We reduced infrastructure costs by €1.2M and maintained 87% automated test coverage across the 22-month engagement.';
    const report = detectPhantomMetrics(draft, source);
    expect(report.phantomRate).toBe(0);
    expect(report.groundedMetrics.length).toBeGreaterThan(0);
  });

  it('detects phantom percentage not in source', async () => {
    const { detectPhantomMetrics } = await import('./hallucination-detector.js');
    const source = 'We improved delivery speed significantly.';
    const draft = 'We improved delivery speed by 94.7%.';
    const report = detectPhantomMetrics(draft, source);
    expect(report.phantomMetrics).toContain('94.7%');
    expect(report.phantomRate).toBeGreaterThan(0);
  });

  it('detects phantom currency amount not in source', async () => {
    const { detectPhantomMetrics } = await import('./hallucination-detector.js');
    const source = 'Cost savings were realised across the programme.';
    const draft = 'The programme delivered €4.2M in annual cost savings.';
    const report = detectPhantomMetrics(draft, source);
    expect(report.phantomMetrics.some((m) => m.includes('4.2'))).toBe(true);
  });

  it('does not flag 100% as a phantom metric', async () => {
    const { detectPhantomMetrics } = await import('./hallucination-detector.js');
    const source = 'No metrics here.';
    const draft = '100% of milestones were delivered on time.';
    const report = detectPhantomMetrics(draft, source);
    // 100% is allowlisted — should not appear in phantomMetrics
    expect(report.phantomMetrics).not.toContain('100%');
  });

  it('does not flag a year (2024) as a phantom metric', async () => {
    const { detectPhantomMetrics } = await import('./hallucination-detector.js');
    const source = 'No metrics here.';
    const draft = 'In 2024, we completed the programme.';
    const report = detectPhantomMetrics(draft, source);
    expect(report.phantomMetrics).not.toContain('2024');
  });
});
