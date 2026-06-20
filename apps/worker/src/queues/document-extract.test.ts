import { describe, expect, it } from 'vitest';

import {
  buildSourceChunks,
  detectWinLossSignal,
  deterministicExtract,
  extractRequirementCandidates,
  normalizeWinLoss,
} from './document-extract-analysis.js';

describe('bid document extraction helpers', () => {
  it('turns RFP text into source chunks and cited requirement candidates', () => {
    const chunks = buildSourceChunks(`
      1. The supplier must provide SOC 2 Type II evidence with the proposal response.

      2. The bidder shall submit a pricing workbook by Friday at 17:00.

      3. Architecture notes may include a cloud migration roadmap.
    `);

    const requirements = extractRequirementCandidates(chunks);

    expect(chunks.length).toBeGreaterThan(0);
    expect(requirements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringMatching(/SOC 2 Type II evidence/i),
          mandatory: true,
          priority: 'high',
          requirementType: 'security',
          sourceChunkIndex: 0,
        }),
        expect.objectContaining({
          text: expect.stringMatching(/pricing workbook/i),
          mandatory: true,
          requirementType: 'commercial',
          sourceChunkIndex: 0,
        }),
      ]),
    );
  });
});

describe('win/loss signal learning', () => {
  it('detects a LOSS with its reasons from a debrief', () => {
    const signal = detectWinLossSignal(
      'Bid debrief: unfortunately we lost the bid. The client said our pricing was too high ' +
        'and the incumbent supplier had a stronger existing relationship.',
    );
    expect(signal).not.toBeNull();
    expect(signal?.outcome).toBe('lost');
    // WHY: reasons must be canonical tags so they aggregate across deals.
    expect(signal?.reasons).toEqual(expect.arrayContaining(['price', 'relationship']));
  });

  it('detects a WIN', () => {
    const signal = detectWinLossSignal('Great news — the contract was awarded to us. We won the deal.');
    expect(signal?.outcome).toBe('won');
  });

  it('prefers loss when a document mentions both (we learn most from losses)', () => {
    const signal = detectWinLossSignal('We won the EMEA deal but we lost the bid in APAC on price.');
    expect(signal?.outcome).toBe('lost');
    expect(signal?.reasons).toContain('price');
  });

  it('returns null for a document with no win/loss signal (e.g. an MSA)', () => {
    const signal = detectWinLossSignal(
      'Master Service Agreement between the parties. Rate card attached. Effective 2026-01-01.',
    );
    expect(signal).toBeNull();
  });

  it('attaches the win/loss signal to the deterministic extraction result', () => {
    const result = deterministicExtract('Debrief: we lost the deal because of budget constraints.');
    expect(result.winLoss?.outcome).toBe('lost');
    expect(result.winLoss?.reasons).toContain('price');
  });

  // Regressions found by the prod-readiness review (substring matching).
  it('does NOT match a reason keyword inside an unrelated word (benefit !== product_fit)', () => {
    const signal = detectWinLossSignal('We won the bid. The client loved the benefits of our solution.');
    expect(signal?.outcome).toBe('won');
    expect(signal?.reasons ?? []).not.toContain('product_fit');
  });

  it('does NOT read a negated contraction as a win ("we won\'t" !== won)', () => {
    expect(detectWinLossSignal("We won't pursue this opportunity.")).toBeNull();
  });

  it('emits nothing when reasons appear without any outcome phrase (routine MSA/SOW noise)', () => {
    expect(detectWinLossSignal('Our standard pricing and SLA terms apply to this engagement.')).toBeNull();
  });

  it('still detects a genuine support/SLA reason on a real loss', () => {
    const signal = detectWinLossSignal('We lost the bid — the incumbent had a stronger SLA.');
    expect(signal?.outcome).toBe('lost');
    expect(signal?.reasons).toContain('support');
  });
});

describe('normalizeWinLoss (LLM output coercion)', () => {
  it('keeps canonical reason tags (incl. competitor) and drops unknown ones', () => {
    const out = normalizeWinLoss({
      outcome: 'lost',
      reasons: ['price', 'competitor', 'vibes', 'PRODUCT_FIT'],
      competitors: ['Acme Corp'],
      summary: 'Lost on price to Acme.',
    });
    expect(out?.outcome).toBe('lost');
    expect(out?.reasons).toEqual(expect.arrayContaining(['price', 'competitor', 'product_fit']));
    expect(out?.reasons).not.toContain('vibes');
    expect(out?.competitors).toEqual(['Acme Corp']);
  });

  it('clamps a hallucinated/missing outcome to unknown and returns null if otherwise empty', () => {
    expect(normalizeWinLoss({ outcome: 'maybe' })).toBeNull();
    expect(normalizeWinLoss(null)).toBeNull();
    expect(normalizeWinLoss('nope')).toBeNull();
  });

  it('survives wrong-typed fields without throwing', () => {
    const out = normalizeWinLoss({ outcome: 'won', reasons: 'price', competitors: 42 });
    expect(out?.outcome).toBe('won');
    expect(out?.reasons).toEqual([]);
    expect(out?.competitors).toEqual([]);
  });

  it('caps competitors at 10 and trims overly long names', () => {
    const out = normalizeWinLoss({
      outcome: 'lost',
      competitors: Array.from({ length: 15 }, (_, i) => `Competitor ${i}`),
    });
    expect(out?.competitors.length).toBe(10);
  });
});
