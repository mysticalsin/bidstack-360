/**
 * ContactTable.tsx — contacts data table (loading / error / empty / populated states).
 *
 * WHY separate from ContactsPage: the table is the heaviest visual section
 * (~260 lines of JSX), contains its own sort headers, inline-edit cells,
 * keyboard-cursor attributes, and row selection. Extracting it keeps the page
 * focused on data-fetching and handler logic.
 *
 * Exports ContactSortKey and ContactSortState so ContactsPage can type its
 * URL-persisted sort state without duplicating the union.
 *
 * Import DAG: no local sibling imports. Imported by ContactsPage.
 */
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { ContactDialog } from '@/components/contact/ContactDialog';
import {
  InlineEditNumber,
  InlineEditSelect,
  InlineEditText,
} from '@/components/opportunity/InlineEdit';
import { TableSkeleton } from '@/components/skeletons/PageSkeletons';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SortableHeader, getSortableHeaderAriaSort } from '@/components/ui/SortableHeader';
import { SpotlightTable, SpotlightTableRow } from '@/components/ui/SpotlightTable';
import { EmptyState, ErrorState } from '@/components/ui/StateMessages';
import type { useDeleteContact, useUpdateContact } from '@/hooks/useContacts';
import type { Contact, Sentiment } from '@bidstack/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContactSortKey = 'name' | 'role' | 'customer' | 'influence' | 'sentiment';
export type ContactSortState = { key: ContactSortKey | null; dir: 'asc' | 'desc' | null };

// ─── Sentiment display maps ───────────────────────────────────────────────────
// Module-level constants avoid creating new arrays inside render (stable
// identity for memoization in cells that receive these as props).

const SENTIMENT_TONE: Record<Sentiment, BadgeTone> = {
  hot: 'tomato',
  warm: 'amber',
  neutral: 'gray',
  cold: 'blue',
};

