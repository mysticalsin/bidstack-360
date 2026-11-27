import { describe, expect, it } from 'vitest';

import { stageProbabilityDraft } from './stage-probability-draft';

describe('stageProbabilityDraft', () => {
  it('does not turn a cleared Closed Won field into 0', () => {
    // WHY: Closed Won is stored at 100. Number("") is 0, so a cleared field
    // used to save a won stage as no probability at all.
    expect(stageProbabilityDraft('', 100)).toEqual({ ok: false, reason: 'empty' });
    expect(stageProbabilityDraft('   ', 60)).toEqual({ ok: false, reason: 'empty' });
  });

  it('does not clamp or accept a percent the admin did not type', () => {
    // WHY: 150 was rounded down to 100 and written. "abc" left Save enabled
    // and the submit handler returned without saying why.
    expect(stageProbabilityDraft('150', 60)).toEqual({ ok: false, reason: 'invalid' });
    expect(stageProbabilityDraft('abc', 60)).toEqual({ ok: false, reason: 'invalid' });
    expect(stageProbabilityDraft('100.001', 60)).toEqual({ ok: false, reason: 'invalid' });
    expect(stageProbabilityDraft('-1', 60)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('keeps 0 as a real percent and a typed value that differs from the stored one', () => {
    // WHY: Closed Lost is 0 on purpose. That must stay distinct from an empty field.
    expect(stageProbabilityDraft('0', 60)).toEqual({ ok: true, probability: 0, changed: true });
    expect(stageProbabilityDraft('70', 60)).toEqual({ ok: true, probability: 70, changed: true });
    expect(stageProbabilityDraft('60', 60)).toEqual({ ok: true, probability: 60, changed: false });
    expect(stageProbabilityDraft('100.00', 100)).toEqual({
      ok: true,
      probability: 100,
      changed: false,
    });
  });
});
