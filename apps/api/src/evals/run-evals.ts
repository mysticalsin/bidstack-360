#!/usr/bin/env tsx
/* eslint-disable no-console */
// WHY: this is a CLI runner script, not shipped application code;
// console.log is the correct output mechanism for a terminal report.
/**
 * Full eval runner — CLI script for offline / periodic evaluation.
 *
 * Usage:
 *   pnpm --filter api eval:rfp                    # heuristic (CI-safe)
 *   EVAL_MODE=full pnpm --filter api eval:rfp      # full LLM judge
 *
 * Exit code 0 = all golden fixtures pass their expectations.
 * Exit code 1 = one or more fixtures failed.
 *
 * WHY separate from the Vitest test: this script prints a rich report table
 * to stdout and supports the full EVAL_MODE=full LLM judge. The Vitest test
 * is the CI gate; this script is for developer exploration and release audits.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { judgeFixture, type JudgeScore } from './llm-judge.js';
import type { GoldenFixture } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'golden-fixtures');

// ─── Load fixtures ───────────────────────────────────────────────────────────

function loadFixtures(): GoldenFixture[] {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json'));
  return files.map(
    (f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as GoldenFixture,
  );
}

// ─── CI threshold constants ──────────────────────────────────────────────────

/** Maximum allowed phantom rate for a golden-good fixture. */
const GOLDEN_MAX_PHANTOM_RATE = 0.05;
/** Minimum overall score for a golden-good fixture. */
const GOLDEN_MIN_OVERALL = 0.85;
/** Minimum phantom rate for adversarial fixtures (judge must flag them). */
const ADVERSARIAL_MIN_PHANTOM_RATE = 0.3;

// ─── Runner ─────────────────────────────────────────────────────────────────

interface EvalResult {
  fixture: GoldenFixture;
  score: JudgeScore;
  pass: boolean;
  failReason?: string;
}

async function evaluate(fixture: GoldenFixture): Promise<EvalResult> {
  const score = await judgeFixture(fixture);
  const isGolden = fixture.expectations.category === 'golden-good';

  let pass = true;
  let failReason: string | undefined;

  if (isGolden) {
    if (score.phantomRate > GOLDEN_MAX_PHANTOM_RATE) {
      pass = false;
      failReason = `phantomRate ${(score.phantomRate * 100).toFixed(1)}% > threshold ${(GOLDEN_MAX_PHANTOM_RATE * 100).toFixed(1)}% — phantoms: ${score.phantomMetrics.join(', ')}`;
    } else if (score.overall < GOLDEN_MIN_OVERALL) {
      pass = false;
      failReason = `overall ${score.overall.toFixed(2)} < threshold ${GOLDEN_MIN_OVERALL}`;
    }
  } else {
    // Adversarial: judge must detect a high phantom rate
    if (score.phantomRate < ADVERSARIAL_MIN_PHANTOM_RATE) {
      pass = false;
      failReason = `adversarial fixture not flagged: phantomRate ${(score.phantomRate * 100).toFixed(1)}% < expected min ${(ADVERSARIAL_MIN_PHANTOM_RATE * 100).toFixed(1)}%`;
    }
  }

  return { fixture, score, pass, failReason };
}

function formatRow(r: EvalResult): string {
  const { fixture, score, pass } = r;
  const icon = pass ? '✅' : '❌';
  const cat = fixture.expectations.category === 'golden-good' ? 'good' : 'ADVERSARIAL';
  return [
    icon,
    fixture.id.padEnd(45),
    cat.padEnd(12),
    `overall=${score.overall.toFixed(2)}`,
    `phantom=${(score.phantomRate * 100).toFixed(1)}%`,
    `mode=${score.mode}`,
    r.failReason ? `← ${r.failReason}` : '',
  ]
    .filter(Boolean)
    .join('  ');
}

async function main() {
  const fixtures = loadFixtures();
  console.log(
    `\n🔍 RFP Eval Suite — ${fixtures.length} fixtures — mode: ${process.env.EVAL_MODE ?? 'heuristic'}\n`,
  );

  const results: EvalResult[] = [];
  for (const fixture of fixtures) {
    const result = await evaluate(fixture);
    results.push(result);
    console.log(formatRow(result));
  }

  const golden = results.filter((r) => r.fixture.expectations.category === 'golden-good');
  const adversarial = results.filter((r) => r.fixture.expectations.category === 'adversarial');
  const goldenFails = golden.filter((r) => !r.pass);
  const adversarialFails = adversarial.filter((r) => !r.pass);

  const avgPhantomRate =
    golden.length > 0 ? golden.reduce((sum, r) => sum + r.score.phantomRate, 0) / golden.length : 0;

  console.log('\n' + '─'.repeat(80));
  console.log(`Golden fixtures:     ${golden.length} total, ${goldenFails.length} failed`);
  console.log(
    `Adversarial fixtures: ${adversarial.length} total, ${adversarialFails.length} not detected`,
  );
  console.log(`Average phantom rate (golden): ${(avgPhantomRate * 100).toFixed(2)}%`);
  console.log(`CI gate (phantom < 5%): ${avgPhantomRate < 0.05 ? '✅ PASS' : '❌ FAIL'}`);

  const allPassed = goldenFails.length === 0 && adversarialFails.length === 0;
  if (!allPassed) {
    console.error('\n❌ Eval suite FAILED — see above for details.\n');
    process.exit(1);
  } else {
    console.log('\n✅ All fixtures passed.\n');
  }
}

main().catch((err) => {
  console.error('Eval runner crashed:', err);
  process.exit(1);
});
