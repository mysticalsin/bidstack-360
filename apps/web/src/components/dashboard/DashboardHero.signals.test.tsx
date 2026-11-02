import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WatchdogFeed } from '@/hooks/useWatchdogFeed';

import { DashboardHero } from './DashboardVisuals';

vi.mock('@/components/viz/PulseOrb', () => ({
  PulseOrb: () => <span data-testid="pulse-orb" />,
}));

vi.mock('@/components/viz/lazy-bklit', () => ({
  HeroArea: () => <div data-testid="hero-area" />,
  QuarterBars: () => null,
  StageFunnel: () => null,
  WinRateLine: () => null,
}));

const names = ['Ada', 'Bea', 'Cara', 'Dia', 'Eve', 'Fay'];

function alert(title: string): WatchdogFeed['alerts'][number] {
  return {
    id: title,
    companyId: 'c1',
    companyName: 'Acme',
    title,
    source: 'news',
    occurredAt: '2026-11-01T12:00:00.000Z',
    implication: 'RISK',
  };
}

function feed(titles: string[], fresh = titles.length): WatchdogFeed {
  return {
    days: 30,
    earnings: [],
    alerts: titles.map(alert),
    newAlertCount: fresh,
    heat: [],
    heatWeekStarts: [],
  };
}

describe('DashboardHero watchdog signals', () => {
  afterEach(cleanup);

  it('does not describe five of six loaded signals as every signal', () => {
    // WHY: the feed took five alerts, so Fay never arrived and the pulse
    // counted the five that remained as the risks. Six loaded signals mean
    // those five are not every signal. Fay is the probe and is not drawn.
    // The line does not pretend the loaded length is a total.
    render(
      <DashboardHero
        rows={[]}
        openValue={0}
        weighted={0}
        openCount={0}
        feed={feed(names, 6)}
      />,
    );

    expect(screen.getByText('5 in the latest 5, not every signal').textContent).toBe(
      '5 in the latest 5, not every signal',
    );
    expect(screen.queryByText(/Watchdog:/)).toBeNull();
    expect(screen.queryByText('Fay')).toBeNull();
    expect(screen.queryByText(/6 risks/)).toBeNull();
    expect(screen.queryByText(/View all/i)).toBeNull();
  });

  it('keeps the watchdog line when five signals are the whole loaded list', () => {
    // WHY: a list that fits is still the old pulse. Five loaded risks are
    // every loaded signal, so the probe caption stays off.
    const five = names.slice(0, 5);
    render(
      <DashboardHero
        rows={[]}
        openValue={0}
        weighted={0}
        openCount={0}
        feed={{
          ...feed(five, 5),
          alerts: five.map((title, index) => ({
            ...alert(title),
            implication: index === 0 ? 'RISK' : 'NEUTRAL',
          })),
        }}
      />,
    );

    expect(screen.getByText('Watchdog: 5 new signals · 1 risk')).toBeTruthy();
    expect(screen.queryByText(/not every signal/i)).toBeNull();
    expect(screen.queryByText(/View all/i)).toBeNull();
  });
});
