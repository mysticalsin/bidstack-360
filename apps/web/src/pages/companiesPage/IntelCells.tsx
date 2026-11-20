// Company intel cells for the Companies list (slice 14). Every value carries
// its source, as-of date and method in the accessible label and hover title;
// derived values say "inferred"; empty values show an en dash with the reason.
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  compactAmount,
  INTEL_EMPTY_REASON_LABEL,
  type CompanyIntelSummary,
  type IntelGap,
  type IntelMetric,
} from '@bidstack/shared';

import { Tooltip } from '@/components/ui/Tooltip';
import { Sparkline } from '@/components/vendor/tuffui/sparkline';
import { StatusPill, type StatusTone } from '@/components/vendor/tuffui/status-pill';

export const INTEL_COLUMNS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'revenueGrowth', label: 'Revenue growth' },
  { key: 'headcount', label: 'Headcount' },
  { key: 'headcountGrowth', label: 'Headcount growth (6m)' },
  { key: 'openRoles', label: 'Open roles' },
  { key: 'newRoles30d', label: 'New roles (30d)' },
  { key: 'hiringTrend', label: 'Hiring trend' },
  { key: 'funding', label: 'Funding' },
  { key: 'signal', label: 'Signal' },
  { key: 'direction', label: 'Direction' },
] as const;

export type IntelColumn = (typeof INTEL_COLUMNS)[number]['key'];

const DASH = '\u2013';
const NO_SUMMARY: IntelGap = { reason: 'no_public_data', detail: 'Not refreshed yet' };

