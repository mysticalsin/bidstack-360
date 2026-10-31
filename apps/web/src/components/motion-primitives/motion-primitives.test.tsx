import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', async (orig) => ({
  ...(await orig<typeof import('motion/react')>()),
  useReducedMotion: () => reduced.value,
}));

import { AnimatedNumber } from './animated-number';
import { BorderTrail } from './border-trail';

const fmt = (n: number) => `${(n / 1e6).toFixed(1)}m`;

describe('motion-primitives (Polo adaptations)', () => {
  it('AnimatedNumber exposes the final formatted value once to assistive tech', () => {
    const { container } = render(<AnimatedNumber value={11_891_500} format={fmt} />);
    expect(container.querySelector('.sr-only')?.textContent).toBe('11.9m');
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('AnimatedNumber snaps straight to the value under reduced motion', () => {
    reduced.value = true;
    const { container } = render(<AnimatedNumber value={4_200_000} format={fmt} />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('4.2m');
    reduced.value = false;
  });

  it('BorderTrail is decorative and disappears under reduced motion', () => {
    const { rerender } = render(<div className="relative"><BorderTrail /></div>);
    expect(screen.getByTestId('border-trail').getAttribute('aria-hidden')).toBe('true');
    reduced.value = true;
    rerender(<div className="relative"><BorderTrail key="r" /></div>);
    expect(screen.queryByTestId('border-trail')).toBeNull();
    reduced.value = false;
  });
});
