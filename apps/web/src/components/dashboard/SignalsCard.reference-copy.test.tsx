import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { WatchdogFeed } from '@/hooks/useWatchdogFeed';

import { SignalsCard } from './DashboardVisuals';

afterEach(() => cleanup());

/** A fixture feed: heat and a result still render. Only the alert title varies. */
function feed(title: string): WatchdogFeed {
  return {
    days: 30,
    earnings: [{
      id: 'e1',
      companyId: 'c1',
      companyName: 'CI Financial',
      fiscalPeriod: 'Q3',
      expectedAt: '2026-12-01T00:00:00.000Z',
      confirmed: false,
    }],
    alerts: [{
      id: 'a1',
      companyId: 'c1',
      companyName: 'CI Financial',
      title,
      source: 'sample',
      occurredAt: '2026-11-01T00:00:00.000Z',
      implication: 'OPPORTUNITY',
    }],
    newAlertCount: 1,
    heat: [{
      companyId: 'c1',
      companyName: 'CI Financial',
      weeks: [{ count: 1, worst: 'OPPORTUNITY' }, { count: 0, worst: null }],
    }],
    heatWeekStarts: ['2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'],
  };
}

function renderCard(title: string) {
  return render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <SignalsCard feed={feed(title)} />
    </MemoryRouter>,
  );
}

function provenance() {
  return document.querySelector('.viz-sample');
}

describe('SignalsCard reference provenance', () => {
  it('labels a fixture Sample: title as reference records, not a local demo', () => {
    renderCard('Sample: CI Financial third-quarter profit rose 12%');
    const banner = provenance();
    expect(banner).toBeTruthy();
    // Sellers read this explanation on the account-signals banner.
    expect(banner?.getAttribute('title')).toBe('Reference records');
    expect(banner?.getAttribute('title') ?? '').not.toMatch(/sample:/i);
    expect(banner?.getAttribute('title') ?? '').not.toMatch(/local demo signals/i);
    expect(screen.getByTestId('dashboard-signals').textContent ?? '').not.toMatch(/local demo signals/i);
    // The fixture feed still draws the account heat and the result that is due.
    expect(screen.getByRole('link', { name: 'CI Financial' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /CI Financial\s+1 Dec/ })).toBeTruthy();
  });

  it('uses the same reference-record banner when the title opens with Reference:', () => {
    renderCard('Reference: CI Financial third-quarter profit rose 12%');
    const banner = provenance();
    expect(banner?.getAttribute('title')).toBe('Reference records');
    expect(screen.getByTestId('dashboard-signals').innerHTML).not.toMatch(/Sample:/);
    expect(screen.getByTestId('dashboard-signals').innerHTML).not.toMatch(/Local demo signals/);
  });

  it('does not mark a live headline as a reference record', () => {
    renderCard('CI Financial third-quarter profit rose 12%');
    expect(provenance()).toBeNull();
    expect(screen.queryByText('Sample')).toBeNull();
    expect(screen.getByRole('link', { name: 'CI Financial' })).toBeTruthy();
  });
});
