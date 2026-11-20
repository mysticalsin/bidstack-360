// WHY: the data residency tag decides which storage bucket an org's exports
// land in once enforcement is on. The control must send null (not '') for
// "not pinned", be read-only for non-admins, and say plainly what the tag does
// not cover yet so nobody reads it as a full residency guarantee.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}));

const authMocks = vi.hoisted(() => ({ useIsAdmin: vi.fn(() => true) }));
vi.mock('@/lib/auth', () => authMocks);

const residencyMocks = vi.hoisted(() => ({
  state: {
    data: { region: null as string | null, enforced: false, regionalStorage: false },
    isLoading: false,
    isError: false,
    error: null,
  },
  updateMutate: vi.fn(),
}));
vi.mock('@/hooks/useDataResidency', () => ({
  useDataResidency: () => residencyMocks.state,
  useUpdateDataResidency: () => ({ mutate: residencyMocks.updateMutate, isPending: false }),
}));

import { DataResidencySection } from './DataResidencySection';

const select = () => screen.getByLabelText('Data region') as HTMLSelectElement;
const saveButton = () => screen.getByRole('button', { name: 'Save data region' });

describe('DataResidencySection', () => {
  beforeEach(() => {
    authMocks.useIsAdmin.mockReturnValue(true);
    residencyMocks.state = {
      data: { region: null, enforced: false, regionalStorage: false },
      isLoading: false,
      isError: false,
      error: null,
    };
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers not pinned plus the four regions and opens on the stored value', () => {
    residencyMocks.state.data.region = 'eu';
    render(<DataResidencySection />);
    expect(Array.from(select().options).map((o) => o.value)).toEqual(['', 'eu', 'uk', 'us', 'ca']);
    expect(select().value).toBe('eu');
  });

  it('sends the chosen region, and null when unpinned', () => {
    render(<DataResidencySection />);
    fireEvent.change(select(), { target: { value: 'ca' } });
    fireEvent.click(saveButton());
    expect(residencyMocks.updateMutate).toHaveBeenCalledWith({ region: 'ca' }, expect.anything());
  });

  it('sends null when set back to not pinned', () => {
    residencyMocks.state.data.region = 'us';
    render(<DataResidencySection />);
    fireEvent.change(select(), { target: { value: '' } });
    fireEvent.click(saveButton());
    expect(residencyMocks.updateMutate).toHaveBeenCalledWith({ region: null }, expect.anything());
  });

  it('is read-only for a non-admin', () => {
    authMocks.useIsAdmin.mockReturnValue(false);
    render(<DataResidencySection />);
    expect(select().disabled).toBe(true);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('states what the tag does not enforce yet', () => {
    render(<DataResidencySection />);
    expect(screen.getByText(/not enforced yet/i)).toBeTruthy();
  });
});
