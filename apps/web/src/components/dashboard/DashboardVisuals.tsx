// Visual-first /dashboard (Tony 13:25 BRT): every chart is derived from API
// rows (opportunities, pipeline report, forecast projection, watchdog feed).
import '@/components/drill/drill.css';

import { Link } from 'react-router-dom';

import { useId, useState } from 'react';

import { ChartCard, SignalLegend, SignalShape } from '@/components/viz/ChartCard';
import { KIND_LABEL } from '@/components/viz/viz-kinds';
import { EarningsStrip, HBars, HeatStrip } from '@/components/viz/charts';
import SmoothTab from '@/components/kokonutui/smooth-tab';
import { AnimatedNumber } from '@/components/motion-primitives/animated-number';
import { PulseOrb } from '@/components/viz/PulseOrb';
import { HeroArea, QuarterBars, StageFunnel, WinRateLine } from '@/components/viz/lazy-bklit';
import {
  accountBars, cumulativeWon, fmtCompact, forecastCommitLabel, forecastPoint, pastDueOpen, stageFunnel, statusMix,
  winRateByQuarter, wonByQuarter, type OppRow,
} from '@/components/viz/viz-data';
import type { OppDrillFilter } from '@/components/drill/OppDrill';

/** Opens the bid drill-down sheet with a starting filter. */
export type OnDrill = (f: OppDrillFilter) => void;
import type { WatchdogFeed } from '@/hooks/useWatchdogFeed';
import { recordedPipelineCompact } from './unspecified-currency';

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const weekFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function DashboardHero({
  rows,
  openValue,
  weighted,
  openCount,
  feed,
  onDrill,
  openMicros,
  weightedMicros,
}: {
  rows: OppRow[];
  openValue: number;
  weighted: number;
  openCount: number;
  feed?: WatchdogFeed;
  onDrill?: OnDrill;
  openMicros?: string | null;
  weightedMicros?: string | null;
}) {
  const fresh = feed?.newAlertCount ?? 0;
  const risks = feed?.alerts.filter((a) => a.implication === 'RISK').length ?? 0;
  const pulse = feed ? (risks > 0 ? 'alert' : fresh > 0 ? 'watch' : 'calm') : null;
  const pulseText = !feed ? '' : fresh > 0
    ? `Watchdog: ${fresh} new signal${fresh === 1 ? '' : 's'}${risks ? ` · ${risks} risk${risks === 1 ? '' : 's'}` : ''}`
    : 'Watchdog: all quiet';
  const trend = cumulativeWon(rows);
  const wonTotal = trend.at(-1)?.y ?? 0;
  const openLabel = recordedPipelineCompact(openMicros, openValue);
  const weightedLabel = recordedPipelineCompact(weightedMicros, weighted);
  return (
    <ChartCard
      testId="dashboard-hero"
      title="Open pipeline"
      meta={`${openCount} open bid${openCount === 1 ? '' : 's'}`}
      summary={`Open pipeline ${openLabel}, weighted ${weightedLabel}. Won so far this year ${fmtCompact(wonTotal)}.`}
      table={{ columns: ['Month', 'Won to date'], rows: trend.map((p) => [p.x, fmtCompact(p.y)]) }}
      className="dash-hero"
      interactive={Boolean(onDrill)}
    >
      <div className="dash-hero-figs">
        <HeroFig onClick={onDrill ? () => onDrill({ status: 'open' }) : undefined} label={`Open pipeline ${openLabel}: show the open bids`}>
          <span className="dash-hero-num">{openLabel}</span>
          <div className="viz-meta">Weighted {weightedLabel}</div>
        </HeroFig>
        <HeroFig onClick={onDrill ? () => onDrill({ status: 'won', thisYear: true }) : undefined} label={`Won this year ${fmtCompact(wonTotal)}: show the won bids`}>
          <AnimatedNumber className="dash-hero-num dash-hero-num--won" value={wonTotal} format={fmtCompact} />
          <div className="viz-meta">Won this year</div>
        </HeroFig>
        {pulse ? (
          <div className="dash-hero-pulse" data-testid="dashboard-pulse">
            <PulseOrb tone={pulse} size={96} bold />
            <span className="viz-meta">{pulseText}</span>
          </div>
        ) : null}
      </div>
      <HeroArea data={trend} format={fmtCompact} />
      <div className="viz-caption">Won value to date, by close month. Select a number to see the bids behind it.</div>
    </ChartCard>
  );
}

