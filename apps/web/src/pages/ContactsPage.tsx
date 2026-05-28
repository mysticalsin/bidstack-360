import { motion } from 'framer-motion';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ContactCsvImportDialog } from '@/components/contact/ContactCsvImportDialog';
import { ContactDialog } from '@/components/contact/ContactDialog';
import { ContactQuickLook } from '@/components/contact/ContactQuickLook';
import {
  InlineEditNumber,
  InlineEditSelect,
  InlineEditText,
} from '@/components/opportunity/InlineEdit';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { LiquidGlassButton } from '@/components/ui/LiquidGlassButton';
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import {
  useContacts,
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
} from '@/hooks/useContacts';
import { useTableSort } from '@/hooks/useTableSort';
import { downloadCsv, rowsToCsv } from '@/lib/csv';
import { pushUndo } from '@/stores/undoStack';
import type { Contact, Sentiment } from '@bidstack/shared';

const SENTIMENT_TONE: Record<Sentiment, BadgeTone> = {
  hot: 'tomato',
  warm: 'amber',
  neutral: 'gray',
  cold: 'blue',
};

// Module-level constants avoid creating new arrays inside render (stable identity for memoization).
const SENTIMENT_OPTS = [
  { value: 'hot' as Sentiment, label: 'Hot' },
  { value: 'warm' as Sentiment, label: 'Warm' },
  { value: 'neutral' as Sentiment, label: 'Neutral' },
  { value: 'cold' as Sentiment, label: 'Cold' },
];

