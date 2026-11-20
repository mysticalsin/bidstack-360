// Regression coverage: WidgetConfigModal used to fire-and-forget onSave and
// close immediately (apps/web/src/pages/AnalyticsDashboardPage.tsx's
// handleAddWidget is async and can reject on a 403/5xx). That made a failed
// "Add widget" look identical to a successful one — the modal vanished with no
// widget and no error. The modal must now await onSave and only close on
// success, keeping the user's config on screen to retry on failure.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WidgetConfigModal } from './WidgetConfigModal';

const reportMocks = vi.hoisted(() => ({
  useAnalyticsReportsList: vi.fn(() => ({ data: [] as Array<{ id: string; name: string }> })),
}));

vi.mock('@/hooks/useAnalyticsReports', () => ({
  useAnalyticsReportsList: reportMocks.useAnalyticsReportsList,
}));

afterEach(() => {
  cleanup();
  reportMocks.useAnalyticsReportsList.mockReset();
  reportMocks.useAnalyticsReportsList.mockReturnValue({ data: [] });
});

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

  it('does not call the empty report choice a static demo', () => {
    reportMocks.useAnalyticsReportsList.mockReturnValue({
      data: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Open pipeline' }],
    });
    render(<WidgetConfigModal open onOpenChange={vi.fn()} onSave={vi.fn()} />);

    expect(screen.queryByText(/static demo/i)).toBeNull();
  });

  it('does not save a widget when no report is selected', async () => {
    reportMocks.useAnalyticsReportsList.mockReturnValue({
      data: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Open pipeline' }],
    });
    const onSave = vi.fn();
    render(<WidgetConfigModal open onOpenChange={vi.fn()} onSave={onSave} />);

    screen.getByRole('button', { name: 'Save widget' }).click();
    await Promise.resolve();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent ?? '').toMatch(/report/i);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does not save when the org has no reports', async () => {
    reportMocks.useAnalyticsReportsList.mockReturnValue({ data: [] });
    const onSave = vi.fn();
    render(<WidgetConfigModal open onOpenChange={vi.fn()} onSave={onSave} />);

    screen.getByRole('button', { name: 'Save widget' }).click();
    await Promise.resolve();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent ?? '').toMatch(/report/i);
  });
});
