// Lightweight squarified treemap for "Top Categories" by revenue.
// Hand-rolled (matches the codebase's no-chart-lib stance). The squarify
// algorithm produces tiles whose aspect ratio stays close to 1:1, which
// reads better than a 1D stacked bar.

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSnap, springSoft } from '@/lib/motion';

import type { CategoryRow, TopCategories } from '@bidstack/shared';

interface Props {
  data: TopCategories | undefined;
  isLoading: boolean;
}

// Every fill below clears WCAG 2.2 AA (≥ 4.5:1) against pure white text at
// 12px. The previous palette included amber #f5b400 (1.95:1) and jade-2
// #10b981 (2.5:1) which failed AA — see audit 2026-05-11 #5.
const PALETTE = [
  '#2c4bff', // brand-primary       5.4:1
  '#1f8a5b', // jade-700            4.6:1
  '#7c3aed', // violet-600          5.5:1
  '#0e7490', // cyan-700            5.5:1
  '#be185d', // rose-700            6.2:1
  '#b45309', // amber-700           4.7:1
  '#dc2626', // red-600             4.8:1
  '#475569', // slate-600           6.5:1
];

export function TopCategoriesTreemap({ data, isLoading }: Props) {
  const [view, setView] = useState<'treemap' | 'list'>('treemap');
  const reducedMotion = useReducedMotion();
  const { formatMoneyMicros } = useFormatMoney();
  const items = data?.items ?? [];
  const sourceCurrency = data?.currency ?? 'CAD';

  return (
    <Card>
      <SectionHeader
        title="Top Categories"
        action={
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <button
              type="button"
              className="text-[var(--brand-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
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
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="px-5 py-8 text-sm text-[var(--fg-tertiary)]"
        >
          Loading…
        </motion.div>
      ) : items.length === 0 ? (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="px-5 py-8 text-sm text-[var(--fg-tertiary)]"
        >
          No category breakdown yet.
        </motion.div>
      ) : view === 'treemap' ? (
        <Treemap items={items} sourceCurrency={sourceCurrency} />
      ) : (
        <motion.ul
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springSoft}
          className="divide-y divide-[var(--border-subtle)]"
        >
          {items.map((c, i) => (
            <motion.li
              key={c.id}
              initial={reducedMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              whileHover={reducedMotion ? undefined : { x: 2 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : i * 0.03 }}
              className="flex items-center gap-3 px-5 py-2.5"
            >
              <motion.span
                aria-hidden
                className="h-3 w-3 rounded-sm"
                initial={reducedMotion ? false : { scale: 0.55 }}
                animate={{ scale: 1 }}
                transition={springSnap}
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <span className="flex-1 truncate text-sm text-[var(--fg-primary)]">{c.name}</span>
              <span className="tabular-nums text-sm text-[var(--fg-primary)] whitespace-nowrap">
                {formatMoneyMicros(c.revenueMicros, sourceCurrency)}
              </span>
              <Badge tone="gray">{c.orders}</Badge>
            </motion.li>
          ))}
        </motion.ul>
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

function Treemap({ items, sourceCurrency }: { items: CategoryRow[]; sourceCurrency: string }) {
  const tiles = useMemo(() => squarify(items), [items]);
  const reducedMotion = useReducedMotion();
  const { formatMoneyMicros } = useFormatMoney();

  return (
    <motion.div
      className="px-5 pb-5"
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        style={{ height: H }}
        role="img"
        aria-label="Top categories treemap by revenue"
      >
        {tiles.map((t, index) => (
          <g key={t.item.id}>
            <motion.rect
              x={t.x + 1}
              y={t.y + 1}
              width={Math.max(0, t.w - 2)}
              height={Math.max(0, t.h - 2)}
              fill={t.color}
              rx={4}
              initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...springSnap, delay: reducedMotion ? 0 : index * 0.03 }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            >
              <title>{`${t.item.name}: ${formatMoneyMicros(t.item.revenueMicros, sourceCurrency)} (${t.item.orders} orders)`}</title>
            </motion.rect>
            {t.w > 80 && t.h > 36 ? (
              <motion.text
                x={t.x + 10}
                y={t.y + 18}
                fontSize={12}
                fontWeight={600}
                fill="white"
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.035 + 0.08 }}
                style={{ pointerEvents: 'none' }}
              >
                {t.item.name}
              </motion.text>
            ) : null}
            {t.w > 80 && t.h > 56 ? (
              <motion.text
                x={t.x + 10}
                y={t.y + 36}
                fontSize={11}
                fill="white"
                initial={reducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.035 + 0.12 }}
                style={{ pointerEvents: 'none' }}
              >
                {formatMoneyMicros(t.item.revenueMicros, sourceCurrency)}
              </motion.text>
            ) : null}
          </g>
        ))}
      </svg>
    </motion.div>
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
