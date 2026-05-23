// "Paste a CSV" import flow. Lets the user drop a tab- or comma-separated
// block (typically from Excel / Google Sheets / Notion) and create
// multiple contacts in one round. We parse client-side, preview, and let
// the user confirm before any POST fires — no surprise insert.
//
// Why not a file picker? Most CRM users have the source data already in
// a spreadsheet cell selection — paste is one keystroke fewer than
// "save as CSV → upload file" and works without crossing the OS file
// boundary.

import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { useCreateContact } from '@/hooks/useContacts';
import { springModal } from '@/lib/motion';
import type { ContactCreate, Sentiment } from '@bidstack/shared';

const HEADERS = ['name', 'customer', 'role', 'email', 'phone', 'influence', 'sentiment'] as const;
type Header = (typeof HEADERS)[number];

const REQUIRED: Header[] = ['name', 'customer'];

interface ParsedRow {
  values: Partial<Record<Header, string>>;
  errors: string[];
}

function parseCsv(input: string): { headers: Header[]; rows: ParsedRow[] } {
  const lines = input
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  // Auto-detect comma vs tab — Excel pastes are tab-delimited, web copy
  // is usually comma. Whichever appears more in the first line wins.
  const sep = (lines[0]!.split('\t').length > lines[0]!.split(',').length ? '\t' : ',') as
    | ','
    | '\t';
  const rawHeaders = lines[0]!.split(sep).map((h) => h.trim().toLowerCase());
  // Normalize to the canonical header set; unknown columns are ignored.
  const headers: Header[] = rawHeaders.map((h) => h as Header).filter((h) => HEADERS.includes(h));
  const rows: ParsedRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(sep).map((c) => c.trim());
    const values: Partial<Record<Header, string>> = {};
    rawHeaders.forEach((h, i) => {
      if (HEADERS.includes(h as Header)) {
        values[h as Header] = cells[i] ?? '';
      }
    });
    const errors: string[] = [];
    for (const r of REQUIRED) {
      if (!values[r]) errors.push(`missing ${r}`);
    }
    if (values.email && !/^.+@.+\..+$/.test(values.email)) errors.push('email looks invalid');
    if (
      values.sentiment &&
      !['hot', 'warm', 'neutral', 'cold'].includes(values.sentiment.toLowerCase())
    ) {
      errors.push('sentiment must be hot/warm/neutral/cold');
    }
    rows.push({ values, errors });
  }
  return { headers, rows };
}

interface Props {
  trigger?: React.ReactNode;
}

