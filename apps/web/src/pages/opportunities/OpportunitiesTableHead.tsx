/**
 * opportunities/OpportunitiesTableHead.tsx — sticky sortable <thead> for the
 * OpportunitiesPage table.
 *
 * WHY separate: the thead contains 8 columns of <SortableHeader> boilerplate
 * (84 lines) that has no dependency on data or mutations — only on sort state
 * and bulk-select state. Extracting it keeps OpportunitiesPage under the
 * 400-line cap and makes the column layout independently editable.
 */
import { useTranslation } from 'react-i18next';

import { getSortableHeaderAriaSort, SortableHeader } from '@/components/ui/SortableHeader';

type OppSortKey = 'code' | 'name' | 'customer' | 'stage' | 'value' | 'probability' | 'dueDate';

interface SortState {
  key: OppSortKey | null;
  dir: 'asc' | 'desc' | null;
}

interface Props {
  sortState: SortState;
  setSortState: (next: SortState) => void;
  allSelected: boolean;
  someSelected: boolean;
  toggleAll: () => void;
}

export function OpportunitiesTableHead({
  sortState,
  setSortState,
  allSelected,
  someSelected,
  toggleAll,
}: Props) {
  const { t } = useTranslation('crm');
  return (
    <thead className="sticky top-0 z-10 bg-[var(--surface-sunken)] text-xs uppercase tracking-wider text-[var(--fg-secondary)]">
      <tr>
        <th scope="col" className="w-10 px-5 py-3">
          <label className="table-checkbox-hit">
            <span className="sr-only">
              {allSelected
                ? t('opportunitiesTableHead.deselectAll', 'Deselect all')
                : t('opportunitiesTableHead.selectAll', 'Select all')}
            </span>
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected;
              }}
              onChange={toggleAll}
              className="cursor-pointer accent-[var(--brand-primary)]"
            />
          </label>
        </th>
        <th
          scope="col"
          aria-sort={getSortableHeaderAriaSort('code', sortState)}
          className="px-5 py-3 font-semibold"
        >
          <SortableHeader columnKey="code" state={sortState} onChange={setSortState}>
            {t('opportunitiesTableHead.columnCode', 'Code')}
          </SortableHeader>
        </th>
        <th
          scope="col"
          aria-sort={getSortableHeaderAriaSort('name', sortState)}
          className="px-5 py-3 font-semibold"
        >
          <SortableHeader columnKey="name" state={sortState} onChange={setSortState}>
            {t('opportunitiesTableHead.columnOpportunity', 'Opportunity')}
          </SortableHeader>
        </th>
        <th scope="col" className="px-5 py-3 font-semibold">
          {t('opportunitiesTableHead.columnTerritory', 'Territory')}
        </th>
        <th
          scope="col"
          aria-sort={getSortableHeaderAriaSort('stage', sortState)}
          className="px-5 py-3 font-semibold"
        >
          <SortableHeader columnKey="stage" state={sortState} onChange={setSortState}>
            {t('opportunitiesTableHead.columnStage', 'Stage')}
          </SortableHeader>
        </th>
        <th
          scope="col"
          aria-sort={getSortableHeaderAriaSort('value', sortState)}
          className="px-5 py-3 font-semibold"
        >
          <SortableHeader columnKey="value" state={sortState} onChange={setSortState} align="right">
            {t('opportunitiesTableHead.columnValue', 'Value')}
          </SortableHeader>
        </th>
        <th
          scope="col"
          aria-sort={getSortableHeaderAriaSort('probability', sortState)}
          className="px-5 py-3 font-semibold"
        >
          <SortableHeader
            columnKey="probability"
            state={sortState}
            onChange={setSortState}
            align="right"
          >
            {t('opportunitiesTableHead.columnProbability', 'Probability')}
          </SortableHeader>
        </th>
        <th
          scope="col"
          aria-sort={getSortableHeaderAriaSort('dueDate', sortState)}
          className="px-5 py-3 font-semibold"
        >
          <SortableHeader columnKey="dueDate" state={sortState} onChange={setSortState}>
            {t('opportunitiesTableHead.columnDue', 'Due')}
          </SortableHeader>
        </th>
      </tr>
    </thead>
  );
}
