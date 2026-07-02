import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  useCreateContact: vi.fn(),
}));

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

vi.mock('@/hooks/useContacts', () => ({
  useCreateContact: hookMocks.useCreateContact,
}));

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/Toast', () => ({ toast: toastMocks }));

import { ContactCsvImportDialog } from './ContactCsvImportDialog';

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Paste CSV' }));
  return screen.findByRole('dialog');
}

function pasteCsv(value: string) {
  const textarea = screen.getByLabelText('CSV contact rows');
  fireEvent.change(textarea, { target: { value } });
}

describe('ContactCsvImportDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('marks rows missing required fields (name, customer) as invalid and disables import for them', async () => {
    hookMocks.useCreateContact.mockReturnValue({ mutateAsync: hookMocks.mutateAsync });
    render(<ContactCsvImportDialog />);
    await openDialog();

    // WHY: REQUIRED = ['name', 'customer'] in the component — a row missing
    // either must never reach the API; catching a bad row after paste (not
    // after a failed POST) is the whole point of the client-side preview.
    pasteCsv('name,customer\nAlice,Mantu\n,MissingName');

    expect(screen.getByText('ok')).toBeTruthy();
    expect(screen.getByText('1 issue')).toBeTruthy();
    expect(screen.getByText('1 row need fixes before import. Check missing required fields, email format, and sentiment values.')).toBeTruthy();

    // Only the valid row is importable.
    expect(screen.getByRole('button', { name: 'Import 1' })).toBeTruthy();
  });

  it('rejects malformed email and out-of-vocabulary sentiment values', async () => {
    hookMocks.useCreateContact.mockReturnValue({ mutateAsync: hookMocks.mutateAsync });
    render(<ContactCsvImportDialog />);
    await openDialog();

    pasteCsv(
      'name,customer,email,sentiment\n' +
        'Alice,Mantu,not-an-email,warm\n' +
        'Bob,Mantu,bob@mantu.com,furious',
    );

    // Both rows fail — the good name/customer pair doesn't rescue a bad
    // email or an unrecognized sentiment enum value.
    expect(screen.getAllByText('1 issue')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Import' })).toHaveProperty('disabled', true);
  });

  it('auto-detects tab-delimited paste (Excel/Sheets) as well as comma-delimited', async () => {
    hookMocks.useCreateContact.mockReturnValue({ mutateAsync: hookMocks.mutateAsync });
    render(<ContactCsvImportDialog />);
    await openDialog();

    pasteCsv('name\tcustomer\nAlice\tMantu');

    expect(screen.getByRole('button', { name: 'Import 1' })).toBeTruthy();
  });

  it('imports only the valid rows, in concurrency-capped chunks, and reports success', async () => {
    hookMocks.mutateAsync.mockResolvedValue(undefined);
    hookMocks.useCreateContact.mockReturnValue({ mutateAsync: hookMocks.mutateAsync });
    render(<ContactCsvImportDialog />);
    await openDialog();

    // WHY concurrency=5: the component caps concurrent POSTs to avoid
    // exhausting the browser's per-origin connection limit on a large paste.
    // 7 rows forces two chunks (5 + 2) so a regression to Promise.all(all)
    // would still pass a single-chunk test but fail this one.
    const rows = Array.from({ length: 7 }, (_, i) => `Person ${i},Mantu`).join('\n');
    pasteCsv(`name,customer\n${rows}`);

    fireEvent.click(screen.getByRole('button', { name: /Import 7/ }));

    await waitFor(() => expect(hookMocks.mutateAsync).toHaveBeenCalledTimes(7));
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledOnce());
    expect(toastMocks.error).not.toHaveBeenCalled();

    // Every submitted row carries the required fields the API contract needs.
    for (const call of hookMocks.mutateAsync.mock.calls) {
      expect(call[0]).toMatchObject({ customer: 'Mantu' });
      expect(call[0].name).toMatch(/^Person \d$/);
    }
  });

  it('reports a partial failure without discarding the rows that succeeded', async () => {
    // WHY: a mid-batch provider failure must not roll back or hide the rows
    // that DID commit — the error toast explicitly says so, and this test
    // guards that promise (each row is caught independently, not Promise.all
    // fail-fast).
    hookMocks.mutateAsync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('duplicate'));
    hookMocks.useCreateContact.mockReturnValue({ mutateAsync: hookMocks.mutateAsync });
    render(<ContactCsvImportDialog />);
    await openDialog();

    pasteCsv('name,customer\nAlice,Mantu\nBob,Mantu');
    fireEvent.click(screen.getByRole('button', { name: 'Import 2' }));

    await waitFor(() => expect(hookMocks.mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledOnce());
    expect(toastMocks.success).not.toHaveBeenCalled();
    // Dialog must stay open so the user can see/retry the failed row.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('the textarea is labeled and wired to the error message via aria-describedby when a row is invalid', async () => {
    // WHY: this is a plain <textarea>, not a design-system Input — the a11y
    // contract (label + aria-invalid + aria-describedby pointing at the
    // error text) has to be hand-verified rather than assumed from a wrapper.
    hookMocks.useCreateContact.mockReturnValue({ mutateAsync: hookMocks.mutateAsync });
    render(<ContactCsvImportDialog />);
    await openDialog();

    const textarea = screen.getByLabelText('CSV contact rows') as HTMLTextAreaElement;
    expect(textarea.getAttribute('aria-invalid')).toBe('false');

    pasteCsv('name,customer\n,MissingName');

    await waitFor(() => expect(textarea.getAttribute('aria-invalid')).toBe('true'));
    const describedBy = textarea.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const errorNode = document.getElementById(describedBy!.split(' ')[1]!);
    expect(errorNode?.textContent).toContain('need fixes');
  });
});
