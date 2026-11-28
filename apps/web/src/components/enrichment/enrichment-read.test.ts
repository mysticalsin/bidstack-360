import { describe, expect, it } from 'vitest';

import { enrichmentGate } from './enrichment-read';

// A card with no payload is not an empty account. Empty copy is only legal
// after a successful read. A later failure that still has rows stays ready.
describe('enrichmentGate', () => {
  it('keeps the last payload when a refresh fails', () => {
    expect(enrichmentGate({ data: { hiring: {} }, isError: true, isLoading: false })).toBe('ready');
  });

  it('is an error only when the read failed and nothing is on screen', () => {
    expect(enrichmentGate({ data: undefined, isError: true, isLoading: false })).toBe('error');
  });

  it('is loading while the first read has not settled', () => {
    expect(enrichmentGate({ data: undefined, isError: false, isLoading: true })).toBe('loading');
  });

  it('stays idle when the read is not running and has no payload', () => {
    expect(enrichmentGate({ data: undefined, isError: false, isLoading: false })).toBe('idle');
  });
});
