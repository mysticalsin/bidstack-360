import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Icon, iconMotionFor } from './Icon';

// The whole point of the re-key (ROUND2-ULTRAPLAN amendment 7) is that 342
// existing `<Icon name=…>` call sites gain hover motion without being edited.
// These assertions are what makes that claim falsifiable: the stamp has to come
// off the NAME, the caller's className has to survive, and an explicit override
// has to win.
describe('Icon motion re-key', () => {
  it('stamps cds-icon and a name-derived data-motion', () => {
    const { container } = render(<Icon name="arrow" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('cds-icon');
    expect(svg?.getAttribute('data-motion')).toBe('nudge-right');
  });

  it('falls back to pop for an unmapped name', () => {
    expect(iconMotionFor('briefcase')).toBe('pop');
    expect(iconMotionFor('settings')).toBe('spin');
    expect(iconMotionFor('trash')).toBe('wiggle');
  });

  it('opts the loader out — its callers already spin it with animate-spin', () => {
    expect(iconMotionFor('loader')).toBe('none');
  });

  it('keeps the caller className alongside cds-icon', () => {
    const { container } = render(<Icon name="close" className="size-4 text-red-500" />);
    const cls = container.querySelector('svg')?.getAttribute('class') ?? '';
    expect(cls).toContain('cds-icon');
    expect(cls).toContain('size-4');
    expect(cls).toContain('text-red-500');
  });

  it('lets an explicit motion prop override the name mapping', () => {
    const { container } = render(<Icon name="arrow" motion="none" />);
    expect(container.querySelector('svg')?.getAttribute('data-motion')).toBe('none');
  });
});
