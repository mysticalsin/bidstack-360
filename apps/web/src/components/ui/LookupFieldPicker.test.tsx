import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LookupFieldPicker, type LookupOption } from './LookupFieldPicker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const SEARCHING = 'Searching…';
const NO_RESULTS = 'No results.';
const FAILED = 'Search could not be completed.';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPicker(onSearch: (query: string) => Promise<LookupOption[]>) {
  return render(
    <LookupFieldPicker
      value={null}
      onChange={() => {}}
      onSearch={onSearch}
      debounceMs={300}
      label="Search companies"
    />,
  );
}

function typeQuery(value: string) {
  const input = screen.getByRole('combobox', { name: 'Search companies' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
}

describe('LookupFieldPicker unread search', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not call an older empty reply a miss while the current query has not been sent', async () => {
    // WHY: the picker set loading false when any reply landed. An empty reply
    // for "si" arrived after the box had moved to "sie", and before that
    // search was sent, so the list said "No results." for a query that had
    // not arrived.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = new Map<string, ReturnType<typeof deferred<LookupOption[]>>>();
    const onSearch = vi.fn((query: string) => {
      const gate = deferred<LookupOption[]>();
      pending.set(query, gate);
      return gate.promise;
    });
    renderPicker(onSearch);

    typeQuery('si');
    await vi.advanceTimersByTimeAsync(300);
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('si');

    typeQuery('sie');
    await act(async () => {
      pending.get('si')?.resolve([]);
    });

    expect(screen.queryByText(NO_RESULTS)).toBeNull();
    expect(screen.getByText(SEARCHING)).toBeTruthy();
    expect(onSearch).not.toHaveBeenCalledWith('sie');
  });

  it('says the search could not be completed when the read fails', async () => {
    // WHY: a rejected company search left the spinner up, and clearing that
    // spinner with an empty list would say "No results." A failed read is
    // not an empty catalog.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = new Map<string, ReturnType<typeof deferred<LookupOption[]>>>();
    const onSearch = vi.fn((query: string) => {
      const gate = deferred<LookupOption[]>();
      pending.set(query, gate);
      return gate.promise;
    });
    renderPicker(onSearch);

    typeQuery('acme');
    await vi.advanceTimersByTimeAsync(300);
    await act(async () => {
      pending.get('acme')?.reject(new Error('search unavailable'));
    });

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText(NO_RESULTS)).toBeNull();
    expect(screen.queryByText(SEARCHING)).toBeNull();
  });

  it('still says no results after the current search returns none', async () => {
    // WHY: a finished read with no rows is a real miss. The unread and
    // failed copy must not replace that sentence.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = new Map<string, ReturnType<typeof deferred<LookupOption[]>>>();
    const onSearch = vi.fn((query: string) => {
      const gate = deferred<LookupOption[]>();
      pending.set(query, gate);
      return gate.promise;
    });
    renderPicker(onSearch);

    typeQuery('zzzz');
    await vi.advanceTimersByTimeAsync(300);
    await act(async () => {
      pending.get('zzzz')?.resolve([]);
    });

    expect(screen.getByText(NO_RESULTS)).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText(SEARCHING)).toBeNull();
  });

  it('keeps a company that already arrived when an older empty reply lands', async () => {
    // WHY: "sie" had already returned Siemens. The older "si" reply was
    // empty and wiped that row, so a company on screen read as a miss.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = new Map<string, ReturnType<typeof deferred<LookupOption[]>>>();
    const onSearch = vi.fn((query: string) => {
      const gate = deferred<LookupOption[]>();
      pending.set(query, gate);
      return gate.promise;
    });
    renderPicker(onSearch);

    typeQuery('si');
    await vi.advanceTimersByTimeAsync(300);
    typeQuery('sie');
    await vi.advanceTimersByTimeAsync(300);
    await act(async () => {
      pending.get('sie')?.resolve([{ id: 'co-siemens', label: 'Siemens' }]);
    });
    expect(screen.getByText('Siemens')).toBeTruthy();

    await act(async () => {
      pending.get('si')?.resolve([]);
    });

    expect(screen.getByText('Siemens')).toBeTruthy();
    expect(screen.queryByText(NO_RESULTS)).toBeNull();
  });
});
