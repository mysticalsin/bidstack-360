import { describe, expect, it } from 'vitest';

import { buildPlays } from './lead-rot.js';

describe('buildPlays', () => {
  it('suggests a next action without inventing a confidence score', () => {
    // WHY: a stale new lead used to return 75%, 60%, and 40% on canned
    // actions. Those percents were not a model. The action can stay; the score cannot.
    const plays = buildPlays('new', 30, true);
    expect(plays.map((play) => play.kind)).toContain('send_reengagement_email');
    expect(plays.every((play) => play.confidence === null)).toBe(true);
  });

  it('returns no plays when the lead is not rotten', () => {
    expect(buildPlays('qualified', 1, false)).toEqual([]);
  });
});
