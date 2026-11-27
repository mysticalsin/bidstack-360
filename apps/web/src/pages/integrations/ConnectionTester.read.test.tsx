// A paused or in-flight setup contract has no endpoint yet. "ready to test"
// is a settled guide. A failed read is not a ready tester, including when a
// stale endpoint is still in memory.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationSetupGuide } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, string | number>) => {
      const text = fallback ?? key;
      if (!values) return text;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''));
    },
  }),
}));

import { ConnectionTester } from './ConnectionTester';

const CHECKING = 'Checking the setup contract. The endpoint has not arrived.';
const FAILED = 'Could not load the setup contract.';
const READY = 'ready to test';
const STALE_URL = 'https://stale.example.test/mcp';

function guide(): IntegrationSetupGuide {
  return {
    generatedAt: '2026-11-01T12:00:00.000Z',
    dust: {
      configured: true,
      workspaceId: 'ws_demo',
      dataSourceConfigured: true,
      webhookReceiverUrl: 'https://example.test/dust',
    },
    mcp: {
      publicUrl: STALE_URL,
      healthUrl: 'https://stale.example.test/mcp/health',
      wellKnownUrl: 'https://stale.example.test/.well-known/mcp',
      transport: 'streamable-http',
      configured: true,
      localOnly: false,
      readScopes: ['mcp', 'read'],
      writeScopes: ['mcp', 'write'],
    },
    rest: {
      baseUrl: 'https://stale.example.test/api',
      authHeader: 'Authorization: Bearer',
      recommendedScopes: ['read'],
    },
    webhooks: {
      subscriptionsUrl: 'https://stale.example.test/webhooks',
      receiverUrl: 'https://stale.example.test/receiver',
      requiredHeaders: ['X-Signature'],
      recommendedEvents: ['deal.updated'],
    },
    snippets: {
      dustMcpToolConfig: '{}',
      mcpHealthCheck: 'curl https://stale.example.test/mcp/health',
      restOpportunitySearch: 'curl https://stale.example.test/api',
      webhookReceiver: '{}',
    },
  };
}

function renderTester(options: {
  guide?: IntegrationSetupGuide | null;
  isLoading?: boolean;
  isError?: boolean;
  status?: string;
}) {
  return render(
    <ConnectionTester
      guide={options.guide ?? undefined}
      isLoading={options.isLoading ?? false}
      isError={options.isError}
      status={options.status}
    />,
  );
}

describe('ConnectionTester setup contract read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused setup contract as ready to test', () => {
    // WHY: a paused first read has isLoading false and no endpoint. The
    // tester must not say it is ready, and it must not offer a blank probe.
    renderTester({ guide: undefined, isLoading: false, isError: false, status: 'pending' });

    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Endpoint URL')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight setup contract as ready to test', () => {
    // WHY: a slow read also has no endpoint. A skeleton is not a settled
    // contract, and it is not a failed load.
    renderTester({ guide: undefined, isLoading: true, isError: false, status: 'pending' });

    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Endpoint URL')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat a failed status with isError still false as ready', () => {
    // WHY: status error with isError still false used to keep the ready
    // badge and a stale endpoint. A failed read is not a contract.
    renderTester({
      guide: guide(),
      isLoading: false,
      isError: false,
      status: 'error',
    });

    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByDisplayValue(STALE_URL)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a failed setup contract on the error', () => {
    // WHY: a failed read stays on the error. A ready badge does not stand
    // in for the contract.
    renderTester({ guide: undefined, isLoading: false, isError: true, status: 'error' });

    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.queryByText('Endpoint URL')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('lets a failed setup contract win over a stale endpoint', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing the stale MCP URL from a contract that is no longer the read.
    renderTester({
      guide: guide(),
      isLoading: false,
      isError: true,
      status: 'error',
    });

    expect(screen.queryByDisplayValue(STALE_URL)).toBeNull();
    expect(screen.queryByText(READY)).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('stays ready when a settled setup contract has arrived', () => {
    // WHY: a contract that arrived stays ready to test. A slow network must
    // not be dressed up as ready, and this one must.
    renderTester({
      guide: guide(),
      isLoading: false,
      isError: false,
      status: 'success',
    });

    expect(screen.getByText(READY)).toBeTruthy();
    expect(screen.getByDisplayValue(STALE_URL)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
