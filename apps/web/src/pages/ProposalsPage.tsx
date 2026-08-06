// Proposals — the bid desk's work list.
//
// ROUND2-ULTRAPLAN Phase 2, commit 2: the GlassCard card-stack became a
// table-kit `DataTable`. What changed and why:
//   * density — text-xs rows on fixed column widths, sticky sunken header,
//     ROW_ACCENT on hover, ~4x the rows per viewport of the card stack.
//   * stage renders as a `StatusIndicator` (dot + word), never a coloured pill.
//     `ProposalStatusChip` stays the source of truth for the LABELS and is still
//     the right control on the detail page, where one status is the subject.
//   * every null renders `EmptyCellValue`'s em-dash — DataTable does this for
//     any cell renderer that returns null, so the cells just return null.
//   * the whole view lives in the URL (nuqs, via proposals-search-params.ts):
//     stage tab, owner / deadline / compliance facets, search, sort and page.
//     Pasting the URL reproduces the exact view; Back walks pages.
//   * no blank table after first paint — `keepPreviousTableData` on the window
//     query, pagination handled in-memory (a page change is a re-render, not a
//     request), skeleton only on the cold load.
//
// The API contract is untouched: this is a presentation change. See
// proposals-search-params.ts for what the server filters and what this surface
// does over the loaded window, and why the truncation notice exists. Column and
// facet definitions live in proposalsPage/proposals-columns.tsx — split out for
// the 400-line file budget, not because they are reusable elsewhere.

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseAsString, useQueryState } from 'nuqs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { proposalStatusLabel } from '@/components/rfp/shared/ProposalStatusChip';
import { DataTable } from '@/components/table-kit/data-table';
import { Skeleton } from '@/components/table-kit/skeleton';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Sheet, SheetContent } from '@/components/ui/Sheet';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { keepPreviousTableData, tableFetchState, useTableQuery } from '@/lib/table/use-table-query';
import {
  PROPOSALS_WINDOW,
  PROPOSAL_STAGES,
  proposalsSearchParams,
  selectProposals,
  type ProposalPage,
  type ProposalRow,
} from './proposals-search-params';
import {
  useOwnerLabel,
  useProposalColumns,
  useProposalFacets,
} from './proposalsPage/proposals-columns';

/** Cold-load body: skeleton bars where the rows will land, not a blank frame. */
function LoadingRows() {
  const { t } = useTranslation('rfp');
  return (
    <span
      className="flex w-full flex-col gap-3"
      aria-busy="true"
      aria-label={t('proposals.loading', 'Loading proposals')}
    >
      {[0, 1, 2, 3, 4].map((row) => (
        <Skeleton key={row} className="h-3 w-full" />
      ))}
    </span>
  );
}

