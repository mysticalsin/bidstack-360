import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { DataTrustCard } from './DataTrustCard';

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
  return {
    useReducedMotion: () => true,
    motion: new Proxy(
      {},
      {
        get: () => {
          const Component = React.forwardRef<HTMLDivElement, { children?: React.ReactNode }>(
            (props, ref) => React.createElement('div', { ...props, ref }, props.children),
          );
          Component.displayName = 'MotionMock';
          return Component;
        },
      },
    ),
  };
});

function cockpit(): AccountCockpitSnapshot {
  return {
    company: {
      legalName: 'DNB Bank',
      confidence: 0.87,
      logo: null,
      updatedAt: '2026-10-31T12:00:00.000Z',
      sourceAttribution: [],
    },
  } as AccountCockpitSnapshot;
}

describe('DataTrustCard', () => {
  it('does not treat the stored company confidence as attribution when no sources are attached', () => {
    render(<DataTrustCard cockpit={cockpit()} />);
    expect(screen.getByText('Not scored')).toBeTruthy();
    expect(screen.queryByText('87%')).toBeNull();
  });

});