// The column layer of the Reference Library table.
//
// Split out of ReferencesPage.tsx purely for the 400-line file budget: the page
// owns data fetching, URL state and the shell; this file owns "what a reference
// looks like as a row". Nothing here imports the page, so there is no cycle.

import type { MouseEvent } from 'react';

import type { TFunction } from 'i18next';

import type {
  DataTableColumn,
  DataTableExpandable,
} from '@/components/table-kit/data-table';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { Reference } from '@/hooks/useReferences';

// Defense in depth: the API now rejects non-http(s) documentUrl values on
// write, but existing rows (or a future write path) could still carry a
// javascript:/data: URL — rendering it as a clickable <a href> would execute
// it. Only render the link when the scheme is verifiably http(s).
export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Row-level controls sit inside a row that toggles expansion — never let the click through. */
function withoutRowToggle(run: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    run();
  };
}

function contactLine(reference: Reference): string | null {
  return [reference.contactName, reference.contactEmail].filter(Boolean).join(' · ') || null;
}

export type ReferenceColumnDeps = {
  t: TFunction;
  canWrite: boolean;
  onUse: (id: string) => void;
  onDelete: (id: string, title: string) => void;
  isUsing: boolean;
  isDeleting: boolean;
};

function documentCell(reference: Reference, t: TFunction) {
  if (!reference.documentUrl) return null;
  if (!isSafeHttpUrl(reference.documentUrl)) {
    return (
      <span className="text-fg-tertiary">
        {t('references.unsafeDocumentUrl', 'Document link unavailable')}
      </span>
    );
  }
  return (
    <a
      href={reference.documentUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:outline-none"
    >
      {t('references.viewDocument', 'View document')}
    </a>
  );
}

function actionsCell(reference: Reference, deps: ReferenceColumnDeps) {
  const { t, onUse, onDelete, isUsing, isDeleting } = deps;
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={withoutRowToggle(() => onDelete(reference.id, reference.title))}
        aria-label={t('references.deleteAriaLabel', 'Delete reference: {{title}}', {
          title: reference.title,
        })}
        disabled={isDeleting}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:bg-surface-sunken hover:text-[var(--danger)] focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:outline-none disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <Icon name="trash" size={14} ariaHidden />
      </button>
      <Button
        size="sm"
        variant="secondary"
        onClick={withoutRowToggle(() => onUse(reference.id))}
        disabled={isUsing}
      >
        {isUsing
          ? t('references.recording', 'Recording...')
          : t('references.useReference', 'Use reference')}
      </Button>
    </div>
  );
}

export function buildReferenceColumns(deps: ReferenceColumnDeps): DataTableColumn<Reference>[] {
  const { t, canWrite } = deps;
  const columns: DataTableColumn<Reference>[] = [
    {
      id: 'title',
      header: t('references.column.reference', 'Reference'),
      sortable: true,
      hideable: false,
      // Deliberately the ONLY column without a width: `table-fixed` hands it
      // every pixel the fixed columns do not claim, so the title grows with the
      // viewport. That is also why the fixed budget below is kept tight — when
      // the widths add up to more than the container, this column collapses to
      // zero and the title disappears entirely.
      //
      // The one wrapping column, too: the main row truncates to a single line,
      // the expanded detail row uses the same cell to lay out the description.
      cellClassName: 'whitespace-normal',
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar seed={row.company?.name ?? row.title} size={20} decorative />
          <span className="block truncate font-medium text-fg-primary">{row.title}</span>
        </span>
      ),
    },
    {
      id: 'company',
      header: t('references.column.company', 'Company'),
      sortable: true,
      width: 'w-32',
      hideBelow: 'md',
      cell: (row) => row.company?.name ?? null,
    },
    {
      id: 'industry',
      header: t('references.column.industry', 'Industry'),
      sortable: true,
      width: 'w-28',
      hideBelow: 'lg',
      cell: (row) => row.industry,
    },
    {
      id: 'usageCount',
      header: t('references.column.uses', 'Uses'),
      sortable: true,
      align: 'right',
      width: 'w-20',
      cell: (row) => row.usageCount,
    },
    {
      id: 'lastUsedAt',
      header: t('references.column.lastUsed', 'Last used'),
      sortable: true,
      numeric: true,
      width: 'w-28',
      cell: (row) => (row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleDateString() : null),
    },
    {
      id: 'documentUrl',
      header: t('references.column.document', 'Document'),
      width: 'w-24',
      cell: (row) => documentCell(row, t),
    },
  ];

  if (canWrite) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">{t('references.column.actions', 'Actions')}</span>,
      label: t('references.column.actions', 'Actions'),
      align: 'right',
      width: 'w-40',
      hideable: false,
      allowBlank: true,
      cell: (row) => actionsCell(row, deps),
    });
  }

  return columns;
}

// Every row expands, so the hover accent and the chevron are uniform down the
// column instead of appearing on an arbitrary subset. The detail row carries
// the three fields a dense grid legitimately cannot: the full case-study
// description, the customer contact, and the tag list (four tags per row was
// exactly the noise the retarget exists to remove — you filter by tag from the
// facet, you read them here).
export const REFERENCE_EXPANDABLE: DataTableExpandable<Reference, Reference> = {
  isExpandable: () => true,
  getSubRows: (row) => [row],
  getSubRowId: (_sub, row) => `${row.id}-detail`,
  renderSubCell: (sub, columnId) => {
    if (columnId === 'title') {
      return sub.description ? (
        <span className="block text-fg-secondary">{sub.description}</span>
      ) : null;
    }
    if (columnId === 'company') return contactLine(sub);
    if (columnId === 'industry') return sub.tags.length > 0 ? sub.tags.join(' · ') : null;
    return null;
  },
};
