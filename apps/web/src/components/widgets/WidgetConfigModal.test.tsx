// Regression coverage: WidgetConfigModal used to fire-and-forget onSave and
// close immediately (apps/web/src/pages/AnalyticsDashboardPage.tsx's
// handleAddWidget is async and can reject on a 403/5xx). That made a failed
// "Add widget" look identical to a successful one — the modal vanished with no
// widget and no error. The modal must now await onSave and only close on
// success, keeping the user's config on screen to retry on failure.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WidgetConfigModal } from './WidgetConfigModal';

vi.mock('@/hooks/useAnalyticsReports', () => ({
  useAnalyticsReportsList: vi.fn(() => ({ data: [] })),
}));

afterEach(cleanup);

describe('WidgetConfigModal', () => {
  it('closes only after onSave resolves', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<WidgetConfigModal open onOpenChange={onOpenChange} onSave={onSave} />);

    screen.getByRole('button', { name: 'Save widget' }).click();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog open and re-enables Save when onSave rejects', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn().mockRejectedValue(new Error('Forbidden'));
    render(<WidgetConfigModal open onOpenChange={onOpenChange} onSave={onSave} />);

    screen.getByRole('button', { name: 'Save widget' }).click();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Give the rejected promise's catch/finally a tick to run.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Save widget' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('disables Save and shows "Saving…" while onSave is pending', async () => {
    let resolveSave: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((resolve) => (resolveSave = resolve)));
    render(<WidgetConfigModal open onOpenChange={vi.fn()} onSave={onSave} />);

    screen.getByRole('button', { name: 'Save widget' }).click();

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    resolveSave();
  });
});
