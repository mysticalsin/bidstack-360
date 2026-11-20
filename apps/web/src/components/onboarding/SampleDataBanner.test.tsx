import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), mutate: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/components/ui/ConfirmDialog', () => ({ confirm: mocks.confirm }));
vi.mock('@/components/ui/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useOnboarding', () => ({
  useSampleDataStatus: () => ({ data: { hasSampleData: true } }),
  useDeleteSampleData: () => ({ mutate: mocks.mutate, isPending: false }),
}));

import { SampleDataBanner } from './SampleDataBanner';

beforeEach(() => {
  mocks.confirm.mockReset();
  mocks.mutate.mockReset();
});
afterEach(() => cleanup());

describe('SampleDataBanner', () => {
  it('asks before deleting all demonstration data and does nothing on cancel', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample data' }));
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Delete all demonstration data? This action cannot be undone.',
          destructive: true,
        }),
      ),
    );
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('deletes after the user confirms', async () => {
    mocks.confirm.mockResolvedValue(true);
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove sample data' }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  });
});
