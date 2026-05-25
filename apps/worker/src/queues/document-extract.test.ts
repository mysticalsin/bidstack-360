import { describe, expect, it } from 'vitest';

import { buildSourceChunks, extractRequirementCandidates } from './document-extract.js';

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
