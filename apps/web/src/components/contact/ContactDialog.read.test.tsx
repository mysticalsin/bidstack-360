// A paused or in-flight access read has no manifest yet. The dialog said the
// caller needs contacts write access. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  query: {
    data: undefined as
      | {
          isAdmin: boolean;
          permissions: string[];
        }
      | null
      | undefined,
    isLoading: false,
    isError: false,
    status: 'pending' as string,
  },
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useHasPermission: (key: string) => {
    const data = hookMocks.query.data;
    if (!data) return false;
    return data.isAdmin || data.permissions.includes(key);
  },
  useCapabilities: () => hookMocks.query,
}));

vi.mock('@/hooks/useContacts', () => ({
  useCreateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateContact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { ContactDialog } from './ContactDialog';

const CHECKING = 'Checking contact access. The permission has not arrived.';
const FAILED = 'Could not load contact access.';
const DENIED = 'You need contacts write access to save this contact.';

function renderDialog() {
  return render(<ContactDialog open onOpenChange={vi.fn()} />);
}

function submitButton() {
  return screen.getByRole('button', { name: /create contact/i }) as HTMLButtonElement;
}

describe('ContactDialog access read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused access read as denied', () => {
    // WHY: a paused first read has isLoading false and no manifest. The
    // write-denied hint is a settled answer. This read has not arrived.
    hookMocks.query = { data: undefined, isLoading: false, isError: false, status: 'pending' };
    renderDialog();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(submitButton().disabled).toBe(true);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not treat an in-flight access read as denied', () => {
    // WHY: a slow read also has no manifest. The denied hint is not a
    // settled refusal, and it is not a failed load.
    hookMocks.query = { data: undefined, isLoading: true, isError: false, status: 'pending' };
    renderDialog();

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(submitButton().disabled).toBe(true);
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('keeps a failed access read on the error', () => {
    // WHY: a failed read is not evidence that the caller lacks contacts write.
    // The error stays, and the denied hint does not stand in for the read.
    hookMocks.query = { data: undefined, isLoading: false, isError: true, status: 'error' };
    renderDialog();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it('lets a failed read win over a stale write grant', () => {
    // WHY: error wins before a payload. A refetch failure must not keep
    // Create contact enabled from a manifest that is no longer the read.
    hookMocks.query = {
      data: { isAdmin: false, permissions: ['contacts:write'] },
      isLoading: false,
      isError: true,
      status: 'error',
    };
    renderDialog();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it('stays denied when a settled read has a null manifest', () => {
    // WHY: a settled null payload is not an unread pause. Undefined data is
    // unread. Null has arrived, and it is not a write grant.
    hookMocks.query = { data: null, isLoading: false, isError: false, status: 'success' };
    renderDialog();

    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(submitButton().disabled).toBe(true);
  });

  it('still explains a settled read that does not grant write', () => {
    // WHY: a loaded manifest without contacts write stays denied. Unread
    // must not look like that refusal, and a real refusal must stay.
    hookMocks.query = {
      data: { isAdmin: false, permissions: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderDialog();

    expect(screen.getByText(DENIED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(submitButton().disabled).toBe(true);
  });

  it('still enables Create contact when the manifest grants write', () => {
    // WHY: a loaded write grant stays. The checking line must not replace a
    // permission the read already returned.
    hookMocks.query = {
      data: { isAdmin: false, permissions: ['contacts:write'] },
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderDialog();

    expect(submitButton().disabled).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still enables Create contact when the manifest says the caller is an admin', () => {
    // WHY: an admin grant stays even when the permission list is empty.
    // Unread must not look like an admin, and a loaded admin grant must stay.
    hookMocks.query = {
      data: { isAdmin: true, permissions: [] },
      isLoading: false,
      isError: false,
      status: 'success',
    };
    renderDialog();

    expect(submitButton().disabled).toBe(false);
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(DENIED)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