export function ContactsPage() {
  const [search, setSearch] = useState('');
  // useDeferredValue keeps typing snappy; the table re-renders on the next
  // idle tick rather than on every keystroke.
  const deferredSearch = useDeferredValue(search);
  const [editTarget, setEditTarget] = useState<Contact | null>(null);
  const { data, isLoading, isError, error, refetch } = useContacts({
    search: deferredSearch.trim() || undefined,
  });
  const del = useDeleteContact();
  // A2 — inline cell editing (Twenty pattern). One mutation instance covers
  // the whole table; onMutate fans across every cached contacts list.
  const updateContact = useUpdateContact();
  // Undo path: re-creates the contact from the snapshot we still have in
  // memory after a successful delete. Server treats it as a fresh insert
  // and the audit log captures both events — that's the truth.
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
  // omits the param so plain "/contacts" stays clean.
  type ContactSortKey = keyof typeof accessors;
  const [searchParams, setSearchParams] = useSearchParams();
  const parseSortParam = (
    raw: string | null,
  ): { key: ContactSortKey | null; dir: 'asc' | 'desc' | null } => {
    if (!raw) return { key: null, dir: null };
    const [k, d] = raw.split('.');
    if (!k || !d) return { key: null, dir: null };
    if (!(k in accessors)) return { key: null, dir: null };
    if (d !== 'asc' && d !== 'desc') return { key: null, dir: null };
    return { key: k as ContactSortKey, dir: d };
  };
  const sortState = parseSortParam(searchParams.get('sort'));
  const setSortState = (next: { key: ContactSortKey | null; dir: 'asc' | 'desc' | null }) => {
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

  // Right-click context menu. Coordinates are viewport-relative; the
  // menu closes on click-away, Escape, or pick.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    contact: Contact;
  } | null>(null);

  // macOS-style Quick Look — Space on a focused row peeks the record.
  const [quickLook, setQuickLook] = useState<Contact | null>(null);

  // Vim-style keyboard cursor. `cursorIdx` points at the row that's
  // visually highlighted; j/k (or arrows) move it, Enter opens the edit
  // dialog, x toggles selection. None of this fires when the user is
  // typing in a field. -1 means "no row focused" (initial state).
  //
  // We reset the cursor when the visible list changes (search/sort)
  // using the "compare-prev-during-render" pattern instead of a
  // setState-in-effect — React documents this as the canonical way to
  // derive resettable state without cascading renders.
  const [cursorIdx, setCursorIdx] = useState(-1);
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setCursorIdx(-1);
  }

  // Tracks a pending `g` press for the `gg` chord (jump to top). The global
  // chord nav (gd/go/gp/…) also starts on `g`, but those second keys never
  // collide with `g` itself, so coexistence is safe.
  const pendingG = useRef<number | null>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ⌘E / Ctrl+E opens the edit dialog for the cursor row. Allowed
      // even when modifier keys are otherwise reserved — this is the
      // explicit "edit" shortcut.
      if ((e.metaKey || e.ctrlKey) && e.key === 'e' && cursorIdx >= 0) {
        e.preventDefault();
        const row = items[cursorIdx];
        if (row) setEditTarget(row);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const targetEl = e.target as HTMLElement | null;
      const tag = targetEl?.tagName;
      const inField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || targetEl?.isContentEditable;
      if (inField) return;
      if (items.length === 0) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCursorIdx((i) => Math.min(items.length - 1, i < 0 ? 0 : i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCursorIdx((i) => Math.max(0, i < 0 ? 0 : i - 1));
      } else if (e.key === 'Enter' && cursorIdx >= 0) {
        e.preventDefault();
        const row = items[cursorIdx];
        if (row) setEditTarget(row);
      } else if (e.key === 'x' && cursorIdx >= 0) {
        e.preventDefault();
        const row = items[cursorIdx];
        if (row) toggleOne(row.id);
      } else if (e.key === ' ' && cursorIdx >= 0) {
        // Space = Quick Look toggle. If a peek is already open, close it.
        e.preventDefault();
        if (quickLook) {
          setQuickLook(null);
        } else {
          const row = items[cursorIdx];
          if (row) setQuickLook(row);
        }
      } else if (e.key === 'g') {
        // First or second half of `gg`. ~900ms window matches the global
        // chord-nav window for consistency.
        const now = Date.now();
        if (pendingG.current && now - pendingG.current < 900) {
          e.preventDefault();
          pendingG.current = null;
          setCursorIdx(0);
        } else {
          pendingG.current = now;
        }
      } else if (e.key === 'G') {
        // Shift+g — jump to the bottom of the visible list.
        e.preventDefault();
        setCursorIdx(items.length - 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [items, cursorIdx, quickLook]);

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
      // Same undo body used by both the toast button and the global ⌘Z
      // shortcut. Kept inline rather than extracted so the snapshot
      // closure stays a normal binding.
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
      // Apple-style "Undo" path: recreating the contact through useCreateContact
      // is the safest restore — we already have the full record in memory and
      // the server treats it as a fresh insert (audit log captures both the
      // delete and the recreate, which is the truth).
      // Same body used by both the toast button and the global ⌘Z hotkey.
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

      {/* aria-live region — announces filter / sort result counts to
          screen readers. Visually hidden; updates only when the count
          actually changes so SR doesn't fire on every keystroke. */}
      <p className="sr-only" role="status" aria-live="polite">
        {search ? (
          <>
            Showing {items.length} of {raw.length} contacts matching {search}.
          </>
        ) : (
          <>Showing {items.length} contacts.</>
        )}
      </p>

      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} columns={8} headless />
        ) : isError ? (
          <ErrorState
            title="Could not load contacts"
            message={error instanceof Error ? error.message : undefined}
            action={
              <Button size="sm" variant="secondary" onClick={() => refetch()}>
                Try again
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={search ? 'No matches' : 'No contacts yet'}
            message={
              search
                ? `Nothing matched "${search}".`
                : 'Add the first decision-maker to start mapping the buying group.'
            }
            action={
              search ? (
                <Button size="sm" variant="secondary" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              ) : (
                <ContactDialog
                  trigger={
                    <Button size="sm" variant="primary">
                      Add first contact
                    </Button>
                  }
                />
              )
            }
          />
        ) : (
          <SpotlightTable
            query={deferredSearch}
            minWidth={980}
            className="[&_tr[data-selected=true]]:bg-[var(--brand-primary-tint)]/60"
          >
            <thead>
              <tr>
                <th scope="col" className="w-10 px-5 py-3">
                  <label className="table-checkbox-hit">
                    <span className="sr-only">
                      {allSelected ? 'Deselect all contacts' : 'Select all contacts'}
                    </span>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        // `indeterminate` is a DOM property, not an HTML attribute,
                        // so React can't set it declaratively. Ref callback fires
                        // on every commit, which is exactly when we want to sync.
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      className="cursor-pointer accent-[var(--brand-primary)]"
                    />
                  </label>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('name', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="name" state={sortState} onChange={setSortState}>
                    Name
                  </SortableHeader>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('role', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="role" state={sortState} onChange={setSortState}>
                    Role
                  </SortableHeader>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('customer', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="customer" state={sortState} onChange={setSortState}>
                    Customer
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  Contact
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('influence', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="influence" state={sortState} onChange={setSortState}>
                    Influence
                  </SortableHeader>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('sentiment', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="sentiment" state={sortState} onChange={setSortState}>
                    Sentiment
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {items.map((c, i) => (
                <SpotlightTableRow
                  key={c.id}
                  query={deferredSearch}
                  searchableText={`${c.name} ${c.role ?? ''} ${c.customer} ${c.email ?? ''} ${c.phone ?? ''} ${c.sentiment ?? ''}`}
                  className="group relative data-[cursor=true]:bg-[var(--surface-sunken)] data-[cursor=true]:shadow-[inset_3px_0_0_var(--brand-primary)]"
                  data-selected={selectedIds.has(c.id) ? 'true' : undefined}
                  data-cursor={i === cursorIdx ? 'true' : undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, contact: c });
                  }}
                >
                  <td className="w-10 px-5 py-3">
                    <label className="table-checkbox-hit">
                      <span className="sr-only">
                        {selectedIds.has(c.id) ? `Deselect ${c.name}` : `Select ${c.name}`}
                      </span>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer accent-[var(--brand-primary)]"
                      />
                    </label>
                  </td>
                  <td className="px-5 py-3">
                    <Link
                      to={`/contacts/${c.id}`}
                      className="rounded font-medium text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                    >
                      {c.name}
                    </Link>
                  </td>
                  {/* A2 — role is inline-editable: click cell to enter text, blur/Enter commits. */}
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">
                    <InlineEditText
                      value={c.role ?? ''}
                      onSave={(next) =>
                        updateContact.mutate({ id: c.id, patch: { role: next || null } })
                      }
                      label={`Edit role for ${c.name}`}
                      placeholder="Add role…"
                      display={(v) => v || <span className="text-[var(--fg-tertiary)]">—</span>}
                    />
                  </td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">{c.customer}</td>
                  <td className="px-5 py-3 text-[var(--fg-secondary)]">
                    <div className="flex flex-col">
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="rounded text-[var(--brand-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
                        >
                          {c.email}
                        </a>
                      ) : null}
                      {c.phone ? (
                        <span className="text-xs text-[var(--fg-tertiary)]">{c.phone}</span>
                      ) : null}
                      {!c.email && !c.phone ? '—' : null}
                    </div>
                  </td>
                  {/* A2 — influence (1–5) is inline-editable. */}
                  <td className="px-5 py-3 tabular-nums text-[var(--fg-primary)]">
                    <InlineEditNumber
                      value={c.influence ?? 0}
                      min={0}
                      max={5}
                      step={1}
                      onSave={(next) =>
                        updateContact.mutate({
                          id: c.id,
                          patch: { influence: next === 0 ? null : next },
                        })
                      }
                      label={`Edit influence for ${c.name}`}
                      display={(v) =>
                        v ? `${v}/5` : <span className="text-[var(--fg-tertiary)]">—</span>
                      }
                    />
                  </td>
                  {/* A2 — sentiment is inline-editable via select. Read mode shows the badge. */}
                  <td className="px-5 py-3">
                    <InlineEditSelect
                      value={c.sentiment ?? ''}
                      options={[{ value: '' as Sentiment, label: '—' }, ...SENTIMENT_OPTS]}
                      onSave={(next) =>
                        updateContact.mutate({
                          id: c.id,
                          patch: { sentiment: (next as Sentiment) || null },
                        })
                      }
                      label={`Edit sentiment for ${c.name}`}
                      display={(v) =>
                        v ? (
                          <Badge tone={SENTIMENT_TONE[v as Sentiment]}>{v}</Badge>
                        ) : (
                          <span className="text-[var(--fg-tertiary)]">—</span>
                        )
                      }
                    />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditTarget(c)}
                        aria-label={`Edit ${c.name}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(c)}
                        disabled={del.isPending}
                        aria-label={`Delete ${c.name}`}
                        className="text-[var(--danger)] hover:text-[var(--danger)]"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </SpotlightTableRow>
              ))}
            </tbody>
          </SpotlightTable>
        )}
      </Card>

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

// Apple-style right-click menu. Positioned at the click coordinates and
// clamped to the viewport so it never overflows. Closes on click-away,
// Escape, or scroll — the latter prevents the menu from drifting away
// from its anchor.
//
// WAI-ARIA Menu pattern (ARIA 1.2 §menu):
//   - role="menu" on the <ul>, role="menuitem" on each <button>.
//   - First item receives focus automatically on mount.
//   - ArrowDown / ArrowUp moves focus between items (wraps around).
//   - Home / End jumps to first / last item.
//   - Tab / Shift+Tab closes the menu (WAI-ARIA menu-button pattern).
//   - Escape closes via the document-level listener below.
function ContactContextMenu({
  x,
  y,
  contact,
  onClose,
  onEdit,
  onDelete,
}: {
  x: number;
  y: number;
  contact: Contact;
  onClose: () => void;
  onEdit: (c: Contact) => void;
  onDelete: (c: Contact) => void;
}) {
  const menuRef = useRef<HTMLUListElement>(null);

  // Move focus to the first menu item when the menu mounts so keyboard
  // users don't have to Tab into the menu manually.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>('[role=menuitem]');
    first?.focus();
  }, []);

  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Clamp to viewport — assume a 200×200 menu, never let the click open
  // a menu that immediately falls off-screen.
  const MENU_W = 220;
  const MENU_H = 200;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success(`Copied ${label}`, { duration: 1500 }),
      () => toast.error('Copy failed'),
    );
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const menuitems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [],
    );
    if (menuitems.length === 0) return;
    const idx = menuitems.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      menuitems[(idx + 1) % menuitems.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      menuitems[(idx - 1 + menuitems.length) % menuitems.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuitems[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      menuitems[menuitems.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // Tab and Shift+Tab both close the menu per the WAI-ARIA menu-button
      // pattern — focus falls through to the next naturally focusable element.
      e.preventDefault();
      onClose();
    }
    // Escape is handled by the document-level keydown listener above.
  };

  return (
    <motion.ul
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${contact.name}`}
      onKeyDown={handleKeyDown}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      style={{ left, top }}
      className="fixed z-[200] w-[220px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] py-1 text-sm shadow-[var(--shadow-lg)]"
      // Catch clicks inside so the document-level mousedown doesn't close
      // the menu before the item's onClick fires.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <ContextItem onClick={() => onEdit(contact)}>Edit contact</ContextItem>
      {contact.email ? (
        <ContextItem onClick={() => copy(contact.email!, 'email')}>Copy email</ContextItem>
      ) : null}
      {contact.phone ? (
        <ContextItem onClick={() => copy(contact.phone!, 'phone')}>Copy phone</ContextItem>
      ) : null}
      <ContextItem onClick={() => onDelete(contact)} tone="danger">
        Delete contact
      </ContextItem>
    </motion.ul>
  );
}

function ContextItem({
  onClick,
  tone,
  children,
}: {
  onClick: () => void;
  tone?: 'danger';
  children: React.ReactNode;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-card)] ${
          tone === 'danger' ? 'text-[var(--danger)]' : 'text-[var(--fg-primary)]'
        }`}
      >
        {children}
      </button>
    </li>
  );
}
