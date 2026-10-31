import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PulseOrb, toneForBand } from './PulseOrb';

describe('PulseOrb', () => {
  it('maps health bands to tones', () => {
    expect(['strong', 'good', 'needs_attention', 'at_risk'].map(toneForBand)).toEqual(['calm', 'calm', 'watch', 'alert']);
  });
  it('is decorative: hidden from assistive tech, tone exposed for styling', () => {
    const { container } = render(<PulseOrb tone="watch" size={20} />);
    const el = container.querySelector('.pulse-orb');
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(el?.getAttribute('data-tone')).toBe('watch');
  });
  it('draws the nearest tuned preset and scales it into any display size', () => {
    const { container } = render(<PulseOrb tone="calm" size={48} bold />);
    const el = container.querySelector<HTMLElement>('.pulse-orb');
    expect(el?.style.width).toBe('48px');
    expect(el?.className).toContain('pulse-orb--bold');
    expect(container.querySelector<HTMLElement>('.pulse-orb-draw')?.style.transform).toContain('scale(0.75)');
  });
});
