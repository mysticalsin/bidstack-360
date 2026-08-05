// Column and facet definitions for the Proposals `DataTable`.
//
// Split out of ProposalsPage.tsx purely for the 400-line file budget: the page
// owns data flow and layout, this file owns "what a column is". Exports are
// hooks only — no components — so Fast Refresh keeps working on both files.
//
// Two rules live here rather than in the page, because they are the density law
// and not a layout choice:
//   * a cell renderer returns `null` for absent data; DataTable turns that into
//     `EmptyCellValue`'s em-dash (data-table.tsx:168-171). Never render '' here.
//   * an owner that the roster could not resolve is "Unknown owner", not an
//     em-dash — the proposal HAS an owner, and a blank cell would say otherwise.

import { useMemo } from 'react';

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { proposalStatusLabel } from '@/components/rfp/shared/ProposalStatusChip';
import type { DataTableColumn, DataTableFacet } from '@/components/table-kit/data-table';
import { StatusIndicator } from '@/components/table-kit/status-indicator';
import { useUsers } from '@/hooks/useUsers';
import { formatDate } from '@/lib/format';

import {
  COMPLIANCE_BANDS,
  DUE_WINDOWS,
  STAGE_TONE,
  UNASSIGNED_OWNER,
  type ProposalRow,
} from '../proposals-search-params';

export type OwnerLabel = (id: string | null) => string | null;

const DUE_WINDOW_FALLBACK: Record<(typeof DUE_WINDOWS)[number], string> = {
  overdue: 'Overdue',
  week: 'Due within 7 days',
  month: 'Due within 30 days',
  later: 'Due beyond 30 days',
  none: 'No deadline',
};

const COMPLIANCE_FALLBACK: Record<(typeof COMPLIANCE_BANDS)[number], string> = {
  complete: 'Complete (90%+)',
  partial: 'In progress (below 90%)',
  unscored: 'Not scored',
};

/** Owner id → display name, resolved against the org roster. */
export function useOwnerLabel(): OwnerLabel {
  const { t } = useTranslation('rfp');
  // The roster route caps at 200 (useUsers.ts:48-53); an owner outside that page
  // resolves to "Unknown owner" rather than to an em-dash.
  const users = useUsers({ limit: 200 });
  const byId = useMemo(
    () => new Map((users.data ?? []).map((user) => [user.id, user.name ?? user.email])),
    [users.data],
  );
  return useMemo(
    () => (id: string | null) =>
      id === null ? null : (byId.get(id) ?? t('proposals.ownerUnknown', 'Unknown owner')),
    [byId, t],
  );
}

export function useProposalColumns(ownerLabel: OwnerLabel): DataTableColumn<ProposalRow>[] {
  const { t } = useTranslation('rfp');
  return useMemo(
    () => [
      {
        id: 'name',
        header: t('proposals.columns.name', 'Proposal'),
        sortable: true,
        // A Link (not just the row's onClick) so the row is reachable by keyboard
        // and openable in a new tab. stopPropagation keeps the row handler from
        // navigating a second time on top of the link.
        cell: (row) => (
          <Link
            to={`/proposals/${row.id}`}
            className="font-medium text-fg-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {row.name}
          </Link>
        ),
      },
      {
        id: 'stage',
        header: t('proposals.columns.stage', 'Stage'),
        sortable: true,
        width: 'w-36',
        cell: (row) => (
          <StatusIndicator
            tone={STAGE_TONE[row.status]}
            label={t(`proposalStatusChip.label.${row.status}`, proposalStatusLabel(row.status))}
            size="sm"
          />
        ),
      },
      {
        id: 'owner',
        header: t('proposals.columns.owner', 'Owner'),
        sortable: true,
        width: 'w-44',
        hideBelow: 'lg',
        cell: (row) => ownerLabel(row.ownerId),
      },
      {
        id: 'compliance',
        header: t('proposals.columns.compliance', 'Compliance'),
        sortable: true,
        align: 'right',
        width: 'w-28',
        cell: (row) =>
          row.complianceScore == null
            ? null
            : t('proposals.percent', '{{value}}%', { value: row.complianceScore }),
      },
      {
        id: 'version',
        header: t('proposals.columns.version', 'Ver.'),
        align: 'right',
        width: 'w-20',
        hideBelow: 'md',
        cell: (row) => t('proposals.version', 'v{{version}}', { version: row.version }),
      },
      {
        id: 'due',
        header: t('proposals.columns.due', 'Due'),
        sortable: true,
        width: 'w-32',
        numeric: true,
        cell: (row) => (row.dueDate ? formatDate(row.dueDate) : null),
      },
      {
        id: 'updated',
        header: t('proposals.columns.updated', 'Updated'),
        sortable: true,
        width: 'w-32',
        numeric: true,
        hideBelow: 'lg',
        cell: (row) => formatDate(row.updatedAt),
      },
    ],
    [ownerLabel, t],
  );
}

/**
 * Facet menus. Owner options come from the loaded window so the menu can only
 * offer owners that exist in it — a facet that always returns nothing is noise.
 */
export function useProposalFacets(
  items: readonly ProposalRow[],
  ownerLabel: OwnerLabel,
): DataTableFacet[] {
  const { t } = useTranslation('rfp');
  return useMemo(() => {
    const ownerIds = new Set(items.map((row) => row.ownerId));
    const owners = [...ownerIds]
      .filter((id): id is string => id !== null)
      .map((id) => ({ value: id, label: ownerLabel(id) ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (ownerIds.has(null)) {
      owners.push({
        value: UNASSIGNED_OWNER,
        label: t('proposals.ownerUnassigned', 'Unassigned'),
      });
    }
    return [
      { id: 'owner', label: t('proposals.facets.owner', 'Owner'), options: owners },
      {
        id: 'dueWindow',
        label: t('proposals.facets.dueWindow', 'Deadline'),
        options: DUE_WINDOWS.map((value) => ({
          value,
          label: t(`proposals.dueWindow.${value}`, DUE_WINDOW_FALLBACK[value]),
        })),
      },
      {
        id: 'compliance',
        label: t('proposals.facets.compliance', 'Compliance'),
        options: COMPLIANCE_BANDS.map((value) => ({
          value,
          label: t(`proposals.compliance.${value}`, COMPLIANCE_FALLBACK[value]),
        })),
      },
    ];
  }, [items, ownerLabel, t]);
}
