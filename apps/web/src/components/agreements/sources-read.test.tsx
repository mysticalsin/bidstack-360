import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const sourceMocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useAgreementSources: vi.fn(),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: () => true,
}));

vi.mock('@/hooks/useMsaWhitespace', () => ({
  useAgreementSources: sourceMocks.useAgreementSources,
  useSyncAgreementSource: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SourcesPanel } from './SourcesPanel';

const LEGAL = {
  id: 'f0000000-0000-4000-8000-000000000001',
  kind: 'sharepoint' as const,
  name: 'Legal library',
  enabled: true,
  config: {},
  connectionId: null,
  configured: true,
  lastSyncAt: '2026-11-06T10:00:00.000Z',
  lastRun: {
    runId: 'r1',
    sourceId: 'f0000000-0000-4000-8000-000000000001',
    state: 'completed' as const,
    startedAt: '2026-11-06T10:00:00.000Z',
    finishedAt: '2026-11-06T10:01:00.000Z',
    result: { new: 3, updated: 1, skipped: 4, failed: 0 },
    reasons: [],
  },
};

function sources(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: sourceMocks.refetch,
    ...overrides,
  };
}

describe('SourcesPanel read honesty', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not treat sources that have not arrived as no sources', () => {
    // WHY: the panel hides when items is empty. A query that is still in
    // flight has no items yet, and that is not a workspace with no connectors.
    sourceMocks.useAgreementSources.mockReturnValue(sources({ isLoading: true }));

    render(<SourcesPanel />);

    expect(screen.getByText('Checking agreement sources. They have not arrived.')).toBeTruthy();
    expect(screen.queryByTestId('agreement-source')).toBeNull();
    expect(screen.queryByText(/no sources/i)).toBeNull();
  });

  it('does not treat a failed sources read as no sources', () => {
    // WHY: a failed /api/msa/sources must not disappear. An admin would
    // otherwise think SharePoint and DocuSign were never connected.
    sourceMocks.useAgreementSources.mockReturnValue(sources({ isError: true }));

    render(<SourcesPanel />);

    expect(screen.getByRole('alert').textContent).toContain('Could not load agreement sources.');
    expect(screen.getByRole('alert').textContent).toContain('The sources have not arrived.');
    expect(screen.queryByTestId('agreement-source')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(sourceMocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the last sources when a refresh fails', () => {
    // WHY: a refresh that fails after Legal library arrived is not a new empty
    // connector list. The last source stays, and the failed read is named.
    sourceMocks.useAgreementSources.mockReturnValue(
      sources({ isError: true, data: { items: [LEGAL] } }),
    );

    render(<SourcesPanel />);

    expect(screen.getByText('Legal library')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Could not refresh agreement sources.');
    expect(screen.getByRole('alert').textContent).toContain('The latest read has not arrived.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(sourceMocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('still hides the panel after a settled read with no sources', () => {
    sourceMocks.useAgreementSources.mockReturnValue(sources({ data: { items: [] } }));

    const { container } = render(<SourcesPanel />);

    expect(container.textContent).toBe('');
    expect(screen.queryByText(/has not arrived/)).toBeNull();
  });

  it('shows a source once the read arrives', () => {
    sourceMocks.useAgreementSources.mockReturnValue(sources({ data: { items: [LEGAL] } }));

    render(<SourcesPanel />);

    expect(screen.getByText('Legal library')).toBeTruthy();
    expect(screen.getByText(/3 new/)).toBeTruthy();
    expect(screen.queryByText(/has not arrived/)).toBeNull();
  });
});
