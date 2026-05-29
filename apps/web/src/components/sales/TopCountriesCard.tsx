// Top-N countries by confirmed revenue, with a tone-graded bar.
// We deliberately ship the *list* view rather than a full choropleth here:
// the codebase has no chart-library dep (Sparkline is hand-rolled), and a
// 200KB world topojson + react-simple-maps would dwarf the route's chunk
// for a widget that already conveys the same insight in a tighter footprint.
// The header still toggles to a future "Map" view via the same query.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import { springSnap, springSoft, staggerChild, staggerParent } from '@/lib/motion';

import type { TopCountries } from '@bidstack/shared';

interface Props {
  data: TopCountries | undefined;
  isLoading: boolean;
}

// Compact, monochrome flag emoji map (no extra asset weight).
const FLAGS: Record<string, string> = {
  CA: '🇨🇦',
  US: '🇺🇸',
  IT: '🇮🇹',
  GB: '🇬🇧',
  DE: '🇩🇪',
  FR: '🇫🇷',
  ES: '🇪🇸',
  BR: '🇧🇷',
  IN: '🇮🇳',
  AU: '🇦🇺',
  JP: '🇯🇵',
  MX: '🇲🇽',
};

export function TopCountriesCard({ data, isLoading }: Props) {
  const [view, setView] = useState<'list' | 'map'>('list');
  const reducedMotion = useReducedMotion();
  const { formatMoneyMicros } = useFormatMoney();
  const items = data?.items ?? [];
  const sourceCurrency = data?.currency ?? 'CAD';
  const max = items.reduce((acc, it) => {
    const v = Number(BigInt(it.revenueMicros) / BigInt(1_000_000));
    return v > acc ? v : acc;
  }, 1);

  return (
    <Card>
      <SectionHeader
        title="Top Countries"
        action={
          <div className="flex items-center gap-2 text-xs text-[var(--fg-tertiary)]">
            <button
              type="button"
              className="text-[var(--brand-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              onClick={() => setView(view === 'list' ? 'map' : 'list')}
              aria-pressed={view === 'map'}
            >
              {view === 'list' ? 'Map' : 'List'}
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
          No country data yet — confirmed orders without a country code are excluded.
        </motion.div>
      ) : view === 'map' ? (
        <MiniMap items={items} max={max} currency={data?.currency ?? 'CAD'} />
      ) : (
        <motion.ul
          variants={reducedMotion ? undefined : staggerParent}
          initial="initial"
          animate="animate"
          className="divide-y divide-[var(--border-subtle)]"
        >
          {items.map((c) => {
            const v = Number(BigInt(c.revenueMicros) / BigInt(1_000_000));
            const pct = max > 0 ? (v / max) * 100 : 0;
            return (
              <motion.li key={c.code} variants={reducedMotion ? undefined : staggerChild}>
                <Link
                  to={`/sales/orders?country=${c.code}&state=confirmed`}
                  className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--surface-subtle)] focus-visible:bg-[var(--surface-subtle)] focus-visible:outline-none"
                >
                  <span aria-hidden className="text-xl leading-none">
                    {FLAGS[c.code] ?? '🏳️'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium text-[var(--fg-primary)]">
                        {c.name}
                      </span>
                      <span className="tabular-nums text-sm text-[var(--fg-primary)] whitespace-nowrap">
                        {formatMoneyMicros(c.revenueMicros, sourceCurrency)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <motion.div
                        aria-hidden
                        className="h-full rounded-full bg-[var(--brand-primary)]"
                        initial={reducedMotion ? false : { width: 0 }}
                        animate={{ width: `${pct.toFixed(1)}%` }}
                        transition={springSnap}
                        style={{ opacity: 0.6 + 0.4 * (pct / 100) }}
                      />
                    </div>
                  </div>
                  <Badge tone="gray">{c.orders}</Badge>
                </Link>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
    </Card>
  );
}

// ─── Minimal SVG world tile grid (placeholder for full choropleth) ──────

function MiniMap({
  items,
  max,
  currency,
}: {
  items: TopCountries['items'];
  max: number;
  currency: string;
}) {
  const reducedMotion = useReducedMotion();
  const { formatMoneyMicros } = useFormatMoney();
  // We don't ship a true choropleth (would need topojson + a maps lib). The
  // grid still gives a "spatial scan" feel: bigger + darker chip = more
  // revenue. Each tile is now a Link so keyboard users get the same drill-
  // through as the list view (audit 2026-05-11 #4).
  return (
    <motion.div
      variants={reducedMotion ? undefined : staggerParent}
      initial="initial"
      animate="animate"
      className="grid grid-cols-3 gap-3 px-5 py-5 sm:grid-cols-4"
    >
      {items.map((c) => {
        const intensity =
          max > 0 ? Math.min(1, Number(BigInt(c.revenueMicros) / BigInt(1_000_000)) / max) : 0;
        return (
          <motion.div
            key={c.code}
            variants={reducedMotion ? undefined : staggerChild}
            whileHover={reducedMotion ? undefined : { y: -3, transition: springSnap }}
          >
            <Link
              to={`/sales/orders?country=${c.code}&state=confirmed`}
              aria-label={`${c.name}: ${formatMoneyMicros(c.revenueMicros, currency)} across ${c.orders} confirmed orders`}
              className="flex min-h-[88px] w-full flex-col items-center justify-center rounded-md border border-[var(--border-subtle)] p-3 transition-colors hover:border-[var(--border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
              style={{ backgroundColor: `rgba(44, 75, 255, ${0.05 + intensity * 0.25})` }}
            >
              <span className="text-2xl leading-none" aria-hidden>
                {FLAGS[c.code] ?? '🏳️'}
              </span>
              <span className="mt-1 text-[10px] font-semibold text-[var(--fg-secondary)]">
                {c.code}
              </span>
              <span className="mt-0.5 text-xs tabular-nums text-[var(--fg-primary)]">
                {formatMoneyMicros(c.revenueMicros, currency)}
              </span>
            </Link>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
