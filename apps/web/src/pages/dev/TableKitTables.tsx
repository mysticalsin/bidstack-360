/**
 * Table-tier specimens for /dev/table-kit.
 *
 * Split from TableKitPlayground.tsx so neither file exceeds the 400-line
 * budget: this half owns everything that renders rows (table primitives,
 * SimpleTable, CardTable, pagination, empty states, the menu, and the full
 * DataTable), the other half owns the status/dashboard/card tier.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CardTable, CardTableEmpty } from '@/components/table-kit/card-table';
import { DataTable, type DataTableColumn } from '@/components/table-kit/data-table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/table-kit/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/table-kit/empty';
import { EmptyCellValue } from '@/components/table-kit/empty-cell';
import { SimpleTable, SimpleTableRow } from '@/components/table-kit/simple-table';
import { SOURCED_VALUE, SourcedValue, Provenance } from '@/components/table-kit/sourced-value';
import { StatusIndicator } from '@/components/table-kit/status-indicator';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/table-kit/table';
import { TablePagination } from '@/components/table-kit/table-pagination';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ROW_ACCENT } from '@/lib/table/row-accent';

import {
  applyQuery,
  EUR,
  OWNERS,
  PROPOSALS,
  type ProposalRow,
  TONE_LABEL,
  useFixtureQuery,
} from './table-kit-fixtures';

const ROWS = PROPOSALS.slice(0, 5);

export function TablePrimitivesSpecimen() {
  return (
    <Table>
      <TableCaption>Raw primitives — Table / Header / Row / Head / Cell / Footer.</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">Ref</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id} className={ROW_ACCENT}>
            <TableCell className="font-medium tabular-nums">{row.id}</TableCell>
            <TableCell>{row.client}</TableCell>
            <TableCell>
              <StatusIndicator tone={row.tone} label={TONE_LABEL[row.tone]} size="sm" />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.value === null ? <EmptyCellValue /> : EUR.format(row.value)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Total</TableCell>
          <TableCell className="text-right tabular-nums">
            {EUR.format(ROWS.reduce((sum, row) => sum + (row.value ?? 0), 0))}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

export function SimpleTableSpecimen() {
  return (
    <SimpleTable
      surface="page"
      columns={[
        { header: 'Requirement', width: 'w-1/2' },
        { header: 'Owner' },
        { header: 'Status', align: 'right' },
      ]}
    >
      {ROWS.slice(0, 3).map((row) => (
        <SimpleTableRow key={row.id} clickable>
          <TableCell>
            <SourcedValue
              source={
                <Provenance
                  claim={`${row.client} — extracted from the tender pack`}
                  reasons={['Matched section 4.2', 'Confidence 0.91']}
                  observedAt="2026-07-28"
                  sourceUrl="https://www.boamp.fr/"
                />
              }
            >
              <span className={SOURCED_VALUE}>{row.lot}</span>
            </SourcedValue>
          </TableCell>
          <TableCell>{row.owner}</TableCell>
          <TableCell className="text-right">
            <StatusIndicator tone={row.tone} label={TONE_LABEL[row.tone]} size="sm" />
          </TableCell>
        </SimpleTableRow>
      ))}
    </SimpleTable>
  );
}

export function CardTableSpecimen({ empty }: { empty?: boolean }) {
  return (
    <>
      <CardTable
        columns={[{ header: 'Ref', width: 'w-32' }, { header: 'Client' }, { header: 'Due', align: 'right' }]}
      >
        {empty
          ? null
          : ROWS.slice(0, 3).map((row) => (
              <SimpleTableRow key={row.id}>
                <TableCell className="tabular-nums">{row.id}</TableCell>
                <TableCell>{row.client}</TableCell>
                <TableCell className="text-right">{row.due ?? <EmptyCellValue />}</TableCell>
              </SimpleTableRow>
            ))}
      </CardTable>
      {empty ? <CardTableEmpty>No bids close in this window.</CardTableEmpty> : null}
    </>
  );
}

export function PaginationSpecimen() {
  const [page, setPage] = useState(2);
  return (
    <div className="flex flex-col gap-4">
      <TablePagination page={page} totalPages={7} pageSize={8} total={53} onPageChange={setPage} />
      <TablePagination
        page={1}
        totalPages={1}
        pageSize={8}
        total={0}
        onPageChange={() => undefined}
        loading
      />
    </div>
  );
}

export function EmptySpecimen() {
  const { t } = useTranslation('common');
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon name="file" size={16} />
        </EmptyMedia>
        <EmptyTitle>{t('devPlayground.emptyTitle', 'No bids match these filters')}</EmptyTitle>
        <EmptyDescription>
          {t(
            'devPlayground.emptyBody',
            'Clear the owner facet, or widen the deadline window to the next quarter.',
          )}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent layout="row">
        <Button variant="secondary" size="sm">
          {t('devPlayground.emptyAction', 'Clear filters')}
        </Button>
      </EmptyContent>
    </Empty>
  );
}

export function DropdownSpecimen() {
  const [dense, setDense] = useState(true);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          Row actions
          <Icon name="caret" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>BID-2409 · Enedis</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          Open full page
          <DropdownMenuShortcut>⏎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>Duplicate as new bid</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={dense} onCheckedChange={setDense}>
          Dense rows
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Withdraw bid</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLUMNS: DataTableColumn<ProposalRow>[] = [
  { id: 'id', header: 'Ref', cell: (row) => row.id, sortable: true, width: 'w-28', numeric: true },
  {
    id: 'client',
    header: 'Client',
    sortable: true,
    cell: (row) => (
      <SourcedValue
        source={
          <Provenance
            claim={`${row.client} — legal entity confirmed`}
            reasons={['Matched on SIREN', 'Two independent sources agree']}
            observedAt="2026-07-28"
            sourceUrl="https://www.annuaire-entreprises.data.gouv.fr/"
          />
        }
      >
        <span className={SOURCED_VALUE}>{row.client}</span>
      </SourcedValue>
    ),
  },
  { id: 'lot', header: 'Lot', cell: (row) => row.lot, hideBelow: 'md' },
  { id: 'owner', header: 'Owner', cell: (row) => row.owner, hideBelow: 'lg' },
  {
    id: 'tone',
    header: 'Status',
    cell: (row) => <StatusIndicator tone={row.tone} label={TONE_LABEL[row.tone]} size="sm" />,
    width: 'w-40',
  },
  {
    id: 'value',
    header: 'Value',
    sortable: true,
    align: 'right',
    width: 'w-32',
    cell: (row) => (row.value === null ? null : EUR.format(row.value)),
  },
  { id: 'due', header: 'Due', cell: (row) => row.due, width: 'w-24' },
];

export function DataTableSpecimen() {
  const query = useFixtureQuery();
  const { visible, total } = applyQuery(PROPOSALS, query);

  return (
    <DataTable<ProposalRow, ProposalRow['gaps'][number]>
      query={query}
      columns={COLUMNS}
      rows={visible}
      total={total}
      getRowId={(row) => row.id}
      tabs={{
        id: 'tone',
        allLabel: 'All',
        options: Object.entries(TONE_LABEL).map(([value, label]) => ({ value, label })),
      }}
      facets={[
        { id: 'owner', label: 'Owner', options: OWNERS.map((o) => ({ value: o, label: o })) },
      ]}
      expandable={{
        isExpandable: (row) => row.gaps.length > 0,
        getSubRows: (row) => row.gaps,
        getSubRowId: (sub, row) => `${row.id}-${sub.requirement}`,
        renderSubCell: (sub, columnId) => {
          if (columnId === 'client') return sub.requirement;
          if (columnId === 'owner') return sub.owner;
          if (columnId === 'tone') return <StatusIndicator tone="warning" label="Gap" size="sm" />;
          return null;
        },
      }}
      actions={<DropdownSpecimen />}
    />
  );
}
