// Lightweight squarified treemap for "Top Categories" by revenue.
// Hand-rolled (matches the codebase's no-chart-lib stance). The squarify
// algorithm produces tiles whose aspect ratio stays close to 1:1, which
// reads better than a 1D stacked bar.

import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatMoneyMicros } from '@/lib/format';

import type { CategoryRow, TopCategories } from '@bidstack/shared';

interface Props {
  data: TopCategories | undefined;
  isLoading: boolean;
}

const PALETTE = [
  '#2c4bff', // brand-primary
  '#1f8a5b', // jade
  '#f5b400', // amber
  '#ec4899', // rose
  '#8b5cf6', // purple
  '#06b6d4', // teal
  '#f97316', // tomato-soft
  '#10b981', // jade-2
];

export function TopCategoriesTreemap({ data, isLoading }: Props) {
  const [view, setView] = useState<'treemap' | 'list'>('treemap');
  const items = data?.items ?? [];

  return (
    <Card>
      <SectionHeader
        title="Top Categories"
        action={
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <button
              type="button"
              className="text-[var(--brand-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              onClick={() => setView(view === 'treemap' ? 'list' : 'treemap')}
              aria-pressed={view === 'list'}
            >
              {view === 'treemap' ? 'List' : 'Treemap'}
            </button>
            <span aria-hidden>·</span>
            <span>Top {items.length}</span>
          </div>
        }
      />
      {isLoading ? (
        <div className="px-5 py-8 text-sm text-[var(--fg-tertiary)]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-sm text-[var(--fg-tertiary)]">
          No category breakdown yet.
        </div>
      ) : view === 'treemap' ? (
        <Treemap items={items} currency={data?.currency ?? 'CAD'} />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((c, i) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
              <span
                aria-hidden
                className="h-3 w-3 rounded-sm"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <span className="flex-1 truncate text-sm text-[var(--fg-primary)]">{c.name}</span>
              <span className="tabular-nums text-sm text-[var(--fg-primary)] whitespace-nowrap">
                {formatMoneyMicros(c.revenueMicros, data?.currency ?? 'CAD')}
              </span>
              <Badge tone="gray">{c.orders}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  item: CategoryRow;
  color: string;
  share: number;
}

const W = 720;
const H = 240;

function Treemap({ items, currency }: { items: CategoryRow[]; currency: string }) {
  const tiles = useMemo(() => squarify(items), [items]);

  return (
    <div className="px-5 pb-5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ height: H }}
        role="img"
        aria-label="Top categories treemap by revenue"
      >
        {tiles.map((t) => (
          <g key={t.item.id}>
            <rect
              x={t.x + 1}
              y={t.y + 1}
              width={Math.max(0, t.w - 2)}
              height={Math.max(0, t.h - 2)}
              fill={t.color}
              opacity={0.85}
              rx={4}
            >
              <title>{`${t.item.name}: ${formatMoneyMicros(t.item.revenueMicros, currency)} (${t.item.orders} orders)`}</title>
            </rect>
            {t.w > 80 && t.h > 36 ? (
              <text
                x={t.x + 10}
                y={t.y + 18}
                fontSize={12}
                fontWeight={600}
                fill="white"
                style={{ pointerEvents: 'none' }}
              >
                {t.item.name}
              </text>
            ) : null}
            {t.w > 80 && t.h > 56 ? (
              <text
                x={t.x + 10}
                y={t.y + 36}
                fontSize={11}
                fill="white"
                opacity={0.85}
                style={{ pointerEvents: 'none' }}
              >
                {formatMoneyMicros(t.item.revenueMicros, currency)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

// Squarify treemap (Bruls/Huijbregts/van Wijk 2000) — small, dep-free.
function squarify(items: CategoryRow[]): Tile[] {
  if (items.length === 0) return [];
  const values = items.map((it) => Number(BigInt(it.revenueMicros) / BigInt(1_000_000)));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const area = W * H;
  const scaled = values.map((v) => (v / total) * area);

  const tiles: Tile[] = [];
  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  let i = 0;

  while (i < items.length) {
    const remaining = scaled.slice(i);
    const shortSide = Math.min(w, h);
    const row: number[] = [];
    let bestRatio = Number.POSITIVE_INFINITY;
    for (const v of remaining) {
      const candidate = [...row, v];
      const r = worstAspectRatio(candidate, shortSide);
      if (r > bestRatio) break;
      row.push(v);
      bestRatio = r;
    }
    layoutRow(row, x, y, w, h, items, i, tiles);
    const rowSum = row.reduce((a, b) => a + b, 0);
    if (w >= h) {
      const rowHeight = rowSum / w;
      y += rowHeight;
      h -= rowHeight;
    } else {
      const rowWidth = rowSum / h;
      x += rowWidth;
      w -= rowWidth;
    }
    i += row.length;
  }
  return tiles;
}

function worstAspectRatio(row: number[], short: number): number {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return Number.POSITIVE_INFINITY;
  let worst = 0;
  for (const v of row) {
    const ratio = Math.max((short * short * v) / (sum * sum), (sum * sum) / (short * short * v));
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function layoutRow(
  row: number[],
  x: number,
  y: number,
  w: number,
  h: number,
  allItems: CategoryRow[],
  startIdx: number,
  out: Tile[],
): void {
  const sum = row.reduce((a, b) => a + b, 0);
  if (sum === 0) return;
  if (w >= h) {
    const rowHeight = sum / w;
    let cx = x;
    for (let j = 0; j < row.length; j++) {
      const tw = row[j]! / rowHeight;
      const item = allItems[startIdx + j]!;
      out.push({
        x: cx,
        y,
        w: tw,
        h: rowHeight,
        item,
        color: PALETTE[(startIdx + j) % PALETTE.length]!,
        share: row[j]! / (W * H),
      });
      cx += tw;
    }
  } else {
    const rowWidth = sum / h;
    let cy = y;
    for (let j = 0; j < row.length; j++) {
      const th = row[j]! / rowWidth;
      const item = allItems[startIdx + j]!;
      out.push({
        x,
        y: cy,
        w: rowWidth,
        h: th,
        item,
        color: PALETTE[(startIdx + j) % PALETTE.length]!,
        share: row[j]! / (W * H),
      });
      cy += th;
    }
  }
}
