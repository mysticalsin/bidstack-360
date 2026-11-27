// Regression coverage for the "New Custom Object" dialog's accessible name.
//
// Same root cause as CreateEventModal.test.tsx: Modal.tsx forwarded a manual
// `labelId` to RadixDialog.Content as aria-labelledby without ever rendering
// a RadixDialog.Title, so Radix logged its "requires a DialogTitle" console
// error on open. Assert via role + accessible name so the test fails again if
// that wiring regresses.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomObjectsAdminPage } from './CustomObjectsAdminPage';
import {
  useCreateCustomObjectDef,
  useCustomObjectDefs,
  useDeleteCustomObjectDef,
} from '@/hooks/useCustomObjects';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/hooks/useCustomObjects', () => ({
  useCustomObjectDefs: vi.fn(),
  useCreateCustomObjectDef: vi.fn(),
  useDeleteCustomObjectDef: vi.fn(),
}));

function renderPage() {
  return render(<CustomObjectsAdminPage />);
}

describe('CustomObjectsAdminPage — create dialog accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCustomObjectDefs).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectDefs>);
    vi.mocked(useCreateCustomObjectDef).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCustomObjectDef>);
    vi.mocked(useDeleteCustomObjectDef).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteCustomObjectDef>);
  });

  afterEach(() => cleanup());

  it('exposes the create dialog under its accessible name once opened', () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'New Object' }));

    expect(screen.getByRole('dialog', { name: 'New Custom Object' })).toBeTruthy();
  });
});

function openCreateDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'New Object' }));
}

function typeInto(name: RegExp, value: string) {
  const input = screen.getByRole('textbox', { name });
  let built = '';
  for (const character of value) {
    built += character;
    fireEvent.change(input, { target: { value: built } });
  }
}

describe('CustomObjectsAdminPage — create form follows a typed label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCustomObjectDefs).mockReturnValue({
      data: { items: [] },
      isLoading: false,
      isError: false,
    } as ReturnType<typeof useCustomObjectDefs>);
    vi.mocked(useCreateCustomObjectDef).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateCustomObjectDef>);
    vi.mocked(useDeleteCustomObjectDef).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useDeleteCustomObjectDef>);
  });

  afterEach(() => cleanup());

  it('fills the API key and plural from the whole label, not the first letter', () => {
    renderPage();
    openCreateDialog();

    // One change event with the full word hides the bug. Admins type.
    typeInto(/singular label/i, 'Bid Asset');

    expect((screen.getByRole('textbox', { name: /API key/i }) as HTMLInputElement).value).toBe(
      'bid_asset',
    );
    expect((screen.getByRole('textbox', { name: /plural label/i }) as HTMLInputElement).value).toBe(
      'Bid Assets',
    );
  });

  it('stops following a field once the admin edits it, and still follows the other', () => {
    renderPage();
    openCreateDialog();
    typeInto(/singular label/i, 'Project');

    fireEvent.change(screen.getByRole('textbox', { name: /API key/i }), {
      target: { value: 'vendor_file' },
    });
    typeInto(/singular label/i, 'Program');

    expect((screen.getByRole('textbox', { name: /API key/i }) as HTMLInputElement).value).toBe(
      'vendor_file',
    );
    expect((screen.getByRole('textbox', { name: /plural label/i }) as HTMLInputElement).value).toBe(
      'Programs',
    );

    fireEvent.change(screen.getByRole('textbox', { name: /plural label/i }), {
      target: { value: 'Program records' },
    });
    typeInto(/singular label/i, 'Portfolio');

    expect((screen.getByRole('textbox', { name: /API key/i }) as HTMLInputElement).value).toBe(
      'vendor_file',
    );
    expect((screen.getByRole('textbox', { name: /plural label/i }) as HTMLInputElement).value).toBe(
      'Program records',
    );
  });

  it('does not keep a cancelled key edit on the next object', () => {
    renderPage();
    openCreateDialog();
    typeInto(/singular label/i, 'Project');
    fireEvent.change(screen.getByRole('textbox', { name: /API key/i }), {
      target: { value: 'custom' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    openCreateDialog();
    typeInto(/singular label/i, 'Vendor');

    expect((screen.getByRole('textbox', { name: /API key/i }) as HTMLInputElement).value).toBe(
      'vendor',
    );
    expect((screen.getByRole('textbox', { name: /plural label/i }) as HTMLInputElement).value).toBe(
      'Vendors',
    );
  });
});
