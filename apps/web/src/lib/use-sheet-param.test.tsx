// Run against the same stack the app boots — BrowserRouter + the real
// `nuqs/adapters/react-router/v6` adapter over happy-dom's History — for the
// same reason use-table-query.test.tsx does: the two behaviours that matter
// most here (merging into a query string somebody else owns, and Back closing
// the sheet) only exist once real pushState and popstate are in play.

import type { ReactNode } from 'react';

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v6';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { useSheetParam } from '@/lib/use-sheet-param';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </BrowserRouter>
  );
}

function renderAt(url: string, key?: string) {
  window.history.replaceState(null, '', url);
  return renderHook(() => useSheetParam(key), { wrapper });
}

const search = () => new URLSearchParams(window.location.search);

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/proposals');
});

describe('useSheetParam', () => {
  it('opens from a pasted link, so a sheet is shareable', async () => {
    // WHY: the whole point of URL-bound sheets. If a deep link does not open the
    // sheet, "send me the record" goes back to being a screenshot.
    const { result } = renderAt('/proposals?record=p_42');
    expect(result.current.openId).toBe('p_42');
    expect(result.current.isOpen).toBe(true);
  });

  it('is closed when the param is absent', () => {
    const { result } = renderAt('/proposals');
    expect(result.current.openId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it('merges into the query string instead of replacing it', async () => {
    // WHY: opening a record from a filtered, sorted, paginated list must not
    // silently reset that view — the exact class of bug url-param-audit.md §4
    // found in five object-literal setSearchParams call sites.
    const { result } = renderAt('/proposals?status=won&sort=amount&page=3');
    act(() => result.current.open('p_7'));
    await waitFor(() => expect(search().get('record')).toBe('p_7'));
    expect(search().get('status')).toBe('won');
    expect(search().get('sort')).toBe('amount');
    expect(search().get('page')).toBe('3');
  });

  it('removes the key on close rather than leaving an empty value', async () => {
    // A copied URL of a closed sheet should carry no trace of it.
    const { result } = renderAt('/proposals?record=p_7&status=won');
    act(() => result.current.close());
    await waitFor(() => expect(search().has('record')).toBe(false));
    expect(search().get('status')).toBe('won');
  });

  it('Back closes the sheet instead of leaving the page', async () => {
    // WHY: this is the behaviour that makes a sheet feel like part of the list.
    // With useState the browser Back button navigates away, which is worse than
    // doing nothing — the user loses the list as well as the record.
    const { result } = renderAt('/proposals');
    act(() => result.current.open('p_7'));
    await waitFor(() => expect(search().get('record')).toBe('p_7'));

    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(search().has('record')).toBe(false));
    expect(window.location.pathname).toBe('/proposals');
  });

  it('onOpenChange(false) closes; onOpenChange(true) is inert', async () => {
    // Radix drives Esc, the overlay and the close button through this one
    // callback, so all three routes out of the sheet go through the URL. It
    // must not try to invent an id when handed `true`.
    const { result } = renderAt('/proposals?record=p_7');
    act(() => result.current.onOpenChange(true));
    await waitFor(() => expect(search().get('record')).toBe('p_7'));
    act(() => result.current.onOpenChange(false));
    await waitFor(() => expect(search().has('record')).toBe(false));
  });

  it('honours a custom key so two sheets on one surface cannot collide', async () => {
    const { result } = renderAt('/accounts?company=c_1', 'contact');
    expect(result.current.openId).toBeNull();
    act(() => result.current.open('ct_9'));
    await waitFor(() => expect(search().get('contact')).toBe('ct_9'));
    expect(search().get('company')).toBe('c_1');
  });
});
