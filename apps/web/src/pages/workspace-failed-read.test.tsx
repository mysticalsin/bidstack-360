// WHY: Collaborate opens before the module record returns. An unread record
// has no saved URL. The page still said the workspace was not configured yet,
// which is what a loaded off record says. An unread record and a saved off
// record are different. The setup instructions would send an admin to write
// a URL over a page the screen never showed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useAppModules: vi.fn(),
}));

vi.mock('@/hooks/useAppModules', () => ({
  useAppModules: hookMocks.useAppModules,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

import WorkspacePage from './WorkspacePage';

const savedOff = {
  agentStudioEnabled: false,
  appflowyEnabled: false,
  appflowyUrl: null,
  serumEnabled: false,
};

describe('Collaborate workspace unread record', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not present a module load that has not arrived as an unconfigured workspace', () => {
    hookMocks.useAppModules.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: true,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<WorkspacePage />);

    expect(screen.getByText('Checking the saved workspace.')).toBeTruthy();
    expect(screen.queryByText('Workspace not configured yet')).toBeNull();
    expect(screen.queryByText('Could not load the workspace')).toBeNull();
    expect(screen.queryByText(/Enable the Collaborate module/)).toBeNull();
  });

  it('does not call a failed module read an unconfigured workspace', () => {
    const refetch = vi.fn();
    hookMocks.useAppModules.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: true,
      refetch,
    });

    render(<WorkspacePage />);

    expect(screen.getByText('Could not load the workspace')).toBeTruthy();
    expect(screen.getByText('The saved workspace has not arrived.')).toBeTruthy();
    expect(screen.queryByText('Workspace not configured yet')).toBeNull();
    expect(screen.queryByText(/Enable the Collaborate module/)).toBeNull();
    expect(screen.queryByTitle('Collaborative workspace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('still says the workspace is not configured once a saved off record has loaded', () => {
    hookMocks.useAppModules.mockReturnValue({
      data: savedOff,
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<WorkspacePage />);

    expect(screen.getByText('Workspace not configured yet')).toBeTruthy();
    expect(screen.getByText(/Enable the Collaborate module/)).toBeTruthy();
    expect(screen.queryByText('Could not load the workspace')).toBeNull();
    expect(screen.queryByText('Checking the saved workspace.')).toBeNull();
  });

  it('still embeds a saved workspace URL once the module record has loaded', () => {
    hookMocks.useAppModules.mockReturnValue({
      data: {
        ...savedOff,
        appflowyEnabled: true,
        appflowyUrl: 'https://flow.example.test',
      },
      isLoading: false,
      isPending: false,
      isFetching: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<WorkspacePage />);

    expect(screen.getByTitle('Collaborative workspace').getAttribute('src')).toBe(
      'https://flow.example.test',
    );
    expect(screen.getByRole('link', { name: 'Open in new tab' }).getAttribute('href')).toBe(
      'https://flow.example.test',
    );
    expect(screen.queryByText('Workspace not configured yet')).toBeNull();
    expect(screen.queryByText('Could not load the workspace')).toBeNull();
    expect(screen.queryByText('Checking the saved workspace.')).toBeNull();
  });
});