// Create as a side panel (ADR-2), not a card wedged above the table. The card
// pushed every row down the moment it opened, so the list you were reading
// jumped; the sheet lays over it and the rows stay where they were.
//
// `open` stays driven by `?new=1` — the flag was already a URL param, and the
// sheet only makes that state visible in the right place.
function CreateProposalSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('rfp');
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (body: { name: string }) =>
      api<ProposalRow>('/api/v1/proposals', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['proposals'] });
      setName('');
      onClose();
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        size="md"
        title={t('proposals.createProposal', 'Create Proposal')}
        description={t(
          'proposals.createSubtitle',
          'Name it now; everything else is editable on the proposal itself.',
        )}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t('proposals.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => create.mutate({ name })}
              disabled={!name.trim() || create.isPending}
            >
              {create.isPending
                ? t('proposals.creating', 'Creating…')
                : t('proposals.create', 'Create')}
            </Button>
          </>
        }
      >
        <label className="block text-xs font-medium text-fg-secondary" htmlFor="proposal-name">
          {t('proposals.nameLabel', 'Proposal name')}
        </label>
        <input
          id="proposal-name"
          className="dialog-input mt-1.5 w-full"
          placeholder={t('proposals.namePlaceholder', 'Proposal name…')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim()) create.mutate({ name });
          }}
        />
        {create.isError && (
          <p className="mt-3 text-xs text-[var(--danger)]" role="alert">
            {create.error instanceof Error
              ? create.error.message
              : t('proposals.createError', 'Failed to create proposal.')}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ProposalsPage() {
  const { t } = useTranslation('rfp');
  useDocumentTitle();
  const navigate = useNavigate();
  const ownerLabel = useOwnerLabel();
  const columns = useProposalColumns(ownerLabel);

  // `?new=1` is the RFP hub's "New Proposal" shortcut. It stays a URL param
  // (not local state) so the deep link is reproducible, and nuqs MERGES its
  // write — clearing the stage filter no longer wipes it, which is the exact
  // bug docs/design-system/url-param-audit.md §4 recorded on this page.
  // `push`, not the default `replace`: opening the create panel moves between
  // views rather than refining one, so it earns a history entry and Back closes
  // the sheet instead of leaving the page (ADR-2; url-param-audit.md §6 — the
  // same rule lib/use-sheet-param.ts follows for record sheets).
  const [newFlag, setNewFlag] = useQueryState(
    'new',
    parseAsString.withOptions({ history: 'push' }),
  );
  const { query, input } = useTableQuery(proposalsSearchParams);

  const search = useDebounced(input.q);
  // Named `windowQuery`, not `window` — the loaded slice is a window over the
  // server's result set, and shadowing the global would be a landmine.
  const windowQuery = useQuery({
    queryKey: ['proposals', 'list', { status: input.status, search }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: String(PROPOSALS_WINDOW) });
      if (input.status !== 'all') params.set('status', input.status);
      if (search) params.set('search', search);
      return api<ProposalPage>(`/api/v1/proposals?${params.toString()}`, { signal });
    },
    // The port must not feel worse than a server-rendered list on a filter
    // change (ROUND2-ULTRAPLAN risk #7): keep the previous rows on screen and
    // move the pagination spinner instead of blanking the table.
    placeholderData: keepPreviousTableData,
  });
  const { showSkeleton, showSpinner } = tableFetchState(windowQuery);

  const items = useMemo(() => windowQuery.data?.items ?? [], [windowQuery.data]);
  const selection = useMemo(
    () => selectProposals(items, input, ownerLabel),
    [items, input, ownerLabel],
  );

  // A hand-edited `?page=9` (or a bookmark taken before rows were archived)
  // would otherwise render an empty body. Every in-app filter write already
  // resets the page (use-table-query.ts:77-81); this covers the pasted URL.
  useEffect(() => {
    if (selection.page !== query.page) query.setPage(selection.page);
  }, [selection.page, query]);

  const facets = useProposalFacets(items, ownerLabel);
  const truncated = (windowQuery.data?.total ?? 0) > items.length;

  // Rendered in BOTH branches below, and outside the error early-return, so a
  // `?new=1` deep link still opens the create panel when the list behind it
  // failed to load. Previously the create form was unreachable in that state.
  const createSheet = (
    <CreateProposalSheet open={newFlag === '1'} onClose={() => void setNewFlag(null)} />
  );

  if (windowQuery.isError) {
    return (
      <>
        <ProposalsHead onCreate={() => void setNewFlag('1')} />
        <GlassCard className="py-12 text-center" role="alert">
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            {t('proposals.loadError', 'Failed to load proposals')}
          </p>
          <p className="text-xs text-fg-tertiary mt-1">
            {windowQuery.error instanceof Error
              ? windowQuery.error.message
              : t('proposals.loadErrorRetry', 'Please try again in a moment.')}
          </p>
        </GlassCard>
        {createSheet}
      </>
    );
  }

  return (
    <>
      <ProposalsHead onCreate={() => void setNewFlag('1')} />

      {createSheet}

      {/* sr-only live region — announces the filtered count to AT. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {showSkeleton
          ? ''
          : t('proposals.resultCount', '{{count}} proposals', { count: selection.total })}
      </p>

      {truncated && (
        <p className="text-xs text-fg-tertiary" role="status">
          {t(
            'proposals.truncated',
            'Showing the {{loaded}} most recently updated proposals of {{total}}. Narrow the stage or search to reach the rest.',
            { loaded: items.length, total: windowQuery.data?.total ?? 0 },
          )}
        </p>
      )}

      <DataTable<ProposalRow>
        query={query}
        columns={columns}
        rows={selection.rows}
        total={selection.total}
        getRowId={(row) => row.id}
        loading={showSpinner}
        tabs={{
          id: 'status',
          allLabel: t('proposals.allStages', 'All stages'),
          options: PROPOSAL_STAGES.map((stage) => ({
            value: stage,
            label: t(`proposalStatusChip.label.${stage}`, proposalStatusLabel(stage)),
          })),
        }}
        facets={facets}
        leadingActions={<ProposalSearch value={query.q} onChange={query.setQ} />}
        onRowClick={(row) => navigate(`/proposals/${row.id}`)}
        empty={showSkeleton ? <LoadingRows /> : <ProposalsEmpty filtered={items.length > 0} />}
        // The table's own scroller is what makes the header sticky, so it needs a
        // bounded height — the page itself scrolls with the shell. Sizing, not
        // geometry: the design-law rule scopes to radius/shadow/spacing only.
        className="max-h-[calc(100vh-17rem)] min-h-[24rem]"
      />
    </>
  );
}

function ProposalsHead({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation('rfp');
  return (
    <PageHeader
      title={t('proposals.title', 'Proposals')}
      description={t(
        'proposals.subtitle',
        'RFP workspace — draft, review, and submit winning proposals.',
      )}
      actions={
        <Button variant="primary" size="sm" onClick={onCreate}>
          {t('proposals.newProposal', 'New Proposal')}
        </Button>
      }
    />
  );
}

function ProposalSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation('rfp');
  return (
    <input
      type="search"
      className="dialog-input w-full sm:w-64"
      aria-label={t('proposals.searchLabel', 'Search proposals')}
      placeholder={t('proposals.searchPlaceholder', 'Search proposals…')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function ProposalsEmpty({ filtered }: { filtered: boolean }): ReactNode {
  const { t } = useTranslation('rfp');
  return filtered
    ? t('proposals.emptyFiltered', 'No proposals match these filters.')
    : t('proposals.emptyTitle', 'No proposals yet.');
}

/**
 * Holds the URL's `q` back from the network for a beat. The URL updates on every
 * keystroke (so the view stays shareable mid-type) but only the settled value
 * re-fetches the window; the in-memory name filter keeps the visible rows exact
 * in between.
 */
function useDebounced(value: string, ms = 250): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
