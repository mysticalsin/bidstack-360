import { describe, expect, it } from 'vitest';

import { formatDealForPrompt } from './ai-assistant.context.js';

describe('formatDealForPrompt', () => {
  it('does not invent a dollar amount, and a lost flag is lost', () => {
    // WHY: the email and account briefs used to prefix the amount with $,
    // and a stage key that still looked open hid a lost flag.
    const line = formatDealForPrompt({
      name: 'Landing zone',
      stage: 's2_sent',
      valueMicros: 2_000_000n,
      pipelineStage: { isWon: false, isLost: true, deletedAt: null },
    });
    expect(line).toBe(
      '"Landing zone" (stage s2_sent, outcome lost, value 2 (currency not recorded))',
    );
    expect(line).not.toContain('$');
  });

  it('treats a deleted stage as open and omits a zero amount', () => {
    const line = formatDealForPrompt({
      name: 'Back in play',
      stage: 's2_sent',
      valueMicros: 0n,
      pipelineStage: { isWon: false, isLost: true, deletedAt: new Date('2026-02-01') },
    });
    expect(line).toBe('"Back in play" (stage s2_sent, outcome open)');
  });
});
