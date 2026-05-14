import { useMemo, useState, useCallback } from 'react';

export interface BulkSelection<T extends { id: string }> {
  selectedIds: Set<string>;
  selectedItems: T[];
  allSelected: boolean;
  someSelected: boolean;
  noneSelected: boolean;
  count: number;
  toggleOne: (id: string) => void;
  toggleAll: (items: T[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export function useBulkSelection<T extends { id: string }>(items: T[]): BulkSelection<T> {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds],
  );
  const allSelected = items.length > 0 && items.every((i) => selectedIds.has(i.id));
  const someSelected = !allSelected && items.some((i) => selectedIds.has(i.id));
  const noneSelected = selectedIds.size === 0;
  const count = selectedIds.size;

  const toggleOne = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback((currentItems: T[]) => {
    setSelectedIds((prev) => {
      if (currentItems.every((i) => prev.has(i.id))) return new Set();
      return new Set(currentItems.map((i) => i.id));
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    selectedItems,
    allSelected,
    someSelected,
    noneSelected,
    count,
    toggleOne,
    toggleAll,
    clear,
    isSelected,
  };
}
