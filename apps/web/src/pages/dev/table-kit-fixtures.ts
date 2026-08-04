/**
 * Fixture data + a local TableQueryState for the /dev/table-kit specimen sheet.
 *
 * Split out of TableKitPlayground.tsx to keep both files inside the 400-line
 * budget. Bid-desk shaped on purpose: a reviewer has to be able to tell at a
 * glance whether density, number alignment and null rendering survived the
 * port — lorem rows hide exactly those defects.
 */
import { useCallback, useMemo, useState } from 'react';

import type { StatusTone } from '@/components/table-kit/status-indicator';
import type { SortDirection, TableQueryState } from '@/lib/table/table-query';

export const TONES: StatusTone[] = ['neutral', 'info', 'success', 'warning', 'error'];

export const TONE_LABEL: Record<StatusTone, string> = {
  neutral: 'Not started',
  info: 'In review',
  success: 'Submitted',
  warning: 'At risk',
  error: 'Missed deadline',
};

export type ProposalRow = {
  id: string;
  client: string;
  lot: string;
  owner: string;
  tone: StatusTone;
  value: number | null;
  due: string | null;
  gaps: { requirement: string; owner: string }[];
};

const SEED: Omit<ProposalRow, 'id'>[] = [
  { client: 'Crédit Agricole', lot: 'Lot 2 — Data platform', owner: 'N. Bertrand', tone: 'success', value: 1_240_000, due: '12 Aug', gaps: [] },
  { client: 'Enedis', lot: 'Lot 1 — Field mobility', owner: 'S. Okonkwo', tone: 'warning', value: 860_000, due: '04 Aug', gaps: [{ requirement: 'ISO 27001 certificate', owner: 'Legal' }, { requirement: 'Named security officer', owner: 'Delivery' }] },
  { client: 'Ministère des Armées', lot: 'Tranche ferme', owner: 'A. Lefèvre', tone: 'info', value: 3_100_000, due: null, gaps: [{ requirement: 'Habilitation Secret', owner: 'HR' }] },
  { client: 'Vinci Energies', lot: 'Lot 4 — TMA', owner: 'M. Duarte', tone: 'neutral', value: null, due: '29 Sep', gaps: [] },
  { client: 'SNCF Réseau', lot: 'Lot 3 — Cyber', owner: 'S. Okonkwo', tone: 'error', value: 540_000, due: '18 Jul', gaps: [] },
  { client: 'Orange Business', lot: 'Lot 1 — Cloud FinOps', owner: 'N. Bertrand', tone: 'info', value: 1_980_000, due: '22 Aug', gaps: [] },
  { client: 'Groupe ADP', lot: 'Accord-cadre', owner: 'A. Lefèvre', tone: 'success', value: 2_450_000, due: '05 Sep', gaps: [] },
  { client: 'Sanofi', lot: 'Lot 2 — MLOps', owner: 'M. Duarte', tone: 'warning', value: 720_000, due: '31 Jul', gaps: [{ requirement: 'GxP validation plan', owner: 'Quality' }] },
];

// Reference numbers descend from a fixed base so the table has something real
// to sort on and the ids stay stable across renders.
export const PROPOSALS: ProposalRow[] = Array.from({ length: 24 }, (_, i) => ({
  // Modulo over a non-empty literal array always hits — the assertion is for
  // noUncheckedIndexedAccess, not for a real absence case.
  ...SEED[i % SEED.length]!,
  id: `BID-${2411 - i}`,
}));

export const OWNERS = ['N. Bertrand', 'S. Okonkwo', 'A. Lefèvre', 'M. Duarte'];

export const EUR = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

/**
 * A TableQueryState backed by useState instead of the URL.
 *
 * WHY not nuqs here: the specimen sheet is a dev surface that should be
 * reloadable into a known-clean state, and pushing eight fixture params into
 * the address bar would make the playground's own URL unshareable. Product
 * surfaces get the nuqs-backed hook in Phase 3; this only has to satisfy the
 * same interface so DataTable can't tell the difference.
 */
export function useFixtureQuery(initial?: Partial<TableQueryState>): TableQueryState {
  const [sort, setSortState] = useState(initial?.sort ?? 'id');
  const [dir, setDir] = useState<SortDirection>(initial?.dir ?? 'desc');
  const [page, setPage] = useState(initial?.page ?? 1);
  const [tab, setTab] = useState(initial?.tab ?? '');
  const [filters, setFilters] = useState<Record<string, string>>(initial?.filters ?? {});

  const setSort = useCallback((id: string) => {
    setSortState(id);
    setPage(1);
  }, []);

  const toggleSort = useCallback(
    (id: string) => {
      if (id === sort) {
        setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortState(id);
        setDir('asc');
      }
      setPage(1);
    },
    [sort],
  );

  const setFilter = useCallback((id: string, value: string) => {
    setFilters((prev) => ({ ...prev, [id]: value }));
    setPage(1);
  }, []);

  return useMemo(
    () => ({
      sort,
      dir,
      page,
      pageSize: initial?.pageSize ?? 8,
      tab,
      filters,
      toggleSort,
      setSort,
      setDir,
      setPage,
      setTab: (value: string) => {
        setTab(value);
        setPage(1);
      },
      setFilter,
    }),
    [sort, dir, page, tab, filters, initial?.pageSize, toggleSort, setSort, setFilter],
  );
}

/** Client-side sort → filter → page, so the specimen actually responds. */
export function applyQuery(
  rows: ProposalRow[],
  query: TableQueryState,
): { visible: ProposalRow[]; total: number } {
  const owner = query.filters.owner ?? '';
  const filtered = rows.filter((row) => {
    if (owner && row.owner !== owner) return false;
    if (query.tab && row.tone !== query.tab) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const factor = query.dir === 'asc' ? 1 : -1;
    if (query.sort === 'value') return ((a.value ?? -1) - (b.value ?? -1)) * factor;
    if (query.sort === 'client') return a.client.localeCompare(b.client) * factor;
    return a.id.localeCompare(b.id) * factor;
  });

  const start = (query.page - 1) * query.pageSize;
  return { visible: sorted.slice(start, start + query.pageSize), total: sorted.length };
}
