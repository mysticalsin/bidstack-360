// Reference Library — reusable customer references, case studies, testimonials.
//
// ROUND2-ULTRAPLAN "the density retarget", surface 4: the 2-column card grid is
// retired for a table-kit `DataTable`. Two things changed that matter beyond
// pixels:
//   1. URL-as-state. Search, industry and tag used to live in three `useState`
//      calls, so a filtered view could not be shared, bookmarked or reported in
//      a bug. They are now URL params (referencesPage/references-search-params.ts)
//      and the only `useState` left on this page is the create-dialog toggle,
//      which is view chrome and belongs nowhere near a link.
//   2. Density. Each reference used ~9 stacked lines in a card; it is now one
//      scannable row, with the long-form description one click away in the
//      expanded detail row (`?expand=` — also part of the shareable URL).

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, useReducedMotion } from 'framer-motion';

import { DataTable, type DataTableFacet } from '@/components/table-kit/data-table';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/table-kit/empty';
import { Button } from '@/components/ui/Button';
import { confirm } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { ErrorState } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { useHasPermission } from '@/hooks/useCapabilities';
import {
  useCreateReference,
  useDeleteReference,
  useReferences,
  useUseReference,
  type Reference,
} from '@/hooks/useReferences';
import { staggerChild, staggerParent } from '@/lib/motion';
import { tableFetchState, useTableQuery } from '@/lib/table/use-table-query';

import { NewReferenceDialog, type NewReferenceBody } from './referencesPage/NewReferenceDialog';
import {
  buildReferenceColumns,
  REFERENCE_EXPANDABLE,
} from './referencesPage/reference-columns';
import {
  applyReferencesView,
  hasActiveReferenceFilters,
  referenceIndustryOptions,
  referencesSearchParams,
  referenceTagOptions,
  toReferencesFilters,
} from './referencesPage/references-search-params';

// Re-exported so the security regression test (and any future caller) keeps one
// import site for the document-link scheme guard.
export { isSafeHttpUrl } from './referencesPage/reference-columns';

