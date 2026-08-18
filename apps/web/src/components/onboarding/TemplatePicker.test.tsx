// Regression coverage for the /quick-start "Pick a template pipeline" dialog's
// accessible name — same root cause as CreateEventModal.test.tsx and
// CustomObjectsAdminPage.test.tsx: Modal.tsx used to hand RadixDialog.Content a
// manual `labelId`/aria-labelledby instead of rendering a real
// RadixDialog.Title, so Radix's own a11y check failed on open despite the
// dialog visually having a name.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { TemplatePicker } from './TemplatePicker';
import { useInstallTemplate, useTemplates } from '@/hooks/useOnboarding';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/hooks/useOnboarding', () => ({
  useTemplates: vi.fn(),
  useInstallTemplate: vi.fn(),
}));

// Selector-style store (TemplatePicker reads individual slices), mirroring
// the real zustand `useOnboardingStore((s) => s.templatePickerOpen)` calls.
vi.mock('@/stores/onboarding', () => ({
  useOnboardingStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      templatePickerOpen: true,
      closeTemplatePicker: () => {},
      markChecklistItem: () => {},
      setHasSampleData: () => {},
    }),
}));

function renderPicker() {
  return render(
    <MemoryRouter>
      <TemplatePicker />
    </MemoryRouter>,
  );
}

describe('TemplatePicker accessibility', () => {
  beforeEach(() => {
    vi.mocked(useTemplates).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useTemplates>);
    vi.mocked(useInstallTemplate).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useInstallTemplate>);
  });

  afterEach(() => cleanup());

  it('exposes the picker as a named dialog', () => {
    renderPicker();

    expect(screen.getByRole('dialog', { name: 'Choose a starter pipeline' })).toBeTruthy();
  });
});
