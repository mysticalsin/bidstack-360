import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DustStatus } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

import { DustAgentsCard } from './DustAgentsCard';

const CREDENTIALS = 'Add Dust credentials to list available workspace agents.';
const AVAILABLE = 'Workspace agents available for account data verification workflows';

function status(overrides: Partial<DustStatus> = {}): DustStatus {
  return {
    workspace: 'demo',
    lastSyncAt: null,
    nextSyncAt: null,
    lastError: null,
    pulled24h: 0,
    pushed24h: 0,
    configured: false,
    agentsError: null,
    agents: [],
    ...overrides,
  };
}

describe('Dust agents read', () => {
  afterEach(() => {
    cleanup();
  });

  // A read that has not arrived is not a saved disabled workspace.
  it('does not badge a load in progress as disabled', () => {
    render(<DustAgentsCard isLoading data={undefined} />);

    expect(screen.getByText('Checking Dust agents')).toBeTruthy();
    expect(screen.queryByText('disabled')).toBeNull();
    expect(screen.queryByText(CREDENTIALS)).toBeNull();
    expect(screen.queryByText(AVAILABLE)).toBeNull();
  });

  // A failed read has no workspace status. It is not an unconfigured catalog.
  it('does not tell an admin to add credentials when the read failed', () => {
    render(<DustAgentsCard isLoading={false} data={undefined} />);

    expect(screen.getByText('Could not load Dust agents')).toBeTruthy();
    expect(screen.queryByText('disabled')).toBeNull();
    expect(screen.queryByText(CREDENTIALS)).toBeNull();
    expect(screen.queryByText(AVAILABLE)).toBeNull();
  });

  it('keeps a loaded unconfigured workspace disabled', () => {
    render(<DustAgentsCard isLoading={false} data={status({ configured: false })} />);

    expect(screen.getByText('disabled')).toBeTruthy();
    expect(screen.getByText(CREDENTIALS)).toBeTruthy();
    expect(screen.getByText(AVAILABLE)).toBeTruthy();
  });

  it('keeps a loaded empty catalog empty', () => {
    render(<DustAgentsCard isLoading={false} data={status({ configured: true, agents: [] })} />);

    expect(
      screen.getByText(
        'Dust is configured, but no accessible agents were returned for this workspace.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('configured')).toBeTruthy();
    expect(screen.queryByText('Could not load Dust agents')).toBeNull();
  });

  it('keeps a loaded agent on the card', () => {
    render(
      <DustAgentsCard
        isLoading={false}
        data={status({
          configured: true,
          agents: [{ id: 'ag_1', label: 'Account verifier', description: null }],
        })}
      />,
    );

    expect(screen.getByText('configured')).toBeTruthy();
    expect(screen.getByText('Account verifier')).toBeTruthy();
    expect(screen.queryByText('Could not load Dust agents')).toBeNull();
  });
});
