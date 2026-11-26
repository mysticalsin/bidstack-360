// WHY: Settings, SERUM is where an admin turns the control plane on for the
// demo org. The module read had not arrived, and the switch still sat off.
// An unread record and a saved off record are different. Flipping the first
// one writes that off, or its opposite, over the org the screen never showed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useAppModules: vi.fn(),
  useUpdateAppModules: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: hookMocks.useAppModules,
  useUpdateAppModules: hookMocks.useUpdateAppModules,
}));

vi.mock('@/hooks/useSerumStatus', () => ({
  useSerumStatus: () => ({
    data: undefined,
    isLoading: true,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { SerumControlPlaneSection } from './SerumControlPlaneSection';

const savedOff = {
  agentStudioEnabled: false,
  appflowyEnabled: false,
  appflowyUrl: null,
  serumEnabled: false,
};

function idleSave() {
  hookMocks.useUpdateAppModules.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
}

describe('SERUM switch unread settings', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a module load in progress as a saved off switch', () => {
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<SerumControlPlaneSection />);

    expect(screen.queryByRole('switch', { name: 'Enable SERUM Control Plane' })).toBeNull();
    expect(screen.queryByText(/Disabled/)).toBeNull();
    expect(screen.getByText('Checking the saved SERUM switch.')).toBeTruthy();
    expect(screen.queryByText('Could not load the SERUM switch')).toBeNull();
  });

  it('does not offer the switch when the module read failed', () => {
    const refetch = vi.fn();
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    });

    render(<SerumControlPlaneSection />);

    expect(screen.getByText('Could not load the SERUM switch')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Enable SERUM Control Plane' })).toBeNull();
    expect(screen.queryByText(/Disabled/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still shows a saved off switch once the module record has loaded', () => {
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: savedOff,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<SerumControlPlaneSection />);

    expect(screen.getByText(/Disabled/)).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Enable SERUM Control Plane' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.queryByText('Could not load the SERUM switch')).toBeNull();
    expect(screen.queryByText('Checking the saved SERUM switch.')).toBeNull();
  });

  it('still shows a saved on switch once the module record has loaded', () => {
    idleSave();
    hookMocks.useAppModules.mockReturnValue({
      data: { ...savedOff, serumEnabled: true },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<SerumControlPlaneSection />);

    expect(screen.getByText(/Enabled/)).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Enable SERUM Control Plane' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.queryByText(/Disabled/)).toBeNull();
    expect(screen.queryByText('Could not load the SERUM switch')).toBeNull();
  });
});
