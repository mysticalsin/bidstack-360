import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CSS_EASE_DRAWER,
  CSS_EASE_IN_OUT,
  CSS_EASE_OUT,
  EASE_DRAWER,
  EASE_IN_OUT,
  EASE_OUT,
  enter,
  exit,
  instant,
  motionFor,
  spring,
} from './motion-tokens';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
const bezier = (curve: readonly number[]) => `cubic-bezier(${curve.join(', ')})`;

describe('motion tokens', () => {
  it('TS curves match the CSS @theme curves exactly', () => {
    expect(CSS_EASE_OUT).toBe(bezier(EASE_OUT));
    expect(CSS_EASE_IN_OUT).toBe(bezier(EASE_IN_OUT));
    expect(CSS_EASE_DRAWER).toBe(bezier(EASE_DRAWER));
    expect(css).toContain(`--ease-ui-out: ${CSS_EASE_OUT};`);
    expect(css).toContain(`--ease-ui-in-out: ${CSS_EASE_IN_OUT};`);
    expect(css).toContain(`--ease-drawer: ${CSS_EASE_DRAWER};`);
  });

  it('enter and exit durations match the repo duration tokens', () => {
    expect(enter.duration).toBe(0.21);
    expect(exit.duration).toBe(0.15);
    expect(exit.duration).toBeLessThan(enter.duration);
  });

  it('nothing but layout moves runs longer than 300ms', () => {
    expect(enter.duration).toBeLessThanOrEqual(0.3);
    expect(exit.duration).toBeLessThanOrEqual(0.3);
    expect(spring).toEqual({ type: 'spring', duration: 0.3, bounce: 0 });
  });

  it('motionFor falls back to instant under reduced motion', () => {
    expect(motionFor(true, enter)).toBe(instant);
    expect(motionFor(false, enter)).toBe(enter);
    expect(motionFor(null, spring)).toBe(spring);
    expect(instant).toEqual({ duration: 0 });
  });
});
