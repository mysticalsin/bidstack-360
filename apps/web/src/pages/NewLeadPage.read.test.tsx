// A paused or in-flight capabilities read has no payload and isLoading false.
// That must not look like the person is denied lead write, the load failed,
// or the create form is already ready.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { NewLeadPage } from './NewLeadPage';

type Manifest = {
  isAdmin: boolean;
  permissions: string[];
};

const caps = vi.hoisted(() => ({
  current: {
    data: undefined as Manifest | null | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
  },
}));

vi.mock('@/hooks/useLeads', () => ({
  useCreateLead: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => caps.current,
  // Mirrors useHasPermission on main: no payload is treated as denied,
  // and a stale manifest is still a grant even when the read failed.
  useHasPermission: (key: string) => {
    const data = caps.current.data;
    if (!data) return false;
    return data.isAdmin || data.permissions.includes(key);
  },
}));

const CHECKING = 'Checking lead access. It has not arrived.';
const FAILED = 'Could not check lead access.';
const DENIED = 'You need lead write access to create a lead.';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function manifest(partial: Partial<Manifest>): Manifest {
  return {
    isAdmin: false,
    permissions: [],
    ...partial,
  };
}

function unread(status: string, isLoading = false) {
  caps.current = {
    data: undefined,
    isLoading,
    isError: false,
    status,
  };
}

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NewLeadPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function expectChecking() {
  expect(screen.getByRole('status').textContent).toContain(CHECKING);
  expect(screen.queryByText(DENIED)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByLabelText(/First name/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /Create lead/i })).toBeNull();
  expect(screen.queryByLabelText(/^Score$/i)).toBeNull();
}

describe('new lead access read', () => {
  afterEach(() => {
    cleanup();
    unread('pending');
  });

  it('does not treat a paused capabilities read as denied', () => {
    unread('idle', false);
    renderPage();
    expectChecking();
  });

  it('does not treat an in-flight capabilities read as denied when isLoading is false', () => {
    unread('pending', false);
    renderPage();
    expectChecking();
  });

  it('does not treat an in-flight capabilities read as only a denial', () => {
    unread('pending', true);
    renderPage();
    expectChecking();
  });

  it('keeps a failed capabilities read on the error when isError is true', () => {
    caps.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
    };
    renderPage();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByLabelText(/First name/i)).toBeNull();
  });

  it('drops a stale grant when isError is true', () => {
    caps.current = {
      data: manifest({ isAdmin: true, permissions: ['leads:write'] }),
      isLoading: false,
      isError: true,
      status: 'error',
    };
    renderPage();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByLabelText(/First name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Create lead/i })).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
  });

  it('drops a stale grant when the status is error and isError is still false', () => {
    caps.current = {
      data: manifest({ isAdmin: true }),
      isLoading: false,
      isError: false,
      status: 'error',
    };
    renderPage();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByLabelText(/First name/i)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
  });

  it('treats a settled null payload as no lead write grant', () => {
    caps.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderPage();
    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByLabelText(/First name/i)).toBeNull();
  });

  it('stays denied when a settled manifest has no lead write grant', () => {
    caps.current = {
      data: manifest({ permissions: ['leads:read'] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderPage();
    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Back to leads/i })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /Create lead/i })).toBeNull();
  });

  it('still shows the create form when lead write has arrived', () => {
    caps.current = {
      data: manifest({ permissions: ['leads:write'] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderPage();
    expect(screen.getByLabelText(/First name/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create lead/i })).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows the create form for an admin with an empty permission list', () => {
    caps.current = {
      data: manifest({ isAdmin: true, permissions: [] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderPage();
    expect(screen.getByRole('button', { name: /Create lead/i })).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('still shows the create form when the first name is blank', () => {
    caps.current = {
      data: manifest({ permissions: ['leads:write'] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderPage();
    const firstName = screen.getByLabelText(/First name/i) as HTMLInputElement;
    expect(firstName.value).toBe('');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
