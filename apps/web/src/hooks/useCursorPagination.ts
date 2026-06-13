import { useState } from 'react';

/**
 * Cursor-stack pagination for the operational lists. The API returns
 * `{ items, nextCursor }`; this tracks the cursors visited so Previous/Next
 * work without the server supporting offset paging.
 *
 * `token` is a serialized signature of the active filters/search. When it
 * changes the stack is treated as empty (back to page 1) WITHOUT a setState in
 * an effect — the react-hooks linter rejects effect-driven resets, so the reset
 * is derived in render instead.
 */
export interface CursorPagination {
  /** Cursor to send to the API for the current page (undefined = first page). */
  cursor: string | undefined;
  /** 1-based page number. */
  page: number;
  hasPrevious: boolean;
  /** Advance using the nextCursor the current page returned (no-op if null). */
  goNext: (nextCursor: string | null | undefined) => void;
  goPrevious: () => void;
}

export function useCursorPagination(token: string): CursorPagination {
  const [state, setState] = useState<{ token: string; stack: string[] }>({ token, stack: [] });
  const stack = state.token === token ? state.stack : [];

  return {
    cursor: stack[stack.length - 1],
    page: stack.length + 1,
    hasPrevious: stack.length > 0,
    goNext: (nextCursor) => {
      if (!nextCursor) return;
      setState((s) => {
        const base = s.token === token ? s.stack : [];
        return { token, stack: [...base, nextCursor] };
      });
    },
    goPrevious: () => {
      setState((s) => {
        const base = s.token === token ? s.stack : [];
        return { token, stack: base.slice(0, -1) };
      });
    },
  };
}
