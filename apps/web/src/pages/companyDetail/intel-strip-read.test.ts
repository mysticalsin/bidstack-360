import { describe, expect, it } from 'vitest';

import { intelStripRead } from './intel-strip-read';

describe('intelStripRead', () => {
  it('holds the strip on loading until a summary body arrives', () => {
    // A company page that paints "Not refreshed yet" while the summary is
    // still in flight tells the seller the account was never enriched.
    expect(intelStripRead({ isPending: true, isError: false, data: undefined })).toBe('loading');
  });

  it('names a failed first read as an error, not an empty enrichment', () => {
    expect(intelStripRead({ isPending: false, isError: true, data: undefined })).toBe('error');
  });

  it('keeps a settled body, including a summary that is null, and a later failure', () => {
    // Null is a successful "never refreshed". A refetch that fails still has
    // that body, so the strip must not flip to the error panel.
    expect(intelStripRead({ isPending: false, isError: false, data: { summary: null } })).toBe('ready');
    expect(intelStripRead({ isPending: false, isError: true, data: { summary: { revenue: 1 } } })).toBe('ready');
  });
});
