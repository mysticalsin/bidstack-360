import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ useDataQuality: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/useCrmIntegrations', () => ({
  useDataQuality: m.useDataQuality,
}));

import { DataQualitySection } from './DataQualitySection';

const DUPLICATE = {
  id: 'dq_demo_1',
  kind: 'duplicate_company' as const,
  severity: 'high' as const,
  title: 'Duplicate domain acme.example',
  detail: 'Two demo companies share this domain.',
  companyId: 'co_demo_1',
  companyName: 'Northwind Demo',
};

function report(issues: Array<typeof DUPLICATE>) {
  return {
    generatedAt: '2026-11-25T12:00:00.000Z',
    counts: { duplicate_company: issues.length },
    issues,
  };
}

function quality(state: {
  isLoading?: boolean;
  isError?: boolean;
  issues?: Array<typeof DUPLICATE>;
}) {
  const loaded = state.issues !== undefined;
  m.useDataQuality.mockReturnValue({
    data: loaded ? report(state.issues ?? []) : undefined,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: state.isError ? new Error('data quality down') : null,
    refetch: vi.fn(),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DataQualitySection', () => {
  it('does not call a failed data quality read a perfect scan', () => {
    // WHY: Integrations, Data quality is where a demo admin reads the scan
    // score. A failed read has no report. The badge still said 100/100.
    quality({ isError: true });
    render(<DataQualitySection />);

    expect(screen.queryByText('100/100')).toBeNull();
    expect(screen.queryByText('No data quality issues')).toBeNull();
    expect(screen.getByText('Data quality is not loaded.')).toBeTruthy();
    expect(screen.getByText('not loaded')).toBeTruthy();
    expect(screen.getByText('Could not load data quality report')).toBeTruthy();
  });

  it('does not call a data quality load in progress a perfect scan', () => {
    // WHY: the score is not known while the report is still loading.
    quality({ isLoading: true });
    render(<DataQualitySection />);

    expect(screen.queryByText('100/100')).toBeNull();
    expect(screen.queryByText('No data quality issues')).toBeNull();
    expect(screen.getByText('checking')).toBeTruthy();
    expect(screen.queryByText('Could not load data quality report')).toBeNull();
  });

  it('keeps a loaded empty scan perfect', () => {
    // WHY: a settled scan with no issues is a perfect score. That copy stays.
    quality({ issues: [] });
    render(<DataQualitySection />);

    expect(screen.getAllByText('100/100').length).toBeGreaterThan(0);
    expect(screen.getByText('No data quality issues')).toBeTruthy();
    expect(screen.queryByText('not loaded')).toBeNull();
    expect(screen.queryByText('Could not load data quality report')).toBeNull();
  });

  it('keeps a loaded issue', () => {
    // WHY: the demo scan still names the duplicate domain when the read lands.
    quality({ issues: [DUPLICATE] });
    render(<DataQualitySection />);

    expect(screen.getByText('Duplicate domain acme.example')).toBeTruthy();
    expect(screen.getByText('Company: Northwind Demo')).toBeTruthy();
    expect(screen.queryByText('100/100')).toBeNull();
    expect(screen.queryByText('No data quality issues')).toBeNull();
    expect(screen.queryByText('not loaded')).toBeNull();
  });
});
