// A paused or in-flight setup guide read has no contract yet. The card
// called that a failed load. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IntegrationSetupGuide } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      let text = fallback ?? key;
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          text = text.replaceAll(`{{${name}}}`, String(value));
        }
      }
      return text;
    },
  }),
}));

import { ConnectionCommandCenter } from './ConnectionCommandCenter';

const CHECKING = 'Checking the setup guide. The contract has not arrived.';
const FAILED = 'Could not load setup guide';
const CENTER = 'Connection command center';
const PATH = 'MCP server';
const NEEDS_SETUP = 'needs setup';
const NEEDS_KEY = 'Needs key';
const DUST_OFF = 'off';
const DUST_READY = 'Ready';

function guide(mcpConfigured: boolean): IntegrationSetupGuide {
  return {
    generatedAt: '2026-11-01T12:00:00.000Z',
    dust: {
      configured: mcpConfigured,
      workspaceId: mcpConfigured ? 'ws_demo' : null,
      dataSourceConfigured: mcpConfigured,
      webhookReceiverUrl: 'https://example.test/dust',
    },
    mcp: {
      publicUrl: 'https://example.test/mcp',
      healthUrl: 'https://example.test/mcp/health',
      wellKnownUrl: 'https://example.test/.well-known/mcp',
      transport: 'streamable-http',
      configured: mcpConfigured,
      localOnly: false,
      readScopes: ['mcp', 'read'],
      writeScopes: ['mcp', 'write'],
    },
    rest: {
      baseUrl: 'https://example.test/api',
      authHeader: 'Authorization: Bearer',
      recommendedScopes: ['read'],
    },
    webhooks: {
      subscriptionsUrl: 'https://example.test/webhooks',
      receiverUrl: 'https://example.test/receiver',
      requiredHeaders: ['X-Signature'],
      recommendedEvents: ['deal.updated', 'bid.created', 'proposal.sent'],
    },
    snippets: {
      dustMcpToolConfig: '{}',
      mcpHealthCheck: 'curl https://example.test/mcp/health',
      restOpportunitySearch: 'curl https://example.test/api',
      webhookReceiver: '{}',
    },
  };
}

function renderCenter(options: {
  guide?: IntegrationSetupGuide;
  isLoading: boolean;
  isError: boolean;
  dustConfigured?: boolean;
  dustAgents?: number;
}) {
  return render(
    <ConnectionCommandCenter
      guide={options.guide}
      isLoading={options.isLoading}
      isError={options.isError}
      onRetry={() => undefined}
      dustConfigured={options.dustConfigured ?? false}
      dustAgents={options.dustAgents ?? 0}
    />,
  );
}

describe('ConnectionCommandCenter setup guide read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused setup guide read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no contract. Could
    // not load setup guide is a failed read. The contract has not arrived.
    renderCenter({ guide: undefined, isLoading: false, isError: false });

    expect(screen.queryByRole('heading', { name: CENTER })).toBeNull();
    expect(screen.queryByRole('heading', { name: PATH })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(FAILED)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(NEEDS_SETUP)).toBeNull();
    expect(screen.queryByText(NEEDS_KEY)).toBeNull();
    expect(screen.queryByText(DUST_OFF)).toBeNull();
  });

  it('does not treat an in-flight setup guide read as a failed load', () => {
    // WHY: a slow read also has no contract. A skeleton with no status is
    // not a settled guide, and it is not a failed load.
    renderCenter({ guide: undefined, isLoading: true, isError: false });

    expect(screen.queryByRole('heading', { name: CENTER })).toBeNull();
    expect(screen.queryByRole('heading', { name: PATH })).toBeNull();
    expect(screen.getAllByText(CHECKING).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(FAILED)).toHaveLength(0);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryByText(NEEDS_SETUP)).toBeNull();
    expect(screen.queryByText(NEEDS_KEY)).toBeNull();
    expect(screen.queryByText(DUST_OFF)).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed setup guide read on the error', () => {
    // WHY: a failed read is not evidence that the contract is missing. The
    // error stays, and a blank card does not stand in for the guide.
    renderCenter({ guide: undefined, isLoading: false, isError: true });

    expect(screen.queryByRole('heading', { name: CENTER })).toBeNull();
    expect(screen.queryByRole('heading', { name: PATH })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NEEDS_SETUP)).toBeNull();
    expect(screen.queryByText(NEEDS_KEY)).toBeNull();
    expect(screen.queryByText(DUST_OFF)).toBeNull();
  });

  it('lets a failed read win over a stale guide', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // showing a path from a guide that is no longer the read.
    renderCenter({
      guide: guide(true),
      isLoading: false,
      isError: true,
      dustConfigured: true,
      dustAgents: 2,
    });

    expect(screen.queryByRole('heading', { name: CENTER })).toBeNull();
    expect(screen.queryByRole('heading', { name: PATH })).toBeNull();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getAllByText(FAILED).length).toBeGreaterThan(0);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DUST_READY)).toBeNull();
  });

  it('stays on needs setup when a settled guide is not configured', () => {
    // WHY: a guide that arrived and still needs setup stays on that guide.
    // A slow network must not be dressed up as needs setup, and this one must.
    renderCenter({
      guide: guide(false),
      isLoading: false,
      isError: false,
      dustConfigured: false,
      dustAgents: 0,
    });

    expect(screen.getByRole('heading', { name: CENTER })).toBeTruthy();
    expect(screen.getByRole('heading', { name: PATH })).toBeTruthy();
    expect(screen.getAllByText(NEEDS_SETUP).length).toBeGreaterThan(0);
    expect(screen.getByText(NEEDS_KEY)).toBeTruthy();
    expect(screen.getByText(DUST_OFF)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows the setup guide when the contract has arrived', () => {
    // WHY: a loaded guide stays. The unread line must not replace a path
    // the contract already returned.
    renderCenter({
      guide: guide(true),
      isLoading: false,
      isError: false,
      dustConfigured: true,
      dustAgents: 2,
    });

    expect(screen.getByRole('heading', { name: CENTER })).toBeTruthy();
    expect(screen.getByRole('heading', { name: PATH })).toBeTruthy();
    expect(screen.getAllByText('ready').length).toBeGreaterThan(0);
    expect(screen.getAllByText(DUST_READY).length).toBeGreaterThan(0);
    expect(screen.getByText('2 found')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NEEDS_SETUP)).toBeNull();
    expect(screen.queryByText(DUST_OFF)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });
});
