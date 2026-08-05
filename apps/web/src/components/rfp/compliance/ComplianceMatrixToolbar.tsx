// The matrix's facet bar: status (the tab), section, mandatory.
//
// The dropdown grammar is DataTable's, deliberately — the matrix renders its
// own body (it has a strip row and a detail row per requirement, which
// DataTable's column-shaped sub-rows cannot express), but its toolbar must not
// invent a second vocabulary for "filter this list". Same primitive, same
// trigger shape, same "the label IS the reset option" behaviour.

import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/table-kit/dropdown-menu';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { ListTableQueryState } from '@/lib/table/use-table-query';

import { ALL } from './compliance-matrix-rows';

export interface FacetOption {
  value: string;
  label: string;
}

export interface ComplianceMatrixToolbarProps {
  query: ListTableQueryState;
  statusOptions: FacetOption[];
  sectionOptions: FacetOption[];
  /** Rows behind each status, so an empty tab can be hidden rather than offered. */
  statusCounts: Record<string, number>;
}

export function ComplianceMatrixToolbar({
  query,
  statusOptions,
  sectionOptions,
  statusCounts,
}: ComplianceMatrixToolbarProps) {
  const { t } = useTranslation('rfp');

  const mandatoryOptions: FacetOption[] = [
    { value: 'yes', label: t('compliance.mandatoryYes', 'Mandatory only') },
    { value: 'no', label: t('compliance.mandatoryNo', 'Optional only') },
  ];

  const activeFilters =
    (query.tab !== ALL ? 1 : 0) +
    Object.entries(query.filters).filter(([, value]) => value !== ALL).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FacetMenu
        label={t('compliance.facetStatus', 'Status')}
        value={query.tab}
        options={statusOptions.filter((option) => statusCounts[option.value] !== 0)}
        onChange={(value) => query.setTab(value)}
      />
      {sectionOptions.length > 0 && (
        <FacetMenu
          label={t('compliance.facetSection', 'Section')}
          value={query.filters.section ?? ALL}
          options={sectionOptions}
          onChange={(value) => query.setFilter('section', value)}
        />
      )}
      <FacetMenu
        label={t('compliance.facetMandatory', 'Mandatory')}
        value={query.filters.mandatory ?? ALL}
        options={mandatoryOptions}
        onChange={(value) => query.setFilter('mandatory', value)}
      />
      {activeFilters > 0 && (
        <Button variant="ghost" size="sm" onClick={query.resetFilters}>
          {t('compliance.clearFilters', 'Clear filters')}
        </Button>
      )}
    </div>
  );
}

function FacetMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: FacetOption[];
  onChange: (value: string) => void;
}) {
  const active = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" className="justify-between">
          <span className="truncate">{active ? active.label : label}</span>
          <Icon name="chevron-down" size={14} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {/* The facet's own name IS the "no filter" option — one row, no
              redundant "All statuses" entry beside a header that says Status. */}
          <DropdownMenuRadioItem value={ALL}>{label}</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
