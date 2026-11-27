// A source read that has not arrived is not the published catalog.
// SEC EDGAR and the "available" count are only for a settled empty registry.
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AccountCockpitSnapshot, OpenDataSignalsResponse } from '@bidstack/shared';

const hookMocks = vi.hoisted(() => ({
  useOpenDataSignals: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => String(opts?.[token] ?? '')),
  }),
}));

vi.mock('framer-motion', () => {
  const motion = new Proxy(
    {},
    {
      get: () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            whileHover: _whileHover,
            whileTap: _whileTap,
            ...dom
          } = rest;
          return <div {...dom}>{children}</div>;
        },
    },
  );
  return { motion, useReducedMotion: () => true };
});

vi.mock('@/hooks/useOpenDataSignals', () => ({
  useOpenDataSignals: hookMocks.useOpenDataSignals,
}));

import { LiveDataMeshCard } from './LiveDataMeshCard';

const cockpit = {
  company: { name: 'Northwind Demo', legalName: null },
} as AccountCockpitSnapshot;

const dust = {
  id: 'dust',
  name: 'Dust workspace',
  category: 'ai' as const,
  kind: 'credentialed_api' as const,
  status: 'healthy' as const,
  requiresCredential: true,
  sourceUrl: 'https://dust.tt',
  docsUrl: 'https://dust.tt/docs',
  lastCheckedAt: '2026-11-01T00:00:00.000Z',
  message: null,
  capabilities: ['search'],
};

function page(connectors: OpenDataSignalsResponse['connectors']): OpenDataSignalsResponse {
  return {
    generatedAt: '2026-11-01T00:00:00.000Z',
    connectors,
    signals: [],
  };
}

function mockRead(over: { data?: OpenDataSignalsResponse; isLoading: boolean; isError: boolean }) {
  hookMocks.useOpenDataSignals.mockReturnValue({
    data: undefined,
    refetch: vi.fn(),
    ...over,
  });
}

describe('LiveDataMeshCard source read', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not call a source read in progress an available catalog', () => {
    // WHY: the request has not returned. The published names are not a live list.
    mockRead({ isLoading: true, isError: false });
    render(<LiveDataMeshCard cockpit={cockpit} />);

    expect(screen.queryByText('SEC EDGAR')).toBeNull();
    expect(screen.queryByText('Available data sources')).toBeNull();
    expect(screen.queryByText('8 available')).toBeNull();
    expect(screen.getByText('Checking data sources')).toBeTruthy();
    expect(screen.getByText('Checking configured sources...')).toBeTruthy();
  });

  it('does not call a failed source read an available catalog', () => {
    // WHY: a failed read has no registry. Painting SEC EDGAR says the catalog loaded.
    mockRead({ isLoading: false, isError: true });
    render(<LiveDataMeshCard cockpit={cockpit} />);

    expect(screen.queryByText('SEC EDGAR')).toBeNull();
    expect(screen.queryByText('Available data sources')).toBeNull();
    expect(screen.queryByText('8 available')).toBeNull();
    expect(screen.queryByText(/Connector registry loaded/)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Could not load data sources.');
  });

  it('still lists the published sources after a settled empty registry', () => {
    // WHY: an empty settled registry is the catalog of sources that can be set up.
    mockRead({ data: page([]), isLoading: false, isError: false });
    render(<LiveDataMeshCard cockpit={cockpit} />);

    expect(screen.getByText('Available data sources')).toBeTruthy();
    expect(screen.getByText('SEC EDGAR')).toBeTruthy();
    expect(screen.getByText('8 available')).toBeTruthy();
    expect(screen.queryByText('Could not load data sources.')).toBeNull();
  });

  it('still shows a connector the settled read returned', () => {
    mockRead({ data: page([dust]), isLoading: false, isError: false });
    render(<LiveDataMeshCard cockpit={cockpit} />);

    expect(screen.getByText('Dust workspace')).toBeTruthy();
    expect(screen.getByText('Connected data sources')).toBeTruthy();
    expect(screen.queryByText('SEC EDGAR')).toBeNull();
    expect(screen.queryByText('Available data sources')).toBeNull();
  });
});
