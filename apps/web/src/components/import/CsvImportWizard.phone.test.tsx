import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
      if (!vars) return fallback;
      return Object.entries(vars).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
}));

const hookMocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  previewMutate: vi.fn(),
}));

vi.mock('@/hooks/useMigrations', () => ({
  useStartCsvImport: () => ({ mutate: hookMocks.mutate, isPending: false, isError: false }),
  useCancelMigration: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryMigration: () => ({ mutate: vi.fn(), isPending: false }),
  usePreviewCsvImport: () => ({ mutate: hookMocks.previewMutate, isPending: false, isError: false }),
  useParseSpreadsheet: () => ({ mutateAsync: vi.fn() }),
  useMigrationJob: () => ({ data: undefined, isLoading: false }),
  downloadMigrationErrors: vi.fn(),
}));

import { csvCell } from '@/lib/csv';

import { CsvImportWizard } from './CsvImportWizard';

const PHONE = '+33 1 55 00 0100';

describe('CsvImportWizard exported phone', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the demo phone the export printed, not the spreadsheet apostrophe', async () => {
    // WHY: the map sample is the only proof of the column. A demo phone
    // exported with the spreadsheet apostrophe was shown and previewed as
    // that escape, so the number looked like a formula marker.
    render(<CsvImportWizard />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(
      [`name,phone\nAlex O'Brien,${csvCell(PHONE)}\n`],
      'contacts.csv',
      { type: 'text/csv' },
    );
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    fireEvent.change(input);

    expect(await screen.findByText(PHONE)).toBeTruthy();
    expect(screen.getByText("Alex O'Brien")).toBeTruthy();
    expect(screen.queryByText(`'${PHONE}`)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Preview 1 row' }));
    await waitFor(() => expect(hookMocks.previewMutate).toHaveBeenCalledOnce());
    const [previewInput] = hookMocks.previewMutate.mock.calls[0]!;
    expect(previewInput.rows).toEqual([{ name: "Alex O'Brien", phone: PHONE }]);
    expect(hookMocks.mutate).not.toHaveBeenCalled();
  });
});
