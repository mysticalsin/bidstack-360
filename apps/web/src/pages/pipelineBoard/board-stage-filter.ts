export interface BoardStageFilterColumn {
  id: string;
  key?: string | null;
}

export type BoardStageFilter =
  | { kind: 'all' }
  | { kind: 'column'; id: string }
  | { kind: 'missing' };

/**
 * Resolve `?pipelineStageId=` to one column.
 *
 * A column id selects that column. The demo stage key is the same query the
 * opportunities list still writes. Once the bid sits on the short-named
 * column, that key is not a column id, and an id-only match draws nothing.
 * The key then selects the column that carries it.
 *
 * An enum-only bid still has a column whose id is the key. That id wins, so
 * the filter does not jump to an empty short-named column that shares the key.
 * Anything else matched no column. It is not the whole board.
 */
export function resolveBoardStageFilter(
  stageFilter: string | null,
  columns: BoardStageFilterColumn[],
): BoardStageFilter {
  if (!stageFilter) return { kind: 'all' };
  if (columns.some((column) => column.id === stageFilter)) {
    return { kind: 'column', id: stageFilter };
  }
  const byKey = columns.find(
    (column) => column.key != null && column.key !== '' && column.key === stageFilter,
  );
  if (byKey) return { kind: 'column', id: byKey.id };
  return { kind: 'missing' };
}
