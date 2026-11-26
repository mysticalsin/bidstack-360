// A paused or in-flight stage-gate read has no setting yet. The section
// said the load failed. That read has not arrived.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  useStageGateMode: vi.fn(),
  useUpdateStageGateMode: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/hooks/useStageGateMode', () => ({
  useStageGateMode: hookMocks.useStageGateMode,
  useUpdateStageGateMode: hookMocks.useUpdateStageGateMode,
}));

vi.mock('@/lib/auth', () => ({
  useIsAdmin: () => true,
}));

vi.mock('@/components/ui/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { StageGateSection } from './StageGateSection';

const CHECKING = 'Checking stage-gate enforcement. The setting has not arrived.';
const FAILED = 'Could not load stage-gate enforcement';
const NONE = 'No stage-gate enforcement is saved.';

function view(mode: 'off' | 'warn' | 'enforce' | null) {
  return { mode };
}

function renderGate(query: {
  data?: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  status?: string;
  error?: Error | null;
}) {
  hookMocks.useStageGateMode.mockReturnValue(query);
  hookMocks.useUpdateStageGateMode.mockReturnValue({
    isPending: false,
    mutate: vi.fn(),
  });
  render(<StageGateSection />);
}

describe('StageGateSection read', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not treat a paused stage-gate read as a failed load', () => {
    // WHY: a paused first read has isLoading false and no setting. Could not
    // load is the error. This read has not arrived, and it is not Off.
    renderGate({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByLabelText('Enforcement mode')).toBeNull();
    expect(screen.queryByText('Use server default')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('does not treat an in-flight stage-gate read as a failed load', () => {
    // WHY: a slow read also has no setting, and isLoading can stay false.
    // The load error must not stand in for a read that is still running.
    renderGate({
      data: undefined,
      isLoading: false,
      isFetching: true,
      isError: false,
      status: 'pending',
      error: null,
    });

    expect(screen.getByText(CHECKING)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByLabelText('Enforcement mode')).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('keeps a failed stage-gate read on the error', () => {
    // WHY: a failed read is not an unread pause. Checking must not stand in
    // for the error.
    renderGate({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('gate down'),
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.getByText('gate down')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryByLabelText('Enforcement mode')).toBeNull();
  });

  it('lets a failed read win over a stale off mode', () => {
    // WHY: error wins before a payload. A refetch failure must not keep Off,
    // and it must not say the mode is inherited.
    renderGate({
      data: view('off'),
      isLoading: false,
      isFetching: false,
      isError: true,
      status: 'error',
      error: new Error('gate down'),
    });

    expect(screen.queryByLabelText('Enforcement mode')).toBeNull();
    expect(screen.queryByText('Use server default')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('stays empty when a settled payload is null', () => {
    // WHY: null has arrived. Undefined data is unread. A null payload is not
    // a failed load, and it is not Off.
    renderGate({
      data: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect(screen.getByText(NONE)).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('Try again shortly.')).toBeNull();
    expect(screen.queryByLabelText('Enforcement mode')).toBeNull();
    expect(screen.queryByText('Use server default')).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded stage-gate mode', () => {
    // WHY: a loaded payload stays. The unread line must not replace a mode
    // the read already returned.
    renderGate({
      data: view('warn'),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Enforcement mode') as HTMLSelectElement).value).toBe('warn');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('still shows a loaded off mode', () => {
    // WHY: Off is a saved choice. Unread must not paint Off, and a loaded Off
    // must not be replaced by the unread line.
    renderGate({
      data: view('off'),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Enforcement mode') as HTMLSelectElement).value).toBe('off');
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('still shows a loaded mode that inherits the server default', () => {
    // WHY: a null mode is loaded data. It means inherit, not Off, and not a
    // missing payload. Unread must not drop it.
    renderGate({
      data: view(null),
      isLoading: false,
      isFetching: false,
      isError: false,
      status: 'success',
      error: null,
    });

    expect((screen.getByLabelText('Enforcement mode') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('Use server default')).toBeTruthy();
    expect(screen.queryByText(CHECKING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(NONE)).toBeNull();
  });
});
