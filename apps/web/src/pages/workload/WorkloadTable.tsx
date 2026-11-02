// Per-rep capacity table: sortable columns, an in-row relative-load bar, a
// capacity flag, and an expandable drill-through into the owner's live bids.

import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import {
  getSortableHeaderAriaSort,
  SortableHeader,
} from '@/components/ui/SortableHeader';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScrollArea,
} from '@/components/ui/Table';
import { useTableSort } from '@/hooks/useTableSort';
import type { WorkloadOwner } from '@/hooks/useWorkload';
import { capacityLevel, relativeLoad, type CapacityLevel } from './workloadConfig';
import { OwnerDrilldown } from './OwnerDrilldown';

type SortKey = 'owner' | 'openBids' | 'weighted' | 'overdueTasks' | 'closing';

// Module-level so useTableSort's memo sees a stable reference.
const ACCESSORS: Record<SortKey, (o: WorkloadOwner) => string | number | null> = {
  owner: (o) => o.name ?? o.email,
  openBids: (o) => o.openBids,
  // Number() on micros loses sub-cent precision — irrelevant for ordering.
  weighted: (o) => Number(o.weightedValueMicros),
  overdueTasks: (o) => o.overdueTasks,
  closing: (o) => o.closingWithin7Days,
};

const CAPACITY_TONE: Record<CapacityLevel, BadgeTone> = {
  over: 'tomato',
  stretched: 'amber',
  steady: 'blue',
  free: 'jade',
};

const LOAD_BAR_COLOR: Record<CapacityLevel, string> = {
  over: 'var(--danger)',
  stretched: 'var(--warning)',
  steady: 'var(--brand-primary)',
  free: 'var(--border-strong)',
};

function CapacityBadge({ level }: { level: CapacityLevel }) {
  const { t } = useTranslation('crm');
  const labels: Record<CapacityLevel, string> = {
    over: t('workload.capacityOver', 'Over capacity'),
    stretched: t('workload.capacityStretched', 'Stretched'),
    steady: t('workload.capacitySteady', 'Steady'),
    free: t('workload.capacityFree', 'Can take a bid'),
  };
  return <Badge tone={CAPACITY_TONE[level]}>{labels[level]}</Badge>;
}

function OwnerCell({ owner }: { owner: WorkloadOwner }) {
  const { t } = useTranslation('crm');
  if (owner.ownerId === null) {
    return (
      <div>
        <span className="font-medium text-[var(--fg-primary)]">
          {t('workload.unassigned', 'Unassigned bids')}
        </span>
        <p className="text-xs text-[var(--fg-tertiary)]">
          {t('workload.unassignedHint', 'No owner on record — assign before the clock runs out')}
        </p>
      </div>
    );
  }
  return (
    <div>
      <span className="font-medium text-[var(--fg-primary)]">
        {owner.name ?? t('workload.formerTeammate', 'Former teammate')}
      </span>
      <p className="text-xs text-[var(--fg-tertiary)]">
        {owner.email ?? t('workload.formerTeammateHint', 'Departed — these bids need a new owner')}
      </p>
    </div>
  );
}

interface Props {
  owners: WorkloadOwner[];
  formatMoneyMicros: (micros: string) => string;
}

export function WorkloadTable({ owners, formatMoneyMicros }: Props) {
  const { t } = useTranslation('crm');
  const { state, setState, sorted } = useTableSort<WorkloadOwner, SortKey>(owners, ACCESSORS, {
    initial: { key: 'weighted', dir: 'desc' },
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const maxOpenBids = owners.reduce((max, o) => Math.max(max, o.openBids), 0);

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <TableHead aria-sort={getSortableHeaderAriaSort(key, state)} className={align === 'right' ? 'text-right' : undefined}>
      <SortableHeader columnKey={key} state={state} onChange={setState} align={align}>
        {label}
      </SortableHeader>
    </TableHead>
  );

  return (
    <TableScrollArea
      aria-label={t('workload.tableRegionLabel', 'Team workload table')}
      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-11">
              <span className="sr-only">{t('workload.expandColumn', 'Expand')}</span>
            </TableHead>
            {header('owner', t('workload.colOwner', 'Owner'), 'left')}
            <TableHead>{t('workload.colLoad', 'Relative load')}</TableHead>
            {header('openBids', t('workload.colOpenBids', 'Live bids'))}
            {header('weighted', t('workload.colWeighted', 'Weighted pipeline'))}
            {header('overdueTasks', t('workload.colOverdue', 'Overdue tasks'))}
            {header('closing', t('workload.colClosing', 'Closing ≤ 7d'))}
            <TableHead>{t('workload.colCapacity', 'Capacity')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((owner) => {
            const rowId = owner.ownerId ?? 'unassigned';
            const level = capacityLevel(owner);
            const expanded = expandedId === rowId;
            const canExpand = owner.email !== null;
            return (
              <Fragment key={rowId}>
                <TableRow data-testid={`workload-row-${rowId}`}>
                  <TableCell className="px-2 py-1">
                    {canExpand ? (
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`workload-drilldown-${rowId}`}
                        aria-label={t('workload.expandRow', "Show {{owner}}'s live bids", {
                          owner: owner.name ?? owner.email,
                        })}
                        onClick={() => setExpandedId(expanded ? null : rowId)}
                        className="flex h-11 w-11 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                      >
                        <Icon
                          name="chevron-down"
                          size={14}
                          className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${expanded ? '' : '-rotate-90'}`}
                        />
                      </button>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <OwnerCell owner={owner} />
                  </TableCell>
                  <TableCell className="min-w-[120px]">
                    {/* Decorative — the adjacent live-bid count carries the value. */}
                    <div aria-hidden className="h-1.5 w-full max-w-[160px] rounded-full bg-[var(--surface-sunken)]">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${Math.round(relativeLoad(owner.openBids, maxOpenBids) * 100)}%`,
                          backgroundColor: LOAD_BAR_COLOR[level],
                        }}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-[var(--fg-primary)]">
                    {owner.openBids}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoneyMicros(owner.weightedValueMicros)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums ${owner.overdueTasks > 0 ? 'font-semibold text-[var(--danger)]' : ''}`}
                  >
                    {owner.overdueTasks}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{owner.closingWithin7Days}</TableCell>
                  <TableCell>
                    <CapacityBadge level={level} />
                  </TableCell>
                </TableRow>
                {expanded && owner.email ? (
                  <tr id={`workload-drilldown-${rowId}`}>
                    <td colSpan={8} className="bg-[var(--surface-soft)] p-0">
                      <OwnerDrilldown
                        email={owner.email}
                        ownerLabel={owner.name ?? owner.email}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableScrollArea>
  );
}
