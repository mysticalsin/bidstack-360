// Ported verbatim from D:\CRM\packages\ui\src\lib\table-query.ts (17 lines).
// Pure types — zero token or API rewrites needed (ROUND2-ULTRAPLAN manifest #16).
//
// The contract every list surface's URL-state hook satisfies so table-kit
// components can stay headless: they read this shape, they never own it.

export type SortDirection = 'asc' | 'desc';

export type TableQueryState = {
  sort: string;
  dir: SortDirection;
  page: number;
  pageSize: number;
  tab: string;
  tabId?: string;
  filters: Record<string, string>;
  toggleSort: (id: string) => void;
  setSort: (id: string) => void;
  setDir: (dir: SortDirection) => void;
  setPage: (page: number) => void;
  setTab: (value: string) => void;
  setFilter: (id: string, value: string) => void;
};
