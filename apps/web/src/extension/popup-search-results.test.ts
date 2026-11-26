// The extension search panel (popup #search-results) paints "No results found"
// when the reply has no list, when the read is paused, and when an older empty
// reply lands while a newer query is still the one in the box. A rejected read
// with no message paints a blank line. Those are not a settled empty list.
// "No results found" is only honest after this query's list arrived empty.
// A row that arrived stays on the list.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const popupPath = path.resolve(here, '../../../../apps/chrome-extension/src/popup/popup.js');
const readPath = path.resolve(here, '../../../../apps/chrome-extension/src/popup/search-results-read.js');

const NOT_ARRIVED = 'Search results have not arrived.';
const DID_NOT_LOAD = 'Search results did not load.';
const EMPTY = 'No results found';
const SEARCHING = 'Searching…';

type SearchRow = { name?: string; type?: string; url?: string };
type SearchPaint = { kind: string; text: string; items: SearchRow[] };
type PaintInput = {
  activeQuery: string;
  requestQuery: string;
  phase: 'pending' | 'paused' | 'resolved' | 'rejected';
  payload: unknown;
};

const { paintExtensionSearch } = (await import(pathToFileURL(readPath).href)) as {
  paintExtensionSearch: (input: PaintInput) => SearchPaint;
};

const zephyrine = {
  name: 'Zephyrine',
  type: 'lead',
  url: 'https://example.test/leads/zephyrine',
};

describe('extension search results', () => {
  it('does not call a missing list an empty result set', () => {
    // WHY: a resolved reply with no `data` array has not arrived. Coercing it
    // with `?? []` paints the same "No results found" as a list that arrived
    // empty, so the person cannot tell the payload never came.
    const missing = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zephyrine',
      phase: 'resolved',
      payload: {},
    });
    const absent = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zephyrine',
      phase: 'resolved',
      payload: null,
    });

    expect(missing.text).toBe(NOT_ARRIVED);
    expect(absent.text).toBe(NOT_ARRIVED);
    expect(missing.text).not.toBe(EMPTY);
    expect(absent.kind).not.toBe('empty');
    expect(missing.kind).toBe('unread');
  });

  it('does not call a paused read an empty result set', () => {
    // WHY: a paused read has not arrived. The panel must not use the empty
    // sentence while the list is still held.
    const paused = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zephyrine',
      phase: 'paused',
      payload: null,
    });

    expect(paused.text).toBe(NOT_ARRIVED);
    expect(paused.text).not.toBe(EMPTY);
    expect(paused.kind).toBe('unread');
  });

  it('does not let an older empty reply speak for the query still in flight', () => {
    // WHY: the box moved on to Zephyrine while the reply for "Zep" came back
    // empty. Painting "No results found" says the current query finished and
    // matched nothing. That reply is not this query.
    const stale = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zep',
      phase: 'resolved',
      payload: { data: [] },
    });

    expect(stale.text).toBe(SEARCHING);
    expect(stale.text).not.toBe(EMPTY);
    expect(stale.kind).toBe('searching');
  });

  it('does not leave a failed read blank or empty', () => {
    // WHY: a rejected read did not load. An empty error message used to leave
    // a blank line, which reads the same as no search. It must not say the
    // list arrived empty.
    const failed = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zephyrine',
      phase: 'rejected',
      payload: null,
    });

    expect(failed.text).toBe(DID_NOT_LOAD);
    expect(failed.text).not.toBe('');
    expect(failed.text).not.toBe(EMPTY);
    expect(failed.kind).toBe('failed');
  });

  it('still says empty when this query’s list arrived with no rows', () => {
    // WHY: the unread and failed sentences replace a false empty. They must
    // not replace a finished list that really had no rows.
    const empty = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zephyrine',
      phase: 'resolved',
      payload: { data: [] },
    });

    expect(empty.text).toBe(EMPTY);
    expect(empty.kind).toBe('empty');
    expect(empty.text).not.toBe(NOT_ARRIVED);
    expect(empty.text).not.toBe(DID_NOT_LOAD);
  });

  it('still lists a row that arrived', () => {
    // WHY: the new sentences are for reads that have not arrived or did not
    // load. Zephyrine was in the payload and must stay on the list.
    const ready = paintExtensionSearch({
      activeQuery: 'Zephyrine',
      requestQuery: 'Zephyrine',
      phase: 'resolved',
      payload: { data: [zephyrine] },
    });

    expect(ready.kind).toBe('ready');
    expect(ready.items.map((row) => row.name)).toEqual(['Zephyrine']);
    expect(ready.text).not.toBe(NOT_ARRIVED);
    expect(ready.text).not.toBe(DID_NOT_LOAD);
    expect(ready.text).not.toBe(EMPTY);
  });

  it('keeps the popup on that decision instead of coercing a missing list', () => {
    // WHY: a helper that the popup never calls leaves #search-results on
    // `result?.data ?? []`, which is the empty sentence for a list that has
    // not arrived. The panel has to drop a reply that is no longer current.
    const popup = readFileSync(popupPath, 'utf8');
    const reader = readFileSync(readPath, 'utf8');

    expect(popup).toContain("from './search-results-read.js'");
    expect(popup).toContain('paintExtensionSearch(');
    expect(popup).not.toContain('result?.data ?? []');
    expect(popup).not.toContain('No results found');
    expect(popup).toContain('token !== generation');
    expect(reader).toContain(NOT_ARRIVED);
    expect(reader).toContain(DID_NOT_LOAD);
    expect(reader).toContain(EMPTY);
  });
});