export function ReferencesPage() {
  const { t } = useTranslation('crm');
  const reducedMotion = useReducedMotion();
  // The ONLY local state left: whether the create dialog is open. Filtering,
  // sorting, paging and row expansion all live in the URL.
  const [showCreate, setShowCreate] = useState(false);
  // References writes are gated server-side behind accounts:write — hide the
  // write controls for users who lack it (they previously 403'd on click).
  const canWrite = useHasPermission('accounts:write');

  const { query, input } = useTableQuery(referencesSearchParams);
  const references = useReferences(toReferencesFilters(input));
  // Unfiltered source for the facet dropdowns — deriving options from the
  // filtered result collapses each list to the active selection and traps the
  // user with no way back.
  const allReferences = useReferences({});

  const { rows, total } = useMemo(
    () => applyReferencesView(references.data?.items ?? [], input),
    [references.data, input],
  );
  const { showSkeleton, showSpinner } = tableFetchState(references);

  // Destructured because react-query returns a fresh result object each render
  // while `mutate` itself is stable — depending on the mutation object would
  // rebuild `columns` on every render.
  const { mutate: recordUse, isPending: isRecording } = useUseReference();
  const { mutate: deleteReference, isPending: isDeleting } = useDeleteReference();
  const createRef = useCreateReference();

  const handleCreate = (body: NewReferenceBody) => {
    createRef.mutate(body, {
      onSuccess: () => {
        setShowCreate(false);
        toast.success(t('references.toast.created', 'Reference added'));
      },
      onError: () => toast.error(t('references.toast.createError', 'Could not create reference')),
    });
  };

  // Both callbacks are stable, which keeps `columns` stable, which keeps
  // DataTable from re-deriving its hidden-column parser (and re-subscribing the
  // `hide` URL key) on every keystroke in the search box.
  const handleUse = useCallback((id: string) => recordUse(id), [recordUse]);

  const handleDelete = useCallback(
    async (id: string, title: string) => {
      const ok = await confirm({
        title: t('references.deleteConfirm.title', 'Delete reference?'),
        description: t(
          'references.deleteConfirm.description',
          '"{{title}}" will be removed from your library. This can\'t be undone.',
          { title },
        ),
        confirmLabel: t('references.deleteConfirm.confirmLabel', 'Delete'),
        destructive: true,
      });
      if (!ok) return;
      deleteReference(id, {
        onSuccess: () => toast.success(t('references.toast.deleted', 'Reference deleted')),
        onError: () => toast.error(t('references.toast.deleteError', 'Could not delete reference')),
      });
    },
    [t, deleteReference],
  );

  const columns = useMemo(
    () =>
      buildReferenceColumns({
        t,
        canWrite,
        onUse: handleUse,
        onDelete: (id, title) => void handleDelete(id, title),
        isUsing: isRecording,
        isDeleting,
      }),
    [t, canWrite, handleUse, handleDelete, isRecording, isDeleting],
  );

  const facets = useMemo<DataTableFacet[]>(() => {
    const allItems = allReferences.data?.items ?? [];
    return [
      {
        id: 'industry',
        label: t('references.allIndustries', 'All industries'),
        options: referenceIndustryOptions(allItems),
      },
      {
        id: 'tag',
        label: t('references.allTags', 'All tags'),
        options: referenceTagOptions(allItems),
      },
    ];
  }, [t, allReferences.data]);

  const filtered = hasActiveReferenceFilters(input);

  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col gap-6"
      variants={reducedMotion ? undefined : staggerParent}
      initial={reducedMotion ? false : 'initial'}
      animate="animate"
    >
      <motion.header
        variants={reducedMotion ? undefined : staggerChild}
        className="flex items-start justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">
            {t('references.heading', 'Reference Library')}
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {t(
              'references.subtitle',
              'Proof that wins bids — the right case study and testimonial for every proposal.',
            )}
          </p>
        </div>
        {canWrite && (
          <Button onClick={() => setShowCreate(true)}>
            {t('references.newButton', 'New reference')}
          </Button>
        )}
      </motion.header>

      {/* sr-only live region — announces filter/search result count to AT */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {showSkeleton ? '' : t('references.resultCount', '{{count}} references', { count: total })}
      </p>

      {references.isError ? (
        <ErrorState
          title={t('references.errorTitle', 'Could not load references')}
          message={
            references.error instanceof Error
              ? references.error.message
              : t('references.errorMessage', 'Please try again in a moment.')
          }
        />
      ) : (
        <DataTable<Reference, Reference>
          query={query}
          columns={columns}
          rows={rows}
          total={total}
          getRowId={(row) => row.id}
          facets={facets}
          expandable={REFERENCE_EXPANDABLE}
          // The table frame, its header and the toolbar render on the first
          // paint and never unmount: a cold load shows the in-body spinner, a
          // filter change keeps the previous rows (ROUND2-ULTRAPLAN risk #7,
          // "no blank table frame").
          loading={showSkeleton || showSpinner}
          leadingActions={
            <div className="relative w-full sm:w-64">
              <Icon
                name="search"
                size={14}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-fg-tertiary"
                ariaHidden
              />
              <input
                type="search"
                value={query.q}
                onChange={(event) => query.setQ(event.target.value)}
                placeholder={t('references.searchPlaceholder', 'Search references...')}
                aria-label={t('references.searchAriaLabel', 'Search references')}
                className="input h-8 w-full pl-9 text-xs"
              />
            </div>
          }
          empty={
            <Empty className="border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon name="file" size={16} ariaHidden />
                </EmptyMedia>
                <EmptyTitle>
                  {filtered
                    ? t('references.noMatch.title', 'No references match these filters')
                    : t('references.emptyTitle', 'No references yet')}
                </EmptyTitle>
                <EmptyDescription>
                  {filtered
                    ? t(
                        'references.noMatch.message',
                        'Clear the industry or tag facet, or search for a different term.',
                      )
                    : t(
                        'references.emptyMessage',
                        'Add customer references to build your proposal library.',
                      )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent layout="row">
                {filtered ? (
                  <Button variant="secondary" size="sm" onClick={() => query.resetFilters()}>
                    {t('references.noMatch.action', 'Clear filters')}
                  </Button>
                ) : (
                  canWrite && (
                    <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
                      {t('references.emptyAction', 'Add reference')}
                    </Button>
                  )
                )}
              </EmptyContent>
            </Empty>
          }
        />
      )}

      {showCreate && (
        <NewReferenceDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          isPending={createRef.isPending}
        />
      )}
    </motion.div>
  );
}
