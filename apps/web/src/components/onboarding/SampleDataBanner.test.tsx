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

// A seller reading the notice must not be told the workspace is a sample or a demo.
// Fixture rows stay sample on the server. The destructive sentence is pinned in
// DESIGN.md 9.5 and is the only place that sentence may still say demonstration.
const DEMO_COPY = /sample|demo|sandbox|illustrative|not live/i;

describe('onboarding reference copy', () => {
  it('calls fixture rows Reference and does not call them Sample, demo, or live', () => {
    render(<SampleDataBanner />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Reference/);
    expect(text).toMatch(/reference record/i);
    expect(text).not.toMatch(DEMO_COPY);
    expect(text).not.toMatch(/\blive\b/i);
  });

  it('names the remove action as reference records and keeps the pinned warning', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    const arg = mocks.confirm.mock.calls[0]?.[0] as {
      title: string;
      description: string;
      confirmLabel: string;
    };
    expect(arg.title).toBe('Remove reference records');
    expect(arg.confirmLabel).toBe('Remove reference records');
    expect(arg.title).not.toMatch(DEMO_COPY);
    expect(arg.confirmLabel).not.toMatch(DEMO_COPY);
    expect(arg.description).toBe('Delete all demonstration data? This action cannot be undone.');
  });
});

describe('SampleDataBanner', () => {
  it('asks before deleting all demonstration data and does nothing on cancel', async () => {
    mocks.confirm.mockResolvedValue(false);
    render(<SampleDataBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove reference records' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Remove reference records' }));
    await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));
  });
});
