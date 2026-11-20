// The All accounts filter row is the gate in front of the cards. At a 1280px
// viewport the page column is 992px (232px rail + 28px padding each side).
// Search plus the four selects have to share that row. They do not today:
// FilterSelect wears the shared `.input` rule, which is unlayered
// `width: 100%`, so each select takes a full line and the cards start below
// the fold. A long industry name must not stretch its box either — the option
// stays in the list, the box stays capped.
//
// These bounds are the contract: empty (search only), one select, many
// selects, a long option label, and the 1280px column. happy-dom does not
// flex-layout, so the test reads the flex basis and max width the row actually
// sets and checks that those minima fit in 992px.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FilterRow, FilterSelect } from './AccountsChrome';

/** 9rem. Real basis — `flex: 1 1 0%` would let the field collapse. Grows into leftover space. */
const SEARCH_BASIS_PX = 144;
/** 11rem. Wide enough for "Sort: pipeline value" once Reset takes 84px on the same row. */
const SELECT_BASIS_PX = 176;
/** 14rem. A long industry name cannot grow the closed control past this. */
const SELECT_MAX_PX = 224;
const GAP_PX = 12;
/** Expanded rail (DESIGN.md 9.4) plus `.page` padding 28px × 2. */
const CONTENT_AT_1280_PX = 1280 - 232 - 56;

const LONG_INDUSTRY =
  'North American Specialty Pharmaceutical Distribution and Hospital Systems';

function renderFilters(labels: string[], showReset = false) {
  return render(
    <FilterRow
      ariaLabel="Filters"
      searchId="accounts-filter-layout-search"
      searchLabel="Search"
      searchPlaceholder="Search by name or domain"
      searchValue=""
      onSearchChange={() => undefined}
      onReset={() => undefined}
      resetLabel="Reset"
      showReset={showReset}
    >
      {labels.map((label) => (
        <FilterSelect key={label} ariaLabel={label} value="" onChange={() => undefined}>
          <option value="">{label}</option>
        </FilterSelect>
      ))}
    </FilterRow>,
  );
}

function basisPx(el: HTMLElement | null): number {
  const flex = el?.style.flex ?? '';
  const match = /^\d+ 1 (\d+)px$/.exec(flex);
  return match ? Number(match[1]) : 0;
}

function searchBox(): HTMLElement {
  const input = screen.getByRole('searchbox', { name: 'Search' });
  const box = input.parentElement;
  if (!box) throw new Error('search field has no wrapper');
  return box;
}

function selectBoxes(): HTMLElement[] {
  return screen.getAllByRole('combobox').map((select) => {
    const box = select.parentElement;
    expect(box, 'each select sits in its own capped box').toBeTruthy();
    expect(box).not.toBe(select.closest('[role="search"]'));
    return box as HTMLElement;
  });
}

function controlsOnFirstRow(bases: number[], content: number): number {
  let used = 0;
  let count = 0;
  for (const basis of bases) {
    const next = used + (count > 0 ? GAP_PX : 0) + basis;
    if (count > 0 && next > content) break;
    used = next;
    count += 1;
  }
  return count;
}

describe('account filter row at 1280px', () => {
  afterEach(cleanup);

  it('keeps a real basis on the search field when there are no selects', () => {
    renderFilters([]);

    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(basisPx(searchBox())).toBe(SEARCH_BASIS_PX);
    expect(searchBox().style.minWidth).toBe('0px');
  });

  it('caps the one select so a single filter shares the row with search', () => {
    renderFilters(['Industry']);

    const [box] = selectBoxes();
    expect(basisPx(searchBox())).toBe(SEARCH_BASIS_PX);
    expect(basisPx(box)).toBe(SELECT_BASIS_PX);
    expect(box.style.maxWidth).toBe(`${SELECT_MAX_PX}px`);
    expect(box.style.minWidth).toBe('0px');
    expect(
      controlsOnFirstRow([SEARCH_BASIS_PX, SELECT_BASIS_PX], CONTENT_AT_1280_PX),
    ).toBe(2);
  });

  it('puts search and all four selects on the first row when many filters are open', () => {
    const labels = ['Industry', 'Technology', 'MSA leverage', 'Sort'];
    renderFilters(labels, true);

    const boxes = selectBoxes();
    expect(boxes).toHaveLength(4);
    const bases = [basisPx(searchBox()), ...boxes.map((box) => basisPx(box))];
    expect(bases).toEqual([
      SEARCH_BASIS_PX,
      SELECT_BASIS_PX,
      SELECT_BASIS_PX,
      SELECT_BASIS_PX,
      SELECT_BASIS_PX,
    ]);
    expect(controlsOnFirstRow(bases, CONTENT_AT_1280_PX)).toBe(5);
    // Reset stays in the same row. 84px is the measured width of the labelled
    // button (icon + "Reset" + padding) at 1280px, plus the gap before it.
    const rowMin =
      bases.reduce((sum, basis) => sum + basis, 0) + GAP_PX * bases.length + 84;
    expect(rowMin).toBeLessThanOrEqual(CONTENT_AT_1280_PX);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy();
  });

  it('keeps a long option in the list and refuses to widen the closed box for it', () => {
    renderFilters([LONG_INDUSTRY]);

    expect(screen.getByRole('option', { name: LONG_INDUSTRY }).textContent).toBe(LONG_INDUSTRY);
    const [box] = selectBoxes();
    expect(box.style.maxWidth).toBe(`${SELECT_MAX_PX}px`);
    expect(SELECT_MAX_PX).toBeLessThan(LONG_INDUSTRY.length * 7);
    expect(basisPx(box)).toBe(SELECT_BASIS_PX);
  });

  it('fits search plus four selects inside the 1280px page column', () => {
    expect(CONTENT_AT_1280_PX).toBe(992);
    renderFilters(['Industry', 'Technology', 'MSA leverage', 'Sort']);

    const bases = [basisPx(searchBox()), ...selectBoxes().map((box) => basisPx(box))];
    expect(controlsOnFirstRow(bases, CONTENT_AT_1280_PX)).toBe(bases.length);
    for (const box of selectBoxes()) {
      expect(Number.parseFloat(box.style.maxWidth)).toBeLessThanOrEqual(SELECT_MAX_PX);
    }
  });
});
