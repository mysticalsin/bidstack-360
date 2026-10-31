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
});
