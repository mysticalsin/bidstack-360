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
