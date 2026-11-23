/**
 * Dashboard LCP title.
 *
 * WHY: /dashboard's largest text has to ship in the shell bundle. The route
 * chunk is lazy, and Lighthouse's simulated throttling dates LCP from the
 * script that created the surviving text node. This component is that text;
 * App renders it outside Suspense for /dashboard only.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardPageTitle } from './DashboardPageTitle';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe('DashboardPageTitle', () => {
  afterEach(() => cleanup());

  it('renders an opaque page title on the first paint', () => {
    render(<DashboardPageTitle />);
    const title = screen.getByRole('heading', { level: 1, name: 'Workspace Command Center' });
    expect(title.className).toContain('page-title');
    // gradient-text sets color:transparent, which drops the node out of the
    // text LCP candidates and leaves the late error heading as the winner.
    expect(title.className).not.toContain('gradient-text');
    expect(title.style.opacity).not.toBe('0');
  });
});