const SENTIMENT_OPTS = [
  { value: 'hot' as Sentiment, label: 'Hot' },
  { value: 'warm' as Sentiment, label: 'Warm' },
  { value: 'neutral' as Sentiment, label: 'Neutral' },
  { value: 'cold' as Sentiment, label: 'Cold' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ContactTableProps {
  /** Filtered & sorted contacts to display */
  items: ReadonlyArray<Contact>;
  /** Unfiltered list (used in the "N of M" aria-live announcement) */
  raw: ReadonlyArray<Contact>;
  /** Current search string (for empty-state labels and "clear search" button) */
  search: string;
  setSearch: (s: string) => void;
  /** Deferred value forwarded to SpotlightTable for highlight rendering */
  deferredSearch: string;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** Index of the keyboard-cursor row (-1 = none) */
  cursorIdx: number;
  selectedIds: Set<string>;
  allSelected: boolean;
  someSelected: boolean;
  toggleOne: (id: string) => void;
  toggleAll: () => void;
  sortState: ContactSortState;
  setSortState: (next: ContactSortState) => void;
  updateContact: ReturnType<typeof useUpdateContact>;
  del: ReturnType<typeof useDeleteContact>;
  setEditTarget: (c: Contact) => void;
  onDelete: (c: Contact) => Promise<void>;
  setContextMenu: (m: { x: number; y: number; contact: Contact } | null) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ContactTable({
  items,
  raw,
  search,
  setSearch,
  deferredSearch,
  isLoading,
  isError,
  error,
  refetch,
  cursorIdx,
  selectedIds,
  allSelected,
  someSelected,
  toggleOne,
  toggleAll,
  sortState,
  setSortState,
  updateContact,
  del,
  setEditTarget,
  onDelete,
  setContextMenu,
}: ContactTableProps) {
  const { t } = useTranslation('crm');

  return (
    <>
      {/* aria-live region — announces filter/sort result counts to screen
          readers. Visually hidden; updates only when the count actually
          changes so SR doesn't fire on every keystroke. */}
      <p className="sr-only" role="status" aria-live="polite">
        {search
          ? t(
              'contactTable.announceFiltered',
              'Showing {{count}} of {{total}} contacts matching {{search}}.',
              { count: items.length, total: raw.length, search },
            )
          : t('contactTable.announceTotal', 'Showing {{count}} contacts.', {
              count: items.length,
            })}
      </p>

      <Card className="overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} columns={8} headless />
        ) : isError ? (
          <ErrorState
            title={t('contactTable.errorTitle', 'Could not load contacts')}
            message={error instanceof Error ? error.message : undefined}
            action={
              <Button size="sm" variant="secondary" onClick={() => refetch()}>
                {t('contactTable.tryAgain', 'Try again')}
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              search
                ? t('contactTable.emptyFilteredTitle', 'No matches')
                : t('contactTable.emptyTitle', 'No contacts yet')
            }
            message={
              search
                ? t('contactTable.emptyFilteredMessage', 'Nothing matched "{{search}}".', {
                    search,
                  })
                : t(
                    'contactTable.emptyMessage',
                    'Add the first decision-maker to start mapping the buying group.',
                  )
            }
            action={
              search ? (
                <Button size="sm" variant="secondary" onClick={() => setSearch('')}>
                  {t('contactTable.clearSearch', 'Clear search')}
                </Button>
              ) : (
                <ContactDialog
                  trigger={
                    <Button size="sm" variant="primary">
                      {t('contactTable.addFirstContact', 'Add first contact')}
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
                      {allSelected
                        ? t('contactTable.deselectAll', 'Deselect all contacts')
                        : t('contactTable.selectAll', 'Select all contacts')}
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
                    {t('contactTable.colName', 'Name')}
                  </SortableHeader>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('role', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="role" state={sortState} onChange={setSortState}>
                    {t('contactTable.colRole', 'Role')}
                  </SortableHeader>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('customer', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="customer" state={sortState} onChange={setSortState}>
                    {t('contactTable.colCustomer', 'Customer')}
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 font-semibold">
                  {t('contactTable.colContact', 'Contact')}
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('influence', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="influence" state={sortState} onChange={setSortState}>
                    {t('contactTable.colInfluence', 'Influence')}
                  </SortableHeader>
                </th>
                <th
                  scope="col"
                  aria-sort={getSortableHeaderAriaSort('sentiment', sortState)}
                  className="px-5 py-3 font-semibold"
                >
                  <SortableHeader columnKey="sentiment" state={sortState} onChange={setSortState}>
                    {t('contactTable.colSentiment', 'Sentiment')}
                  </SortableHeader>
                </th>
                <th scope="col" className="px-5 py-3 text-right font-semibold">
                  {t('contactTable.colActions', 'Actions')}
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
                        {selectedIds.has(c.id)
                          ? t('contactTable.deselectRow', 'Deselect {{name}}', { name: c.name })
                          : t('contactTable.selectRow', 'Select {{name}}', { name: c.name })}
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
                      label={t('contactTable.editRoleLabel', 'Edit role for {{name}}', {
                        name: c.name,
                      })}
                      placeholder={t('contactTable.addRolePlaceholder', 'Add role…')}
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
                      label={t('contactTable.editInfluenceLabel', 'Edit influence for {{name}}', {
                        name: c.name,
                      })}
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
                      label={t('contactTable.editSentimentLabel', 'Edit sentiment for {{name}}', {
                        name: c.name,
                      })}
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
                        aria-label={t('contactTable.editRowLabel', 'Edit {{name}}', {
                          name: c.name,
                        })}
                      >
                        {t('contactTable.editAction', 'Edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(c)}
                        disabled={del.isPending}
                        aria-label={t('contactTable.deleteRowLabel', 'Delete {{name}}', {
                          name: c.name,
                        })}
                        className="text-[var(--danger)] hover:text-[var(--danger)]"
                      >
                        {t('contactTable.deleteAction', 'Delete')}
                      </Button>
                    </div>
                  </td>
                </SpotlightTableRow>
              ))}
            </tbody>
          </SpotlightTable>
        )}
      </Card>
    </>
  );
}
