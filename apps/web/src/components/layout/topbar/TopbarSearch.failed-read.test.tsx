// The header search box lists recent queries from localStorage. A blocked or
// corrupt read used to render the same blank box as a history that arrived
// empty, so a failed read looked like the person had no recent searches.
// The empty sentence is only honest after the payload has arrived.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

const STORAGE_KEY = 'bidstack-recent-searches.v1';
const FAILED = 'Recent searches could not be read. They have not arrived.';

async function focusSearch(): Promise<void> {
  vi.resetModules();
  const { SearchBar } = await import('./TopbarSearch');
  render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
      <SearchBar />
    </MemoryRouter>,
  );
  fireEvent.focus(screen.getByRole('combobox', { name: /search opportunities, contacts, tasks/i }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('header search recent history', () => {
  it('does not treat a corrupt recent-search read as an empty history', async () => {
    // WHY: "{" is not a list of searches. Catching the parse and rendering
    // nothing is the same blank box as a history that arrived empty. The
    // person cannot tell the read failed.
    localStorage.setItem(STORAGE_KEY, '{');
    await focusSearch();

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: /recent searches/i })).toBeNull();
    expect(screen.queryByText('No recent searches')).toBeNull();
    expect(screen.queryByText('No matches.')).toBeNull();
  });

  it('does not treat a blocked recent-search read as an empty history', async () => {
    // WHY: a thrown storage read has not arrived. Swallowing it leaves the
    // same blank box as no history, which says the list was read and was empty.
    const original = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key === STORAGE_KEY) throw new Error('storage blocked');
      return original.call(this, key);
    });
    await focusSearch();

    expect(screen.getByText(FAILED)).toBeTruthy();
    expect(screen.queryByText('No recent searches')).toBeNull();
    expect(screen.queryByText('No matches.')).toBeNull();
  });

  it('stays quiet when the history arrived empty', async () => {
    // WHY: a missing key is a finished read with no queries. The failure
    // sentence must not replace that, and the box must not grow a false
    // "no recent searches" or "no matches" line.
    localStorage.removeItem(STORAGE_KEY);
    await focusSearch();

    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('No recent searches')).toBeNull();
    expect(screen.queryByText('No matches.')).toBeNull();
    expect(screen.queryByRole('listbox', { name: /recent searches/i })).toBeNull();
  });

  it('still lists a recent query that arrived', async () => {
    // WHY: the failure sentence replaces a false empty history. It must not
    // replace Zephyrine, which was stored and read.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['Zephyrine']));
    await focusSearch();

    expect(screen.getByRole('option', { name: 'Zephyrine' })).toBeTruthy();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByText('No matches.')).toBeNull();
  });
});
