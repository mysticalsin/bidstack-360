import { describe, expect, it } from 'vitest';

import {
  buildSourceChunks,
  detectWinLossSignal,
  deterministicExtract,
  extractRequirementCandidates,
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
});
