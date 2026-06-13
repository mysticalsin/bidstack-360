import { useDeferredValue, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ContactCsvImportDialog } from '@/components/contact/ContactCsvImportDialog';
import { ContactDialog } from '@/components/contact/ContactDialog';
import { ContactQuickLook } from '@/components/contact/ContactQuickLook';
import { Button } from '@/components/ui/Button';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { toast } from '@/components/ui/Toast';
import {
  useContacts,
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
} from '@/hooks/useContacts';
import { useTableSort } from '@/hooks/useTableSort';
import { useCursorPagination } from '@/hooks/useCursorPagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { pushUndo } from '@/stores/undoStack';
import type { Contact } from '@bidstack/shared';

import { ContactContextMenu } from './contacts/ContactContextMenu';
import { ContactTable } from './contacts/ContactTable';
import type { ContactSortKey, ContactSortState } from './contacts/ContactTable';
import { useContactsKeyboard } from './contacts/useContactsKeyboard';

export function ContactsPage() {
  const [search, setSearch] = useState('');
  // useDeferredValue keeps typing snappy; the table re-renders on the next
  // idle tick rather than on every keystroke.
  const deferredSearch = useDeferredValue(search);
  const [editTarget, setEditTarget] = useState<Contact | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Reset to page 1 whenever the result set changes (new search or sort).
  const pager = useCursorPagination(`${deferredSearch}|${searchParams.get('sort') ?? ''}`);
  const { data, isLoading, isError, error, refetch } = useContacts({
    search: deferredSearch.trim() || undefined,
    limit: 50,
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
  });
  const del = useDeleteContact();
  // A2 — inline cell editing (Twenty pattern). One mutation instance covers
  // the whole table; onMutate fans across every cached contacts list.
  const updateContact = useUpdateContact();
  // Undo path: re-creates the contact from the snapshot we still have in
  // memory after a successful delete.
  const createContact = useCreateContact();

  // Memoize so its array identity is stable across renders — the
  // selectedContacts useMemo below lists `items` in its deps and would
  // recompute on every keystroke otherwise.
  const raw = useMemo(() => data?.items ?? [], [data?.items]);

  // Sortable columns. Accessors return string|number|null so the comparator
  // can handle "missing" rows (null influence, null sentiment) without a
  // bespoke check at each call site.
  const accessors = useMemo(
    () => ({
      name: (c: Contact) => c.name,
      role: (c: Contact) => c.role,
      customer: (c: Contact) => c.customer,
      influence: (c: Contact) => c.influence,
      sentiment: (c: Contact) => c.sentiment,
    }),
    [],
  );
  // Persist sort in the URL so a sorted view is back/forward-navigable and
  // shareable. "?sort=name.asc" → key=name, dir=asc. Default (unsorted)
  // omits the param so plain "/contacts" stays clean. (searchParams hoisted
  // above so the cursor pager can key off the sort param.)
  const parseSortParam = (raw: string | null): ContactSortState => {
    if (!raw) return { key: null, dir: null };
    const [k, d] = raw.split('.');
    if (!k || !d) return { key: null, dir: null };
    if (!(k in accessors)) return { key: null, dir: null };
    if (d !== 'asc' && d !== 'desc') return { key: null, dir: null };
    return { key: k as ContactSortKey, dir: d };
  };
  const sortState = parseSortParam(searchParams.get('sort'));
  const setSortState = (next: ContactSortState) => {
    const params = new URLSearchParams(searchParams);
    if (!next.key || !next.dir) params.delete('sort');
    else params.set('sort', `${next.key}.${next.dir}`);
    setSearchParams(params, { replace: true });
  };
  const { sorted: items } = useTableSort(raw, accessors, {
    state: sortState,
    onChange: setSortState,
  });

  // Bulk selection state. Keyed by contact id; toggling header checkbox
  // flips every visible row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const allSelected = items.length > 0 && items.every((c) => selectedIds.has(c.id));
  const someSelected = !allSelected && items.some((c) => selectedIds.has(c.id));

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds((prev) => {
      // If everything is already selected, clear. Otherwise select all.
      if (items.every((c) => prev.has(c.id))) return new Set();
      return new Set(items.map((c) => c.id));
    });

  const clearSelection = () => setSelectedIds(new Set());

  // Memoize the selection-derived list so the toolbar doesn't recompute on
  // every keystroke in the search input.
  const selectedContacts = useMemo(
    () => items.filter((c) => selectedIds.has(c.id)),
    [items, selectedIds],
  );

  // Right-click context menu. Coordinates are viewport-relative; the menu
  // closes on click-away, Escape, or pick.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    contact: Contact;
  } | null>(null);

  // macOS-style Quick Look — Space on a focused row peeks the record.
  const [quickLook, setQuickLook] = useState<Contact | null>(null);

  // Vim-style keyboard cursor. Reset when the visible list changes (search/sort)
  // using the "compare-prev-during-render" pattern — React's canonical way to
  // derive resettable state without cascading renders.
  const [cursorIdx, setCursorIdx] = useState(-1);
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setCursorIdx(-1);
  }

  // j/k navigation, gg/G chords, Enter/x/Space shortcuts — see useContactsKeyboard.
  useContactsKeyboard({
    items,
    cursorIdx,
    setCursorIdx,
    setEditTarget,
    toggleOne,
    quickLook,
    setQuickLook,
  });

  const bulkDelete = async () => {
    if (selectedContacts.length === 0) return;
    const ok = await confirm({
      title: `Delete ${selectedContacts.length} contact${selectedContacts.length === 1 ? '' : 's'}?`,
      description:
        'They will be removed from any linked bids. The audit log records each deletion.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const snapshot = [...selectedContacts];
    clearSelection();
    let failed = 0;
    await Promise.all(
      snapshot.map((c) =>
        del.mutateAsync(c.id).catch(() => {
          failed += 1;
        }),
      ),
    );
    if (failed === 0) {
      // Same undo body used by both the toast button and the global ⌘Z shortcut.
      const undoBulk = () => {
        for (const c of snapshot) {
          createContact.mutate({
            customer: c.customer,
            name: c.name,
            role: c.role,
            email: c.email,
            phone: c.phone,
            influence: c.influence,
            sentiment: c.sentiment,
          });
        }
        toast.success(`Restored ${snapshot.length} contact${snapshot.length === 1 ? '' : 's'}`);
      };
      pushUndo(`Deleted ${snapshot.length} contacts`, undoBulk);
      toast.success(`Deleted ${snapshot.length} contact${snapshot.length === 1 ? '' : 's'}`, {
        duration: 6500,
        action: { label: 'Undo', onClick: undoBulk },
      });
    } else {
      toast.error(`${failed} delete${failed === 1 ? '' : 's'} failed`, {
        description: 'The successful deletions were committed; try again for the remainder.',
      });
    }
  };

  const exportCsv = (rows: ReadonlyArray<Contact>) => {
    if (rows.length === 0) {
      toast.info('Nothing to export');
      return;
    }
    const csv = rowsToCsv(rows, [
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'customer', label: 'Customer' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'influence', label: 'Influence' },
      { key: 'sentiment', label: 'Sentiment' },
      { key: 'createdAt', label: 'Created at' },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`bidstack-contacts-${stamp}`, csv);
    toast.success(`Exported ${rows.length} contact${rows.length === 1 ? '' : 's'}`);
  };

  const onDelete = async (c: Contact) => {
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      description: 'This also removes them from any linked bids. The audit log keeps a record.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(c.id);
      // Apple-style "Undo": recreating through useCreateContact is the safest
      // restore — we have the full record in memory and the audit log captures
      // both the delete and the recreate.
      const undoSingle = () => {
        createContact.mutate(
          {
            customer: c.customer,
            name: c.name,
            role: c.role,
            email: c.email,
            phone: c.phone,
            influence: c.influence,
            sentiment: c.sentiment,
          },
          {
            onSuccess: () => toast.success(`Restored ${c.name}`),
            onError: (err) =>
              toast.error('Could not restore', {
                description:
                  err instanceof Error ? err.message : 'The server rejected the request.',
              }),
          },
        );
      };
      pushUndo(`Deleted ${c.name}`, undoSingle);
      toast.success(`Deleted ${c.name}`, {
        duration: 6500,
        action: { label: 'Undo', onClick: undoSingle },
      });
    } catch (err) {
      toast.error('Delete failed', {
        description: err instanceof Error ? err.message : 'The server rejected the request.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight gradient-text">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-[var(--fg-secondary)]">
            {items.length} {items.length === 1 ? 'person' : 'people'} in the decision unit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ContactCsvImportDialog
            trigger={
              <Button size="sm" variant="secondary" aria-label="Import contacts from CSV">
                Import CSV
              </Button>
            }
          />
          <LiquidGlassButton
            tone="secondary"
            size="sm"
            onClick={() => exportCsv(items)}
            disabled={items.length === 0}
            aria-label="Export all visible contacts as CSV"
          >
            <Icon name="download" size={14} />
            Export CSV
          </LiquidGlassButton>
          <ContactDialog
            trigger={
              <Button size="sm" variant="primary" aria-label="Create a new contact">
                <Icon name="plus" size={14} />
                New contact
              </Button>
            }
          />
        </div>
      </header>

      {/* Bulk-action toolbar — only mounted when the user has a selection.
          Sits above the table so it doesn't displace any row. */}
      <BulkActionBar
        count={selectedContacts.length}
        onExport={() => exportCsv(selectedContacts)}
        onDelete={bulkDelete}
        onClear={clearSelection}
        isDeleting={del.isPending}
      />

      <div className="flex items-center gap-2">
        <div className="relative max-w-md flex-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, customer, email, role…"
            aria-label="Search contacts"
            className="dialog-input w-full pr-9"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            >
              <Icon name="close" size={14} ariaHidden />
            </button>
          ) : null}
        </div>
      </div>

      {/* aria-live region + data table — extracted to ContactTable for size. */}
      <ContactTable
        items={items}
        raw={raw}
        search={search}
        setSearch={setSearch}
        deferredSearch={deferredSearch}
        isLoading={isLoading}
        isError={isError}
        error={error}
        refetch={refetch}
        cursorIdx={cursorIdx}
        selectedIds={selectedIds}
        allSelected={allSelected}
        someSelected={someSelected}
        toggleOne={toggleOne}
        toggleAll={toggleAll}
        sortState={sortState}
        setSortState={setSortState}
        updateContact={updateContact}
        del={del}
        setEditTarget={setEditTarget}
        onDelete={onDelete}
        setContextMenu={setContextMenu}
      />

      <CursorPager
        currentPage={pager.page}
        hasNext={Boolean(data?.nextCursor)}
        hasPrevious={pager.hasPrevious}
        isLoading={isLoading}
        itemCount={items.length}
        label="contacts"
        onNext={() => pager.goNext(data?.nextCursor)}
        onPrevious={pager.goPrevious}
      />

      {/* Controlled edit dialog — single instance, re-seeded by the
          ContactDialog's open effect when editTarget changes. */}
      {editTarget ? (
        <ContactDialog
          contact={editTarget}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
        />
      ) : null}

      <ContactQuickLook contact={quickLook} onClose={() => setQuickLook(null)} />

      {contextMenu ? (
        <ContactContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          contact={contextMenu.contact}
          onClose={() => setContextMenu(null)}
          onEdit={(c) => {
            setContextMenu(null);
            setEditTarget(c);
          }}
          onDelete={(c) => {
            setContextMenu(null);
            void onDelete(c);
          }}
        />
      ) : null}
    </div>
  );
}
