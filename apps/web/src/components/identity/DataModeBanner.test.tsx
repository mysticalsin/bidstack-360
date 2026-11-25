import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const identity = vi.hoisted(() => ({
  current: {
    isLoading: false,
    isError: false,
    data: undefined as { dataMode: 'demo' | 'real' } | undefined,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@/hooks/usePoloIdentity', () => ({
  usePoloPublicIdentity: () => identity.current,
}));

import { DataModeBanner } from './DataModeBanner';

const LAST_MODE_KEY = 'polo:last-data-mode';

function renderBanner() {
  return render(
    <MemoryRouter>
      <DataModeBanner />
    </MemoryRouter>,
  );
}

describe('data mode banner', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    identity.current = { isLoading: false, isError: false, data: undefined };
  });

  it('does not paint a stored real mode while the demo data mode is still loading', () => {
    // WHY: the bar above the topbar is the environment a visitor trusts before
    // they read a single synthetic record. A previous real session stored in
    // this browser is not this workspace. Until /api/identity answers, the
    // bar waits. It does not wear the real-data sentence or the demo amber.
    localStorage.setItem(LAST_MODE_KEY, 'real');
    identity.current = { isLoading: true, isError: false, data: undefined };

    renderBanner();

    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status.className).not.toContain('bg-amber-500/10');
    expect(status.textContent).not.toMatch(/Real-data mode/);
    expect(status.textContent).not.toContain('DEMO MODE');
  });

  it('does not paint a stored demo mode as the answer when the request fails', () => {
    // WHY: a failed identity request is not evidence the records are synthetic,
    // and it is not evidence they are live. Hiding the bar, or filling it from
    // the last stored mode, leaves a demo book unlabeled or labeled wrong.
    localStorage.setItem(LAST_MODE_KEY, 'demo');
    identity.current = { isLoading: false, isError: true, data: undefined };

    renderBanner();

    const status = screen.getByRole('status', { name: 'Could not load' });
    expect(status.className).not.toContain('bg-amber-500/10');
    expect(status.textContent).not.toContain('DEMO MODE');
    expect(status.textContent).not.toMatch(/Real-data mode/);
  });

  it('says demo once identity reports demo, even if this browser last saw real', () => {
    // WHY: the settled answer is the deployment's data mode. A stored real
    // flag must not keep synthetic records labeled as live signed MSAs.
    localStorage.setItem(LAST_MODE_KEY, 'real');
    identity.current = { isLoading: false, isError: false, data: { dataMode: 'demo' } };

    renderBanner();

    const status = screen.getByRole('status');
    expect(status.textContent).toContain('DEMO MODE');
    expect(status.textContent).toMatch(/Fixture and synthetic data only/);
    expect(status.textContent).not.toMatch(/Real-data mode/);
    expect(status.className).toContain('bg-amber-500/10');
  });

  it('keeps the real-data sentence when identity reports real', () => {
    // WHY: the demo label is only for synthetic data. A real org still says
    // signed MSAs and revenue figures are live.
    localStorage.setItem(LAST_MODE_KEY, 'demo');
    identity.current = { isLoading: false, isError: false, data: { dataMode: 'real' } };

    renderBanner();

    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/Real-data mode/);
    expect(status.textContent).not.toContain('DEMO MODE');
    expect(status.className).not.toContain('bg-amber-500/10');
  });
});
