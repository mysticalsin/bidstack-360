// Regression coverage for the stage-gate enforcement setting.
//
// WHY: the API has enforced the Amaris stage gate since it shipped, but the
// per-org mode could only be changed by an env var — there was no screen. The
// nullable contract is the sharp edge: `null` means "inherit the deployment
// default", NOT "off", so the control needs a fourth option and must send null
// (never the empty string) back to the server.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (str, [k, v]) => str.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
    i18n: { language: 'en' },
  }),
}));

const authMocks = vi.hoisted(() => ({ useIsAdmin: vi.fn(() => true) }));
vi.mock('@/lib/auth', () => authMocks);

const gateMocks = vi.hoisted(() => ({
  state: { data: { mode: null as string | null }, isLoading: false, isError: false, error: null },
  updateMutate: vi.fn(),
}));
vi.mock('@/hooks/useStageGateMode', () => ({
  useStageGateMode: () => gateMocks.state,
  useUpdateStageGateMode: () => ({ mutate: gateMocks.updateMutate, isPending: false }),
}));

import { StageGateSection } from './StageGateSection';

const select = () => screen.getByLabelText('Enforcement mode') as HTMLSelectElement;
const saveButton = () => screen.getByRole('button', { name: 'Save stage-gate enforcement' });

describe('StageGateSection', () => {
  beforeEach(() => {
    authMocks.useIsAdmin.mockReturnValue(true);
    gateMocks.state = { data: { mode: null }, isLoading: false, isError: false, error: null };
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers inherit plus the three modes, and opens on the stored value', () => {
    gateMocks.state.data = { mode: 'warn' };
    render(<StageGateSection />);
    expect(Array.from(select().options).map((o) => o.value)).toEqual([
      '',
      'off',
      'warn',
      'enforce',
    ]);
    expect(select().value).toBe('warn');
  });

  it('sends null — not an empty string — when set back to the server default', () => {
    gateMocks.state.data = { mode: 'enforce' };
    render(<StageGateSection />);
    fireEvent.change(select(), { target: { value: '' } });
    fireEvent.click(saveButton());
    expect(gateMocks.updateMutate).toHaveBeenCalledWith({ mode: null }, expect.anything());
  });

  it('sends the chosen mode', () => {
    render(<StageGateSection />);
    fireEvent.change(select(), { target: { value: 'enforce' } });
    fireEvent.click(saveButton());
    expect(gateMocks.updateMutate).toHaveBeenCalledWith({ mode: 'enforce' }, expect.anything());
  });

  it('disables saving when nothing changed', () => {
    gateMocks.state.data = { mode: 'warn' };
    render(<StageGateSection />);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('is read-only for a non-admin', () => {
    authMocks.useIsAdmin.mockReturnValue(false);
    render(<StageGateSection />);
    expect(select().disabled).toBe(true);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText('Stage-gate enforcement is read-only unless you are an admin.'),
    ).toBeTruthy();
  });

  it('surfaces a load failure instead of rendering an empty control', () => {
    gateMocks.state = {
      data: { mode: null },
      isLoading: false,
      isError: true,
      error: null,
    };
    render(<StageGateSection />);
    expect(screen.getByText('Could not load stage-gate enforcement')).toBeTruthy();
    expect(screen.queryByLabelText('Enforcement mode')).toBeNull();
  });
});
