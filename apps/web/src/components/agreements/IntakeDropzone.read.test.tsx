// A paused or in-flight capabilities read has no payload and isLoading false.
// That must not look like upload is denied, the load failed, or the drop
// target is already ready.
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { IntakeDropzone } from './IntakeDropzone';

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

vi.mock('@/hooks/useMsaIntake', () => ({
  useUploadMsaIntake: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

vi.mock('./use-intake-access', () => ({
  useIntakeAccess: () => caps.current,
}));

const CHECKING = 'Checking MSA upload access. It has not arrived.';
const FAILED = 'Could not check MSA upload access.';
const DENIED = 'You can view agreements but not upload them.';
const PARENT_DENIED =
  'You can view agreements but not add them. Ask an admin for the "Agreements: edit" permission.';
const SAMPLE_OFF =
  'Uploading is off in this Sample preview. It turns on once the Agreements service is live on this server.';

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

function renderDropzone(disabledReason?: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <IntakeDropzone disabledReason={disabledReason} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]');
}

function expectChecking(container: HTMLElement) {
  expect(screen.getByRole('status').textContent).toContain(CHECKING);
  expect(screen.queryByText(DENIED)).toBeNull();
  expect(screen.queryByText(PARENT_DENIED)).toBeNull();
  expect(screen.queryByText(SAMPLE_OFF)).toBeNull();
  expect(screen.queryByText(FAILED)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText('Drop PDF or DOCX files here')).toBeNull();
  expect(fileInput(container)).toBeNull();
}

describe('MSA upload access read', () => {
  afterEach(() => {
    cleanup();
    unread('pending');
  });

  it('does not treat a paused capabilities read as denied', () => {
    unread('idle', false);
    const { container } = renderDropzone(PARENT_DENIED);
    expectChecking(container);
  });

  it('does not treat an in-flight capabilities read as denied when isLoading is false', () => {
    unread('pending', false);
    const { container } = renderDropzone(PARENT_DENIED);
    expectChecking(container);
  });

  it('does not treat an in-flight capabilities read as only a denial', () => {
    unread('pending', true);
    const { container } = renderDropzone();
    expectChecking(container);
  });

  it('keeps a failed capabilities read on the error when isError is true', () => {
    caps.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      status: 'error',
    };
    const { container } = renderDropzone(PARENT_DENIED);
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(PARENT_DENIED)).toBeNull();
    expect(fileInput(container)).toBeNull();
  });

  it('drops a stale grant when isError is true', () => {
    caps.current = {
      data: manifest({ isAdmin: true, permissions: ['msa:write'] }),
      isLoading: false,
      isError: true,
      status: 'error',
    };
    const { container } = renderDropzone();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(screen.queryByText('Drop PDF or DOCX files here')).toBeNull();
    expect(fileInput(container)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
  });

  it('drops a stale grant when the status is error and isError is still false', () => {
    caps.current = {
      data: manifest({ isAdmin: true, permissions: ['msa:write'] }),
      isLoading: false,
      isError: false,
      status: 'error',
    };
    const { container } = renderDropzone();
    expect(screen.getByRole('alert').textContent).toContain(FAILED);
    expect(fileInput(container)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
  });

  it('treats a settled null payload as no upload grant', () => {
    caps.current = {
      data: null,
      isLoading: false,
      isError: false,
      status: 'success',
    };
    const { container } = renderDropzone();
    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const input = fileInput(container) as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('stays denied when a settled manifest has no upload grant', () => {
    caps.current = {
      data: manifest({ permissions: ['msa:read'] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    const { container } = renderDropzone();
    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((fileInput(container) as HTMLInputElement).disabled).toBe(true);
  });

  it('still shows the drop target when upload access has arrived', () => {
    caps.current = {
      data: manifest({ permissions: ['msa:write'] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    const { container } = renderDropzone();
    expect(screen.getByText('Drop PDF or DOCX files here')).toBeTruthy();
    expect((fileInput(container) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows the drop target for an admin with an empty permission list', () => {
    caps.current = {
      data: manifest({ isAdmin: true, permissions: [] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    const { container } = renderDropzone();
    expect((fileInput(container) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(CHECKING)).toBeNull();
  });

  it('keeps a settled sample block on that reason', () => {
    caps.current = {
      data: manifest({ permissions: ['msa:write'] }),
      isLoading: false,
      isError: false,
      status: 'success',
    };
    const { container } = renderDropzone(SAMPLE_OFF);
    expect(screen.getByText(SAMPLE_OFF)).toBeTruthy();
    expect((fileInput(container) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
