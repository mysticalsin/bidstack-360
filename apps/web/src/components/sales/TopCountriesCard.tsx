// Top-N countries by confirmed revenue, with a tone-graded bar.
// We deliberately ship the *list* view rather than a full choropleth here:
// the codebase has no chart-library dep (Sparkline is hand-rolled), and a
// 200KB world topojson + react-simple-maps would dwarf the route's chunk
// for a widget that already conveys the same insight in a tighter footprint.
// The header still toggles to a future "Map" view via the same query.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatMoneyMicros } from '@/lib/format';

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
  const items = data?.items ?? [];
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
              className="text-[var(--brand-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
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
        <div className="px-5 py-8 text-sm text-[var(--fg-tertiary)]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-8 text-sm text-[var(--fg-tertiary)]">
          No country data yet — confirmed orders without a country code are excluded.
        </div>
      ) : view === 'map' ? (
        <MiniMap items={items} max={max} />
      ) : (
        <ul className="divide-y divide-[var(--border-subtle)]">
          {items.map((c) => {
            const v = Number(BigInt(c.revenueMicros) / BigInt(1_000_000));
            const pct = max > 0 ? (v / max) * 100 : 0;
            return (
              <li key={c.code}>
                <Link
                  to={`/sales/orders?country=${c.code}&state=confirmed`}
                  className="flex items-center gap-3 px-5 py-2.5 hover:bg-[var(--surface-subtle)] focus-visible:bg-[var(--surface-subtle)] focus-visible:outline-none"
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
                        {formatMoneyMicros(c.revenueMicros, data?.currency ?? 'CAD')}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        aria-hidden
                        className="h-full rounded-full bg-[var(--brand-primary)]"
                        style={{ width: `${pct.toFixed(1)}%`, opacity: 0.6 + 0.4 * (pct / 100) }}
                      />
                    </div>
                  </div>
                  <Badge tone="gray">{c.orders}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ─── Minimal SVG world tile grid (placeholder for full choropleth) ──────

function MiniMap({ items, max }: { items: TopCountries['items']; max: number }) {
  // We don't ship a true choropleth (would need topojson + a maps lib). The
  // grid still gives a "spatial scan" feel: bigger + darker chip = more
  // revenue. Each tile is now a Link so keyboard users get the same drill-
  // through as the list view (audit 2026-05-11 #4).
  return (
    <div className="grid grid-cols-3 gap-3 px-5 py-5 sm:grid-cols-4">
      {items.map((c) => {
        const v = Number(BigInt(c.revenueMicros) / BigInt(1_000_000));
        const intensity = max > 0 ? Math.min(1, v / max) : 0;
        return (
          <Link
            key={c.code}
            to={`/sales/orders?country=${c.code}&state=confirmed`}
            aria-label={`${c.name}: ${formatMoneyMicros(c.revenueMicros, 'CAD')} across ${c.orders} confirmed orders`}
            className="flex min-h-[88px] flex-col items-center justify-center rounded-md border border-[var(--border-subtle)] p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2"
            style={{ backgroundColor: `rgba(44, 75, 255, ${0.05 + intensity * 0.25})` }}
          >
            <span className="text-2xl leading-none" aria-hidden>
              {FLAGS[c.code] ?? '🏳️'}
            </span>
            <span className="mt-1 text-[10px] font-semibold text-[var(--fg-secondary)]">
              {c.code}
            </span>
            <span className="mt-0.5 text-xs tabular-nums text-[var(--fg-primary)]">
              {formatMoneyMicros(c.revenueMicros, 'CAD')}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
