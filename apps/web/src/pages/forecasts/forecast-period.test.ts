import { describe, expect, it } from 'vitest';

import {
  canonicalForecastPeriod,
  matchesPeriodFilter,
  periodFilterFor,
} from './forecastsConfig';

/**
 * The projection names a quarter "Q1 2027". The manual book stores "2027-Q1"
 * and the period filter only keeps one of those shapes. A label copied off
 * the chart must land in Quarterly, or the save looks successful and the row
 * is missing from every tab.
 */
describe('forecast period shapes', () => {
  it('reads the projection label as the quarterly key the filter already keeps', () => {
    expect(canonicalForecastPeriod('Q1 2027')).toBe('2027-Q1');
    expect(canonicalForecastPeriod('q2 2026')).toBe('2026-Q2');
    expect(canonicalForecastPeriod('2026-q2')).toBe('2026-Q2');
    expect(canonicalForecastPeriod('  2026-05 ')).toBe('2026-05');
    expect(canonicalForecastPeriod('2026')).toBe('2026');
    expect(canonicalForecastPeriod('next quarter')).toBeNull();
    expect(canonicalForecastPeriod('2026-13')).toBeNull();
    expect(canonicalForecastPeriod('2026-Q5')).toBeNull();
  });

  it('puts a copied quarter label on Quarterly and nowhere else', () => {
    expect(periodFilterFor('Q1 2027')).toBe('quarterly');
    expect(matchesPeriodFilter('Q1 2027', 'quarterly')).toBe(true);
    expect(matchesPeriodFilter('Q1 2027', 'monthly')).toBe(false);
    expect(matchesPeriodFilter('Q1 2027', 'yearly')).toBe(false);
    expect(matchesPeriodFilter('2027-Q1', 'quarterly')).toBe(true);
    expect(matchesPeriodFilter('2026-05', 'monthly')).toBe(true);
    expect(matchesPeriodFilter('2026', 'yearly')).toBe(true);
    expect(matchesPeriodFilter('next quarter', 'quarterly')).toBe(false);
  });
});