/** "+14%", "-0.4%". */
export function signedPct(v: number): string {
  const r = Math.abs(v) < 1 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${r > 0 ? '+' : ''}${r}%`;
}

export function money(value: number, currency: string | null): string {
  return `${compactAmount(value)}${currency ? ` ${currency}` : ''}`;
}

function day(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** Source, year, method, date and inference flags in one sentence. */
export function provenance(
  m: Pick<IntelMetric, 'sourceLabel' | 'method' | 'asOf' | 'inferred' | 'sample'>,
  extra: string[] = [],
): string {
  return [
    m.sourceLabel,
    ...extra,
    m.method,
    day(m.asOf) ? `as of ${day(m.asOf)}` : null,
    m.inferred ? 'inferred' : null,
    m.sample ? 'sample data' : null,
  ]
    .filter(Boolean)
    .join(', ');
}

export function gapFor(summary: CompanyIntelSummary | null, field: string): IntelGap {
  if (!summary) return NO_SUMMARY;
  return summary.gaps[field] ?? { reason: 'no_public_data', detail: 'No value found' };
}

export function EmptyIntel({ gap }: { gap: IntelGap }) {
  const text = `${INTEL_EMPTY_REASON_LABEL[gap.reason]}: ${gap.detail}`;
  return (
    <span aria-label={text} title={text} className="cursor-help text-[var(--fg-tertiary)]">
      {DASH}
    </span>
  );
}

function Value({
  label,
  children,
  inferred,
}: {
  label: string;
  children: ReactNode;
  inferred?: boolean;
}) {
  return (
    <span
      aria-label={label}
      title={label}
      className={`whitespace-nowrap tabular-nums ${inferred ? 'italic' : ''}`}
    >
      {children}
    </span>
  );
}

export function revenueText(r: NonNullable<CompanyIntelSummary['revenue']>): string {
  if (r.fiscalYear === null && r.range && /range/.test(r.method))
    return `${r.range} ${r.currency ?? ''}`.trim();
  return money(r.value, r.currency);
}

function growthTone(v: number): string {
  if (v > 0) return 'text-[var(--success)]';
  if (v < 0) return 'text-[var(--danger)]';
  return 'text-[var(--fg-secondary)]';
}

const DIRECTION_UI: Record<
  'growing' | 'steady' | 'contracting',
  { label: string; tone: StatusTone; icon: typeof TrendingUp }
> = {
  growing: { label: 'Growing', tone: 'positive', icon: TrendingUp },
  steady: { label: 'Steady', tone: 'neutral', icon: Minus },
  contracting: { label: 'Contracting', tone: 'negative', icon: TrendingDown },
};

export function DirectionBadge({ summary }: { summary: CompanyIntelSummary | null }) {
  const d = summary?.direction;
  if (!d) return <EmptyIntel gap={gapFor(summary, 'direction')} />;
  const ui = DIRECTION_UI[d.value];
  const label = `Direction: ${ui.label}. ${d.reasons.join('. ')}. Inferred by Polo from the signals.`;
  const Glyph = ui.icon;
  return (
    <Tooltip
      content={
        <ul className="max-w-xs space-y-1 text-xs">
          {d.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li className="text-[var(--fg-tertiary)]">Inferred</li>
        </ul>
      }
    >
      <span
        aria-label={label}
        tabIndex={0}
        className="inline-flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      >
        <StatusPill tone={ui.tone} size="sm">
          <Glyph className="size-3" aria-hidden />
          {ui.label}
        </StatusPill>
      </span>
    </Tooltip>
  );
}

/** One intel cell's content. `crmEmployees` backs Headcount when nothing better is known. */
export function IntelCellFor({
  column,
  summary,
  crmEmployees = null,
}: {
  column: IntelColumn;
  summary: CompanyIntelSummary | null;
  crmEmployees?: number | null;
}) {
  const s = summary;
  switch (column) {
    case 'revenue': {
      const r = s?.revenue;
      if (!r) return <EmptyIntel gap={gapFor(s, 'revenue')} />;
      return (
        <Value
          label={`Revenue ${revenueText(r)}: ${provenance(r, r.fiscalYear ? [`FY${r.fiscalYear}`] : [])}`}
        >
          {revenueText(r)}
        </Value>
      );
    }
    case 'revenueGrowth': {
      const g = s?.revenueGrowth;
      if (!g) return <EmptyIntel gap={gapFor(s, 'revenueGrowth')} />;
      return (
        <Value
          label={`Revenue growth ${signedPct(g.value)}: ${provenance(g)}`}
          inferred={g.inferred}
        >
          <span className={growthTone(g.value)}>{signedPct(g.value)}</span>
        </Value>
      );
    }
    case 'headcount': {
      const h = s?.headcount;
      if (h)
        return (
          <Value label={`Headcount ${compactAmount(h.value)}: ${provenance(h)}`}>
            {compactAmount(h.value)}
          </Value>
        );
      if (crmEmployees != null)
        return (
          <Value label={`Headcount ${compactAmount(crmEmployees)}: CRM record`}>
            {compactAmount(crmEmployees)}
          </Value>
        );
      return <EmptyIntel gap={gapFor(s, 'headcount')} />;
    }
    case 'headcountGrowth': {
      const g = s?.headcountGrowth;
      if (!g) return <EmptyIntel gap={gapFor(s, 'headcountGrowth')} />;
      const text = g.window === '6m' ? signedPct(g.value) : `${signedPct(g.value)} 12m`;
      return (
        <Value label={`Headcount growth ${text}: ${provenance(g)}`} inferred={g.inferred}>
          <span className={growthTone(g.value)}>{text}</span>
        </Value>
      );
    }
    case 'openRoles': {
      const o = s?.openRoles;
      if (!o) return <EmptyIntel gap={gapFor(s, 'openRoles')} />;
      return (
        <Value label={`Open roles ${o.value}: ${provenance(o)}`}>{o.value.toLocaleString()}</Value>
      );
    }
    case 'newRoles30d': {
      const n = s?.newRoles30d;
      if (!n) return <EmptyIntel gap={gapFor(s, 'newRoles30d')} />;
      const delta = n.value - n.prev30;
      return (
        <Value
          label={`New roles in 30 days ${n.value}, ${delta >= 0 ? '+' : ''}${delta} vs the prior 30: ${provenance(n)}`}
        >
          <span className="inline-flex items-baseline gap-1">
            <span>{n.value.toLocaleString()}</span>
            {delta !== 0 && (
              <span
                className={`text-xs ${growthTone(delta)}`}
              >{`${delta > 0 ? '+' : ''}${delta}`}</span>
            )}
          </span>
        </Value>
      );
    }
    case 'hiringTrend': {
      const t = s?.hiringTrend;
      if (!t || t.monthly.every((v) => v === 0))
        return <EmptyIntel gap={gapFor(s, 'hiringTrend')} />;
      const trend = s?.newRoles30d?.trend30Pct ?? null;
      const tone = trend === null || trend === 0 ? 'neutral' : trend > 0 ? 'positive' : 'negative';
      return (
        <span
          title={`New postings per month, last 6 months: ${t.monthly.join(', ')}. ${t.sourceLabel}`}
          className="inline-flex"
        >
          <Sparkline
            values={t.monthly}
            tone={tone}
            label={`New postings per month, last 6 months: ${t.monthly.join(', ')}. ${t.sourceLabel}${t.sample ? ', sample data' : ''}`}
          />
        </span>
      );
    }
    case 'funding': {
      const f = s?.funding;
      if (!f) return <EmptyIntel gap={gapFor(s, 'funding')} />;
      const round = f.latestRound
        ? [`latest ${f.latestRound}${f.latestRoundAt ? ` on ${day(f.latestRoundAt)}` : ''}`]
        : [];
      return (
        <Value label={`Funding ${money(f.value, 'USD')}: ${provenance(f, round)}`}>
          {money(f.value, 'USD')}
        </Value>
      );
    }
    case 'signal': {
      const g = s?.signal;
      if (!g) return <EmptyIntel gap={gapFor(s, 'signal')} />;
      const label = `${g.label}: ${g.title}. ${g.sourceLabel}${g.publishedAt ? `, ${day(g.publishedAt)}` : ''}${g.sample ? ', sample data' : ''}`;
      return (
        <span aria-label={label} title={label} className="inline-flex">
          <StatusPill
            tone={
              g.kind === 'layoffs'
                ? 'negative'
                : g.kind === 'acquisition' || g.kind === 'expansion'
                  ? 'positive'
                  : 'neutral'
            }
            size="sm"
          >
            {g.label}
          </StatusPill>
        </span>
      );
    }
    case 'direction':
      return <DirectionBadge summary={s} />;
  }
}
