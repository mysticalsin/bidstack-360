import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { protectedStageProbabilityDecision } from './pipeline-stage-probability.js';

describe('protectedStageProbabilityDecision', () => {
  it('refuses a won stage percent other than 100', () => {
    // WHY: a stage move reports the stage percent. Demo Closed Won is 100.
    // Saving 0 or 40 from the editor would publish a won stage that is not won.
    expect(protectedStageProbabilityDecision({ isWon: true, isLost: false }, 0)).toEqual({
      ok: false,
      statusCode: 400,
      message: 'A won stage stays at 100.',
    });
    expect(protectedStageProbabilityDecision({ isWon: true, isLost: false }, 40)).toEqual({
      ok: false,
      statusCode: 400,
      message: 'A won stage stays at 100.',
    });
    expect(protectedStageProbabilityDecision({ isWon: true, isLost: false }, 100)).toEqual({
      ok: true,
    });
  });

  it('refuses a lost stage percent other than 0', () => {
    // WHY: Closed Lost is the terminal loss. 100 would count it like a win.
    expect(protectedStageProbabilityDecision({ isWon: false, isLost: true }, 100)).toEqual({
      ok: false,
      statusCode: 400,
      message: 'A lost stage stays at 0.',
    });
    expect(protectedStageProbabilityDecision({ isWon: false, isLost: true }, 0)).toEqual({
      ok: true,
    });
  });

  it('allows any in-range percent on an open stage', () => {
    // WHY: S3 Technical Iteration is not terminal. 60 and a typed 0 both stay legal.
    expect(protectedStageProbabilityDecision({ isWon: false, isLost: false }, 60)).toEqual({
      ok: true,
    });
    expect(protectedStageProbabilityDecision({ isWon: false, isLost: false }, 0)).toEqual({
      ok: true,
    });
  });

  it('the stage patch asks the guard before it writes a percent', () => {
    // WHY: the editor is not the only client. A direct PATCH must not store 0 on Closed Won.
    const src = readFileSync(path.resolve(process.cwd(), 'src/routes/pipeline-stages.ts'), 'utf8');
    const patch = src.slice(src.indexOf('server.patch('), src.indexOf('async function ensureDefaultPipeline'));
    expect(patch).toContain('protectedStageProbabilityDecision(');
    expect(patch).toContain('server.httpErrors.badRequest(decision.message)');
  });
});
