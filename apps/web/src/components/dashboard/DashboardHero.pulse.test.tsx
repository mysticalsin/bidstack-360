// WHY: the demo book seeds watchdog rows as sample=true with titles that
// start "Sample:". The feed returns at most five of them, and newAlertCount
// is the whole NEW set. The home pulse counted risks only inside those five
// and spoke as if they were live. A loading read was aria-hidden, and a
// failed read left the pulse slot empty, which reads as all quiet.
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WatchdogFeed } from '@/hooks/useWatchdogFeed';

import { DashboardHero } from './DashboardVisuals';

function feed(partial: Partial<WatchdogFeed> & Pick<WatchdogFeed, 'alerts' | 'newAlertCount'>): WatchdogFeed {
  return {
    days: 30,
    earnings: [],
    heat: [],
    heatWeekStarts: [],
    ...partial,
  };
}

const demoSample: WatchdogFeed = feed({
  newAlertCount: 19,
  alerts: [
    {
      id: 'dnb-aml',
      companyId: 'dnb',
      companyName: 'DNB Bank',
      title: 'Sample: DNB Bank fined by regulator over anti-money laundering controls',
      source: 'sample',
      occurredAt: '2026-11-07T00:00:00.000Z',
      implication: 'RISK',
    },
    {
      id: 'ci-q3',
      companyId: 'ci',
      companyName: 'CI Financial',
      title: 'Sample: CI Financial third-quarter profit rose 12% on record assets',
      source: 'sample',
      occurredAt: '2026-11-19T00:00:00.000Z',
      implication: 'NEUTRAL',
    },
  ],
});

function renderHero(props: Partial<ComponentProps<typeof DashboardHero>> = {}) {
  return render(
    <DashboardHero rows={[]} openValue={11_890_000} weighted={0} openCount={6} {...props} />,
  );
}

afterEach(cleanup);

describe('dashboard pulse caption', () => {
  it('calls demo sample signals sample, and scopes the risk count to the loaded page', () => {
    renderHero({ feed: demoSample });
    const caption = screen.getByTestId('dashboard-pulse-caption');
    expect(caption.textContent).toBe(
      'Watchdog: 19 new signals (sample) · 1 sample risk in the latest 2',
    );
    expect(document.querySelector('[data-tone="alert"]')).toBeNull();
    expect(document.querySelector('[data-tone="watch"]')).toBeTruthy();
  });

  it('keeps a single live risk as a risk, with no sample label', () => {
    renderHero({
      feed: feed({
        newAlertCount: 1,
        alerts: [
          {
            id: 'live',
            companyId: 'dnb',
            companyName: 'DNB Bank',
            title: 'DNB Bank fined by regulator over anti-money laundering controls',
            source: 'gdelt',
            occurredAt: '2026-11-07T00:00:00.000Z',
            implication: 'RISK',
          },
        ],
      }),
    });
    expect(screen.getByTestId('dashboard-pulse-caption').textContent).toBe(
      'Watchdog: 1 new signal · 1 risk',
    );
    expect(document.querySelector('[data-tone="alert"]')).toBeTruthy();
  });

  it('does not treat risks in a longer live list as the whole book', () => {
    renderHero({
      feed: feed({
        newAlertCount: 8,
        alerts: [
          {
            id: 'live',
            companyId: 'dnb',
            companyName: 'DNB Bank',
            title: 'DNB Bank fined by regulator',
            source: 'gdelt',
            occurredAt: '2026-11-07T00:00:00.000Z',
            implication: 'RISK',
          },
          {
            id: 'other',
            companyId: 'ci',
            companyName: 'CI Financial',
            title: 'CI Financial third-quarter profit rose',
            source: 'gdelt',
            occurredAt: '2026-11-19T00:00:00.000Z',
            implication: 'NEUTRAL',
          },
        ],
      }),
    });
    expect(screen.getByTestId('dashboard-pulse-caption').textContent).toBe(
      'Watchdog: 8 new signals · 1 risk in the latest 2',
    );
  });

  it('says the pulse is loading and does not call that all quiet', () => {
    renderHero({ feedPending: true });
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Loading watchdog.');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByText(/all quiet/i)).toBeNull();
    expect(screen.queryByTestId('dashboard-pulse-caption')).toBeNull();
  });

  it('says the pulse failed and retries, instead of leaving the slot empty', () => {
    const onFeedRetry = vi.fn();
    renderHero({ feedFailed: true, onFeedRetry });
    expect(screen.getByRole('alert').textContent).toContain('Could not load watchdog.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onFeedRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText(/all quiet/i)).toBeNull();
  });

  it('stays all quiet when nothing is new', () => {
    renderHero({ feed: feed({ newAlertCount: 0, alerts: [] }) });
    expect(screen.getByTestId('dashboard-pulse-caption').textContent).toBe('Watchdog: all quiet');
    expect(document.querySelector('[data-tone="calm"]')).toBeTruthy();
  });
});