function HeroFig({ onClick, label, children }: { onClick?: () => void; label: string; children: React.ReactNode }) {
  if (!onClick) return <div>{children}</div>;
  return (
    <button type="button" className="drill-hit" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

export function NeedsYou({ rows, overdueTasks, feed }: { rows: OppRow[]; overdueTasks: number; feed?: WatchdogFeed }) {
  const [now] = useState(() => Date.now());
  const pastDue = pastDueOpen(rows, now);
  const soon = (feed?.earnings ?? []).filter((e) => new Date(e.expectedAt).getTime() - now < 14 * 86_400_000);
  const items = [
    pastDue.length > 0 && { key: 'due', to: '/opportunities', title: `${pastDue.length} open bid${pastDue.length === 1 ? '' : 's'} past due date`, meta: pastDue.slice(0, 2).map((o) => o.customer).filter(Boolean).join(', '), kind: 'RISK' },
    overdueTasks > 0 && { key: 'tasks', to: '/tasks?filter=overdue', title: `${overdueTasks} overdue task${overdueTasks === 1 ? '' : 's'}`, meta: 'Follow-ups waiting on you', kind: 'RISK' },
    (feed?.newAlertCount ?? 0) > 0 && { key: 'alerts', to: `/accounts/${feed!.alerts[0]!.companyId}`, title: `${feed!.newAlertCount} new account signal${feed!.newAlertCount === 1 ? '' : 's'}`, meta: feed!.alerts[0]!.title, kind: feed!.alerts[0]!.implication },
    ...soon.slice(0, 2).map((e) => ({ key: e.id, to: `/accounts/${e.companyId}`, title: `${e.companyName} results ${dayFmt.format(new Date(e.expectedAt))}`, meta: `${e.fiscalPeriod}${e.confirmed ? ' · confirmed' : ''}`, kind: 'NEUTRAL' })),
  ].filter(Boolean) as Array<{ key: string; to: string; title: string; meta: string; kind: string }>;
  return (
    <section className="viz dash-needs" aria-labelledby="dash-needs-t" data-testid="needs-you">
      <header className="viz-head"><h2 id="dash-needs-t" className="viz-title">Needs you</h2><span className="viz-meta">{items.length}</span></header>
      {items.length === 0 ? <p className="viz-empty">Nothing waiting. Nice.</p> : (
        <ul className="dash-needs-list">
          {items.map((it, i) => (
            <li key={it.key} style={{ '--i': i } as React.CSSProperties}>
              <Link to={it.to}>
                <svg width="12" height="12" className="viz-svg" style={{ width: 12, flex: 'none' }} aria-hidden><SignalShape kind={it.kind} x={6} y={6} r={4} /></svg>
                <span className="dash-needs-text">
                  <span className="dash-needs-title">{it.title}</span>
                  {it.meta ? <span className="viz-meta">{it.meta}</span> : null}
                </span>
                <span className="sr-only">({KIND_LABEL[it.kind] ?? it.kind})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Pipeline by stage and bids by status, merged (both answered "where are my
 *  bids?"). Each funnel column and each status chip opens the bid drill. */
export function PipelineCard({ rows, onDrill }: { rows: OppRow[]; onDrill: OnDrill }) {
  const data = stageFunnel(rows);
  const m = statusMix(rows);
  return (
    <ChartCard title="Pipeline" meta={`${m.open} open of ${m.open + m.won + m.lost} bids · value per stage`} interactive testId="dashboard-pipeline"
      summary={data.map((d) => `${d.label}: ${d.amount} across ${d.count}`).join('; ') || 'No open bids'}
      table={{ columns: ['Stage', 'Bids', 'Value'], rows: data.map((d) => [d.label, d.count, d.amount]) }}>
      {data.length ? (
        <div style={{ position: 'relative' }}>
          <StageFunnel data={data} format={fmtCompact} />
          <div className="viz-hits">
            {data.map((d) => (
              <button key={d.label} type="button" aria-label={`${d.label}: ${d.count} bid${d.count === 1 ? '' : 's'}, ${fmtCompact(d.value)}. Show bids`}
                onClick={() => onDrill({ status: 'open', stage: d.id })} />
            ))}
          </div>
        </div>
      ) : <p className="viz-empty">No open bids.</p>}
      <div className="viz-caption">Where your open bids sit today. Select a stage or a status to see the bids.</div>
      <div className="dash-chips" role="group" aria-label="Bids by status">
        {([['open', 'Open', m.open], ['won', 'Won', m.won], ['lost', 'Lost', m.lost]] as const).map(([k, label, n]) => (
          <button key={k} type="button" className="dash-chip" onClick={() => onDrill({ status: k })}>
            {label} <b>{n}</b>
          </button>
        ))}
      </div>
    </ChartCard>
  );
}

export function ForecastCard({ rows, projection, headingLevel }: {
  rows: OppRow[];
  headingLevel?: 2 | 3;
  projection?: { periods: Array<{ label: string; weightedMicros: string | number; wonMicros: string | number; openMicros: string | number; manualCommitMicros: string | number | null }> };
}) {
  const actuals = wonByQuarter(rows).map((q) =>
    forecastPoint({ label: q.label, wonMicros: q.wonMicros, weightedMicros: '0', openMicros: '0' }),
  );
  const future = (projection?.periods ?? [])
    .filter((p) => {
      const point = forecastPoint(p);
      return point.openLabel !== '0' || point.weightedLabel !== '0';
    })
    .map((p) => forecastPoint(p));
  const seen = new Set(future.map((f) => f.label));
  const data = [...actuals.filter((a) => !seen.has(a.label)), ...future];
  const target = (projection?.periods ?? []).map((p) => forecastCommitLabel(p.manualCommitMicros)).find((label) => label != null) ?? null;
  return (
    <ChartCard headingLevel={headingLevel} title="Revenue and forecast" meta={target ? `Commit target ${target} per quarter` : 'No target set yet · add a commit forecast to compare'}
      summary={data.map((d) => `${d.label}: won ${d.wonLabel}${d.weighted ? `, weighted ${d.weightedLabel}` : ''}`).join('; ')}
      table={{ columns: ['Quarter', 'Won', 'Weighted', 'Open'], rows: data.map((d) => [d.label, d.wonLabel, d.weightedLabel, d.openLabel]) }}>
      <QuarterBars data={data} format={fmtCompact} />
      <ul className="viz-legend" aria-hidden>
        <li><i className="dash-key" style={{ background: 'var(--success, #177048)' }} />Won</li>
        <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--brand-primary, #006b4f) 70%, transparent)' }} />Weighted forecast</li>
      </ul>
    </ChartCard>
  );
}

export function WinRateTrendCard({ rows, headingLevel }: { rows: OppRow[]; headingLevel?: 2 | 3 }) {
  const data = winRateByQuarter(rows);
  return (
    <ChartCard headingLevel={headingLevel} title="Win rate over time" meta="Share of closed bids won, by close quarter"
      summary={data.map((d) => `${d.x}: ${d.rate}% (${d.won} of ${d.won + d.lost})`).join('; ') || 'No closed bids'}
      table={{ columns: ['Quarter', 'Won', 'Lost', 'Win rate'], rows: data.map((d) => [d.x, d.won, d.lost, `${d.rate}%`]) }}>
      {data.length > 1 ? <WinRateLine data={data} /> : <p className="viz-empty">Needs closed bids in two quarters.</p>}
    </ChartCard>
  );
}

export function TopAccountsBarCard({ rows, headingLevel, onDrill }: { rows: OppRow[]; headingLevel?: 2 | 3; onDrill?: OnDrill }) {
  const data = accountBars(rows);
  return (
    <ChartCard headingLevel={headingLevel} title="Top accounts" meta="Won plus open value"
      summary={data.map((d) => `${d.label}: won ${fmtCompact(d.won)}, open ${fmtCompact(d.open)}`).join('; ')}
      table={{ columns: ['Account', 'Won', 'Open'], rows: data.map((d) => [d.label, fmtCompact(d.won), fmtCompact(d.open)]) }}>
      <HBars data={data} format={fmtCompact} onSelect={onDrill ? (label) => onDrill({ status: 'all', account: label }) : undefined} />
      {onDrill ? (
        <ul className="dash-chips" aria-label="Open an account's bids">
          {data.map((d) => (
            <li key={d.label}><button type="button" className="dash-chip" onClick={() => onDrill({ status: 'all', account: d.label })}>{d.label} <b>{fmtCompact(d.won + d.open)}</b></button></li>
          ))}
        </ul>
      ) : null}
      <ul className="viz-legend" aria-hidden>
        <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--success, #177048) 75%, transparent)' }} />Won</li>
        <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--brand-primary, #006b4f) 22%, transparent)' }} />Open</li>
      </ul>
    </ChartCard>
  );
}

const isSampleTitle = (t: string) => /^sample:/i.test(t);

/** Watchdog heat and upcoming results, merged into one "what changed at my
 *  accounts" card. Account names open the account page (its watchdog section
 *  carries the full event list, sources and filters). */
export function SignalsCard({ feed }: { feed?: WatchdogFeed }) {
  const weeks = (feed?.heatWeekStarts ?? []).map((w) => weekFmt.format(new Date(w)));
  const rows = (feed?.heat ?? []).map((h) => ({ id: h.companyId, name: h.companyName, cells: h.weeks.map((w) => ({ kind: w.worst, count: w.count })) }));
  const sample = (feed?.alerts ?? []).some((a) => isSampleTitle(a.title));
  const results = (feed?.earnings ?? []).map((e) => ({ id: e.id, date: e.expectedAt, label: e.companyName, companyId: e.companyId }));
  const days = feed?.days ?? 30;
  return (
    <ChartCard title="Account signals" meta="Last 8 weeks, and results due soon" interactive testId="dashboard-signals"
      sample={sample ? 'Local demo signals (titles start with "Sample:")' : undefined}
      summary={`${rows.map((r) => `${r.name}: ${r.cells.reduce((n, c) => n + c.count, 0)} signals`).join('; ') || 'No signals in the last 8 weeks'}. ${results.map((i) => `${i.label} results on ${dayFmt.format(new Date(i.date))}`).join('; ') || 'No results expected'}.`}
      table={{ columns: ['Account', 'Signals (8 weeks)', 'Results due'], rows: [...new Set([...rows.map((r) => r.name), ...results.map((r) => r.label)])].map((name) => [
        name,
        rows.find((r) => r.name === name)?.cells.reduce((n, c) => n + c.count, 0) ?? 0,
        results.filter((r) => r.label === name).map((r) => dayFmt.format(new Date(r.date))).join(', ') || '–',
      ]) }}>
      {rows.length ? <HeatStrip rows={rows} weeks={weeks} rowHref={(id) => `/accounts/${id}`} /> : <p className="viz-empty">No signals in the last 8 weeks.</p>}
      <SignalLegend />
      <p className="dash-sub">Results due in the next {days} days</p>
      {results.length ? (
        <>
          <EarningsStrip items={results} days={days} />
          <ul className="dash-chips" aria-label="Results due">
            {results.map((r) => (
              <li key={r.id}><Link className="dash-chip" to={`/accounts/${r.companyId}`}>{r.label} <b>{dayFmt.format(new Date(r.date))}</b></Link></li>
            ))}
          </ul>
        </>
      ) : <p className="viz-empty">No results expected in this window.</p>}
      <div className="viz-caption">Select an account to see every signal, its source and what to do next.</div>
    </ChartCard>
  );
}

/** Revenue, win rate and top accounts in one card with kokonutui SmoothTab
 *  (MIT): one surface instead of three, each view keeps its own summary and
 *  table toggle. */
export function PerformanceCard({ rows, projection, onDrill }: {
  rows: OppRow[];
  projection?: Parameters<typeof ForecastCard>[0]['projection'];
  onDrill?: OnDrill;
}) {
  const [tab, setTab] = useState('revenue');
  const headId = useId();
  return (
    <section className="viz dash-perf" aria-labelledby={headId} data-testid="dashboard-performance">
      <header className="viz-head">
        <div style={{ minWidth: 0 }}>
          <h2 id={headId} className="viz-title">Performance</h2>
          <div className="viz-meta">Revenue, win rate and top accounts from your bids</div>
        </div>
        {onDrill ? (
          <button type="button" className="drill-more" onClick={() => onDrill({ status: tab === 'revenue' ? 'won' : 'all' })}>
            Breakdown
          </button>
        ) : null}
      </header>
      <SmoothTab
        label="Performance views"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'revenue', title: 'Revenue', content: <ForecastCard rows={rows} projection={projection} headingLevel={3} /> },
          { id: 'winrate', title: 'Win rate', content: <WinRateTrendCard rows={rows} headingLevel={3} /> },
          { id: 'accounts', title: 'Top accounts', content: <TopAccountsBarCard rows={rows} headingLevel={3} onDrill={onDrill} /> },
        ]}
      />
    </section>
  );
}
