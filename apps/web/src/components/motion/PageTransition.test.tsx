/**
 * PageTransition first-load contract.
 *
 * WHY: /dashboard's FCP is the app shell (~0.9s) and its LCP is whatever
 * text sits inside this wrapper. The wrapper mounts at opacity 0 and only
 * reveals content when a spring finishes on the main thread. Under the
 * Lighthouse 4× CPU throttle that spring does not finish until long after
 * 2.5s, so the largest text (the failed-summary heading) is the LCP.
 * The first paint of a direct load must already be visible. Later route
 * changes can still fade.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { PageTransition } from './PageTransition';

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  motion: {
    div: ({
      children,
      initial,
    }: {
      children?: ReactNode;
      initial?: false | { opacity?: number };
    }) => {
      const hidden = initial !== false && initial?.opacity === 0;
      return <div data-hidden={hidden ? 'true' : 'false'}>{children}</div>;
    },
  },
}));

describe('PageTransition', () => {
  afterEach(() => cleanup());

  it('does not hide the first paint of a direct load', () => {
    render(
      <PageTransition pageKey="/dashboard">
        <h1>Workspace Command Center</h1>
      </PageTransition>,
    );
    const heading = screen.getByRole('heading', { name: 'Workspace Command Center' });
    expect(heading.parentElement?.getAttribute('data-hidden')).toBe('false');
  });
});