export function ContactCsvImportDialog({ trigger }: Props) {
  const textareaId = useId();
  const guidanceId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const create = useCreateContact();
  const reduced = useReducedMotion();

  const { headers, rows } = useMemo(() => parseCsv(pasted), [pasted]);
  const importable = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.length - importable.length;

  const reset = () => {
    setPasted('');
  };

  const handleImport = async () => {
    if (importable.length === 0) return;
    let failed = 0;
    await Promise.all(
      importable.map((r) => {
        const v = r.values;
        const body: ContactCreate = {
          name: v.name ?? '',
          customer: v.customer ?? '',
          role: v.role ?? null,
          email: v.email ?? null,
          phone: v.phone ?? null,
          influence: v.influence ? Math.max(0, Math.min(5, Number(v.influence))) : null,
          sentiment: v.sentiment ? (v.sentiment.toLowerCase() as Sentiment) : null,
        };
        return create.mutateAsync(body).catch(() => {
          failed += 1;
        });
      }),
    );
    if (failed === 0) {
      toast.success(`Imported ${importable.length} contact${importable.length === 1 ? '' : 's'}`);
      setOpen(false);
      reset();
    } else {
      toast.error(`${failed} import${failed === 1 ? '' : 's'} failed`, {
        description: 'The successful rows were committed. Review and retry the rest.',
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        {trigger ?? <Button variant="secondary">Paste CSV</Button>}
      </Dialog.Trigger>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
                transition={springModal}
                className="fixed left-1/2 top-1/2 z-50 w-[min(640px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
              >
                <Dialog.Title className="border-b border-[var(--border-subtle)] px-5 py-3 text-sm font-semibold text-[var(--fg-primary)]">
                  Import contacts from CSV
                </Dialog.Title>
                <Dialog.Description className="px-5 pt-3 text-xs text-[var(--fg-secondary)]">
                  Paste a tab- or comma-separated block. First row must be a header — supported
                  columns: <code>name, customer, role, email, phone, influence, sentiment</code>.
                </Dialog.Description>
                <div className="space-y-3 p-5 pt-3">
                  <label
                    htmlFor={textareaId}
                    className="block text-xs font-medium text-[var(--fg-primary)]"
                  >
                    CSV contact rows
                  </label>
                  <p id={guidanceId} className="-mt-2 text-xs text-[var(--fg-secondary)]">
                    Include headers for at least <code>name</code> and <code>customer</code>.
                    Optional headers are <code>role</code>, <code>email</code>, <code>phone</code>,{' '}
                    <code>influence</code>, and <code>sentiment</code>.
                  </p>
                  <textarea
                    id={textareaId}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder={'name,customer,email\nAlice Singh,Mantu,alice@mantu.com'}
                    rows={8}
                    spellCheck={false}
                    aria-describedby={invalidRows > 0 ? `${guidanceId} ${errorId}` : guidanceId}
                    aria-invalid={invalidRows > 0}
                    className="dialog-input w-full font-mono text-xs"
                  />
                  {invalidRows > 0 ? (
                    <p id={errorId} className="text-xs text-[var(--danger)]">
                      {invalidRows} row{invalidRows === 1 ? '' : 's'} need fixes before import.
                      Check missing required fields, email format, and sentiment values.
                    </p>
                  ) : null}
                  {rows.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto rounded-md border border-[var(--border-subtle)] text-xs">
                      <table className="w-full">
                        <thead className="bg-[var(--surface-sunken)] text-[10px] uppercase text-[var(--fg-tertiary)]">
                          <tr>
                            {headers.map((h) => (
                              <th key={h} className="px-2 py-1 text-left font-semibold">
                                {h}
                              </th>
                            ))}
                            <th className="px-2 py-1 text-left font-semibold">status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border-subtle)]">
                          {rows.slice(0, 20).map((r, i) => (
                            <tr key={i}>
                              {headers.map((h) => (
                                <td
                                  key={h}
                                  className="px-2 py-1 text-[var(--fg-primary)] truncate max-w-[140px]"
                                >
                                  {r.values[h] ?? '—'}
                                </td>
                              ))}
                              <td className="px-2 py-1">
                                {r.errors.length === 0 ? (
                                  <span className="text-[var(--success)]">ok</span>
                                ) : (
                                  <span
                                    className="text-[var(--danger)]"
                                    title={r.errors.join('; ')}
                                  >
                                    {r.errors.length} issue{r.errors.length === 1 ? '' : 's'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {rows.length > 20 ? (
                        <div className="bg-[var(--surface-sunken)] px-2 py-1 text-[10px] text-[var(--fg-tertiary)]">
                          Showing first 20 of {rows.length} rows.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] px-5 py-3 text-xs">
                  <span className="text-[var(--fg-tertiary)]">
                    {rows.length > 0
                      ? `${importable.length}/${rows.length} ready to import`
                      : 'Awaiting paste'}
                  </span>
                  <div className="flex gap-2">
                    <Dialog.Close asChild>
                      <Button size="sm" variant="ghost">
                        Cancel
                      </Button>
                    </Dialog.Close>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleImport}
                      disabled={importable.length === 0 || create.isPending}
                    >
                      Import {importable.length || ''}
                    </Button>
                  </div>
                </footer>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
