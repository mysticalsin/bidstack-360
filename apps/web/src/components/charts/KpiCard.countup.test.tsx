import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KpiCard } from './KpiCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    useReducedMotion: () => false,
    motion: {
      div: React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(function MotionDiv(props, ref) {
        return <div ref={ref} {...props} />;
      }),
    },
  };
});

describe('KpiCard count-up', () => {
  let now = 0;
  const queue: FrameRequestCallback[] = [];

  beforeEach(() => {
    now = 0;
    queue.length = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function step() {
    const batch = queue.splice(0, queue.length);
    for (const cb of batch) cb(now);
  }

  it('renders every count-up frame compact and ends on 7.86m', () => {
    // WHY: the card writes each eased frame into the DOM. A test that calls
    // formatKpiCountFrame itself stays green when the card goes back to
    // format(value * eased), and that line prints an inexact integer in full.
    // Red-first.
    const { container } = render(<KpiCard title="Pipeline" value={7_860_000} />);
    const el = container.querySelector('span');
    expect(el).toBeTruthy();
    const seen: string[] = [];
    for (let elapsed = 0; elapsed <= 800; elapsed += 16) {
      now = elapsed;
      step();
      seen.push(el?.textContent ?? '');
    }
    for (const text of seen) {
      expect(text, `frame ${text}`).not.toMatch(/,/);
    }
    expect(seen.at(-1)).toBe('7.86m');
    expect(seen.length).toBeGreaterThan(10);
  });
});
