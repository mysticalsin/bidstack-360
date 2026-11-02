import { render, screen } from '@testing-library/react';
import type { ComponentProps, ElementType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { SIGNAL_COVERAGE_WEIGHTS } from './_tokens';
import { HealthScoreCard } from './HealthScoreCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) => {
      if (!values) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
    },
  }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motionComponent = (tag: ElementType) => {
    const Component = React.forwardRef<HTMLElement, ComponentProps<'div'> & { children?: ReactNode }>(
      ({ children, ...props }, ref) => {
        const { animate, initial, transition, ...domProps } = props as Record<string, unknown>;
        void animate;
        void initial;
        void transition;
        return React.createElement(tag, { ...domProps, ref }, children);
      },
    );
    Component.displayName = `Motion${String(tag)}`;
    return Component;
  };

  return {
    animate: (_motion: unknown, value: number, options?: { onUpdate?: (value: number) => void }) => {
      options?.onUpdate?.(value);
      return { stop: vi.fn() };
    },
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => motionComponent(tag),
      },
    ),
    useMotionValue: (value: number) => ({ get: () => value, set: vi.fn() }),
    useReducedMotion: () => true,
  };
});

describe('HealthScoreCard', () => {
  it('names the signal-mix weights and does not borrow the account-list or field-fill score', () => {
    const cockpit = {
      health: {
        score: 34,
        band: 'needs_attention',
        counts: { strong: 1, good: 0, needs_attention: 2, critical: 1 },
        factors: [],
      },
    } as AccountCockpitSnapshot;

    render(<HealthScoreCard cockpit={cockpit} />);

    const caption = screen.getByText(/4 factors/).textContent ?? '';
    expect(caption).toContain(SIGNAL_COVERAGE_WEIGHTS);
    expect(caption).not.toMatch(/recorded-field|account list|weighted-pipeline/i);
    expect(screen.getByText(/Bands: 75\+ strong/).textContent).toMatch(/Not measured relationship health/);
    expect(screen.getByText('Signal mix')).toBeTruthy();
    expect(screen.getByText('Most factors')).toBeTruthy();
    expect(SIGNAL_COVERAGE_WEIGHTS).not.toMatch(/account-list|recorded-field/i);
  });
});
