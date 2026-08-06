// useSheetParam — binds an open record sheet to the URL.
//
// A sheet whose open state lives in `useState` is invisible to the address bar:
// it cannot be linked to a colleague, Back does not close it (Back leaves the
// page instead, which is worse than useless), and a refresh loses it. Putting
// the open record id in the query string fixes all three at once, and it is the
// same doctrine the list state already follows — see the MERGE LAW note in
// lib/table/list-search-params.ts.
//
// HISTORY MODE IS `push`, deliberately. Opening a record is moving between
// views, not refining one, so it earns a history entry and Back closes the
// sheet. Filters and sort stay on `replace` for exactly the opposite reason.
// (docs/design-system/url-param-audit.md §6.)
//
// The write MERGES: nuqs touches only this key, so opening a record from a
// filtered, sorted, paginated list keeps every one of those params — the class
// of bug the audit found in five object-literal `setSearchParams` call sites.

import { useCallback, useMemo } from 'react';

import { parseAsString, useQueryState } from 'nuqs';

/** Query key used when a surface has exactly one kind of record to open. */
export const DEFAULT_SHEET_KEY = 'record';

export interface SheetParam {
  /** The open record's id, or null when the sheet is closed. */
  openId: string | null;
  isOpen: boolean;
  /** Open the sheet on a record. Pushes a history entry. */
  open: (id: string) => void;
  /** Close the sheet. Pushes, so Back reopens what you just closed. */
  close: () => void;
  /**
   * Pass straight to `<Sheet open={…} onOpenChange={…}>`. Radix calls this with
   * `false` for Esc, the overlay and the close button, so all three routes out
   * of the sheet go through the URL rather than around it.
   */
  onOpenChange: (next: boolean) => void;
}

/**
 * @param key Query-string key. Override when one surface opens two kinds of
 *            record (e.g. `contact` and `company`) so the two sheets cannot
 *            fight over one param.
 */
export function useSheetParam(key: string = DEFAULT_SHEET_KEY): SheetParam {
  const [openId, setOpenId] = useQueryState(key, parseAsString.withOptions({ history: 'push' }));

  const open = useCallback(
    (id: string) => {
      void setOpenId(id);
    },
    [setOpenId],
  );

  const close = useCallback(() => {
    // null, not '' — nuqs removes the key entirely, so a closed sheet leaves no
    // trace in a URL the user might copy.
    void setOpenId(null);
  }, [setOpenId]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) void setOpenId(null);
    },
    [setOpenId],
  );

  return useMemo(
    () => ({ openId, isOpen: openId !== null, open, close, onOpenChange }),
    [openId, open, close, onOpenChange],
  );
}
