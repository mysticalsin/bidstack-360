import { describe, expect, it } from 'vitest';

import { forecastFocusPeriod, type ForecastPeriodFigures } from './forecast-focus';

function period(
  label: string,
  open: number,
  won = 0,
  commit: number | null = null,
): ForecastPeriodFigures {
  return {
    period: label,
    label,
    openMicros: open,
    wonMicros: won,
    manualCommitMicros: commit,
  };
}

describe('forecastFocusPeriod', () => {
  it('stays on this quarter when it still has open pipeline', () => {
    const periods = [period('Q4 2026', 1), period('Q1 2027', 9)];
    expect(forecastFocusPeriod(periods)?.label).toBe('Q4 2026');
  });

  it('stays on this quarter when the only figure is closed-won', () => {
    // A quarter that already closed revenue is a result, not an empty book.
    const periods = [period('Q4 2026', 0, 500), period('Q1 2027', 9)];
    expect(forecastFocusPeriod(periods)?.label).toBe('Q4 2026');
  });

  it('stays on this quarter when a rep has entered a manual commit', () => {
    // The commit is the number the bid team is held to. Skipping it would hide the override.
    const periods = [period('Q4 2026', 0, 0, 250), period('Q1 2027', 9)];
    expect(forecastFocusPeriod(periods)?.label).toBe('Q4 2026');
  });

  it('opens the next quarter that has pipeline when this quarter is empty', () => {
    // Demo close dates are 45 days out. From late Q4 that is Q1, and the headline must not read zero.
    const periods = [period('Q4 2026', 0), period('Q1 2027', 0), period('Q2 2027', 6_200_000)];
    expect(forecastFocusPeriod(periods)?.label).toBe('Q2 2027');
  });

  it('keeps the current quarter when every period is empty', () => {
    const periods = [period('Q4 2026', 0), period('Q1 2027', 0)];
    expect(forecastFocusPeriod(periods)?.label).toBe('Q4 2026');
  });

  it('returns undefined when there is no period', () => {
    expect(forecastFocusPeriod([])).toBeUndefined();
  });
});
