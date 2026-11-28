// Regression coverage for the /quick-start "Pick a template pipeline" dialog's
// accessible name — same root cause as CreateEventModal.test.tsx and
// CustomObjectsAdminPage.test.tsx: Modal.tsx used to hand RadixDialog.Content a
// manual `labelId`/aria-labelledby instead of rendering a real
// RadixDialog.Title, so Radix's own a11y check failed on open despite the
// dialog visually having a name.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ApiError } from '@/lib/api';
import { TemplatePicker } from './TemplatePicker';
import { useInstallTemplate, useTemplates, type InstallResult } from '@/hooks/useOnboarding';

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: {
    success: (...args: unknown[]) => toastMocks.success(...args),
    error: (...args: unknown[]) => toastMocks.error(...args),
  },
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

// The first-run picker must not tell a seller the starter rows are a sample,
// a demo, or a live pipeline. The installed rows stay fixture data on the server.
const DEMO_COPY = /sample|demo|sandbox|illustrative|not live/i;

const INSTALLED: InstallResult = {
  pipelineId: 'pipe-1',
  stagesCreated: 4,
  dealsCreated: 2,
  leadsCreated: 3,
  tasksCreated: 1,
  notesCreated: 1,
};

function renderWithTemplate() {
  vi.mocked(useTemplates).mockReturnValue({
    data: [
      {
        key: 'B2B_SAAS',
        name: 'B2B SaaS',
        description: 'A starter pipeline for software companies.',
        stageCount: 4,
      },
    ],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useTemplates>);
  renderPicker();
  fireEvent.click(screen.getByRole('button', { name: /B2B SaaS/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Install pipeline' }));
}

describe('template picker reference copy', () => {
  beforeEach(() => {
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
  });

  afterEach(() => cleanup());

  it('introduces starter rows as reference records', () => {
    vi.mocked(useTemplates).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useTemplates>);
    vi.mocked(useInstallTemplate).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useInstallTemplate>);
    renderPicker();
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/reference record/i);
    expect(text).not.toMatch(DEMO_COPY);
    expect(text).not.toMatch(/\blive\b/i);
  });

  it('counts installed rows as reference records', () => {
    const mutate = vi.fn((_template: string, opts: { onSuccess: (result: InstallResult) => void }) => {
      opts.onSuccess(INSTALLED);
    });
    vi.mocked(useInstallTemplate).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useInstallTemplate>);
    renderWithTemplate();
    expect(toastMocks.success).toHaveBeenCalledWith(
      'Pipeline installed',
      expect.objectContaining({
        description: expect.stringMatching(/reference record/i),
      }),
    );
    const description = (toastMocks.success.mock.calls[0]?.[1] as { description: string }).description;
    expect(description).not.toMatch(DEMO_COPY);
    expect(description).not.toMatch(/\blive\b/i);
  });

  it('does not call an existing pipeline live when install conflicts', () => {
    const mutate = vi.fn((_template: string, opts: { onError: (err: unknown) => void }) => {
      opts.onError(new ApiError('exists', 409, null));
    });
    vi.mocked(useInstallTemplate).mockReturnValue({
      mutate,
      isPending: false,
    } as unknown as ReturnType<typeof useInstallTemplate>);
    renderWithTemplate();
    expect(toastMocks.error).toHaveBeenCalledWith(
      'A pipeline is already installed',
      expect.objectContaining({
        description: expect.stringMatching(/reference record/i),
      }),
    );
    const description = (toastMocks.error.mock.calls[0]?.[1] as { description: string }).description;
    expect(description).not.toMatch(DEMO_COPY);
    expect(description).not.toMatch(/\blive\b/i);
  });
});
