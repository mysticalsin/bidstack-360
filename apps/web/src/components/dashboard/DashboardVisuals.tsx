// Visual-first /dashboard (Tony 13:25 BRT): every chart is derived from API
// rows (opportunities, pipeline report, forecast projection, watchdog feed).
import { Link } from 'react-router-dom';

import { useId, useState } from 'react';

import { ChartCard, SignalLegend, SignalShape } from '@/components/viz/ChartCard';
import { KIND_LABEL } from '@/components/viz/viz-kinds';
import { EarningsStrip, HBars, HeatStrip } from '@/components/viz/charts';
import SmoothTab from '@/components/kokonutui/smooth-tab';
import { AnimatedNumber } from '@/components/motion-primitives/animated-number';
import { PulseOrb } from '@/components/viz/PulseOrb';
import { HeroArea, QuarterBars, StageFunnel, StatusRings, WinRateLine } from '@/components/viz/bklit-adapters';
import {
  accountBars, cumulativeWon, fmtCompact, pastDueOpen, stageFunnel, statusMix, winRateByQuarter, wonByQuarter,
  type OppRow,
} from '@/components/viz/viz-data';
import type { WatchdogFeed } from '@/hooks/useWatchdogFeed';

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const weekFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function DashboardHero({ rows, openValue, weighted, openCount, feed }: {
  rows: OppRow[]; openValue: number; weighted: number; openCount: number; feed?: WatchdogFeed;
}) {
  const fresh = feed?.newAlertCount ?? 0;
  const risks = feed?.alerts.filter((a) => a.implication === 'RISK').length ?? 0;
  const pulse = feed ? (risks > 0 ? 'alert' : fresh > 0 ? 'watch' : 'calm') : null;
  const pulseText = !feed ? '' : fresh > 0
    ? `Watchdog: ${fresh} new signal${fresh === 1 ? '' : 's'}${risks ? ` · ${risks} risk${risks === 1 ? '' : 's'}` : ''}`
    : 'Watchdog: all quiet';
  const trend = cumulativeWon(rows);
  const wonTotal = trend.at(-1)?.y ?? 0;
  return (
    <ChartCard
      testId="dashboard-hero"
      title="Open pipeline"
      meta={`${openCount} open bid${openCount === 1 ? '' : 's'}`}
      summary={`Open pipeline ${fmtCompact(openValue)}, weighted ${fmtCompact(weighted)}. Won so far this year ${fmtCompact(wonTotal)}.`}
      table={{ columns: ['Month', 'Won to date'], rows: trend.map((p) => [p.x, fmtCompact(p.y)]) }}
      className="dash-hero"
    >
      <div className="dash-hero-figs">
        <div>
          <AnimatedNumber className="dash-hero-num" value={openValue} format={fmtCompact} />
          <div className="viz-meta">Weighted {fmtCompact(weighted)}</div>
        </div>
        <div>
          <AnimatedNumber className="dash-hero-num dash-hero-num--won" value={wonTotal} format={fmtCompact} />
          <div className="viz-meta">Won this year</div>
        </div>
        {pulse ? (
          <div className="dash-hero-pulse" data-testid="dashboard-pulse">
            <span className="viz-meta">{pulseText}</span>
            <PulseOrb tone={pulse} size={64} />
          </div>
        ) : null}
      </div>
      <HeroArea data={trend} format={fmtCompact} />
      <div className="viz-caption">Won value to date, by close month</div>
    </ChartCard>
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

export function FunnelCard({ rows }: { rows: OppRow[] }) {
  const data = stageFunnel(rows);
  return (
    <ChartCard title="Pipeline by stage" meta="Open value per stage"
      summary={data.map((d) => `${d.label}: ${fmtCompact(d.value)} across ${d.count}`).join('; ') || 'No open bids'}
      table={{ columns: ['Stage', 'Bids', 'Value'], rows: data.map((d) => [d.label, d.count, fmtCompact(d.value)]) }}>
      {data.length ? <StageFunnel data={data} format={fmtCompact} /> : <p className="viz-empty">No open bids.</p>}
    </ChartCard>
  );
}

export function StatusDonutCard({ rows }: { rows: OppRow[] }) {
  const m = statusMix(rows);
  const total = m.open + m.won + m.lost;
  const data = [
    { label: 'Open', value: m.open, color: 'color-mix(in srgb, var(--brand-primary, #006b4f) 55%, transparent)' },
    { label: 'Won', value: m.won, color: 'var(--success, #177048)' },
    { label: 'Lost', value: m.lost, color: 'color-mix(in srgb, var(--fg-tertiary, #6b6b6b) 45%, transparent)' },
  ].filter((d) => d.value > 0);
  return (
    <ChartCard title="Bids by status" meta={`${total} bids`}
      summary={`Open ${m.open}, won ${m.won}, lost ${m.lost}.`}
      table={{ columns: ['Status', 'Bids'], rows: data.map((d) => [d.label, d.value]) }}>
      <div className="dash-rings">
        <StatusRings data={data} total={total} />
        <ul className="viz-legend dash-rings-legend">
          {data.map((d, i) => (
            <li key={d.label}>
              <span className="dash-rings-key">
                <svg width="10" height="10" aria-hidden>{i % 3 === 0 ? <circle cx="5" cy="5" r="4" fill={d.color} /> : i % 3 === 1 ? <rect x="1" y="1" width="8" height="8" fill={d.color} /> : <path d="M5 1 L9 9 L1 9 Z" fill={d.color} />}</svg>
                {d.label}
              </span>
              <span className="dash-rings-num">{d.value}<span className="viz-meta"> · {Math.round((d.value / total) * 100)}%</span></span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}

export function ForecastCard({ rows, projection, headingLevel }: {
  rows: OppRow[];
  headingLevel?: 2 | 3;
  projection?: { periods: Array<{ label: string; weightedMicros: number; wonMicros: number; openMicros: number; manualCommitMicros: number | null }> };
}) {
  const actuals = wonByQuarter(rows).map((q) => ({ label: q.label, won: q.won, weighted: 0, open: 0 }));
  const future = (projection?.periods ?? [])
    .filter((p) => p.openMicros > 0 || p.weightedMicros > 0)
    .map((p) => ({ label: p.label, won: p.wonMicros / 1e6, weighted: p.weightedMicros / 1e6, open: p.openMicros / 1e6 }));
  const seen = new Set(future.map((f) => f.label));
  const data = [...actuals.filter((a) => !seen.has(a.label)), ...future];
  const commits = (projection?.periods ?? []).map((p) => p.manualCommitMicros).filter((v): v is number => v !== null && v > 0);
  const target = commits.length ? commits[0]! / 1e6 : null;
  return (
    <ChartCard headingLevel={headingLevel} title="Revenue and forecast" meta={target ? `Commit target ${fmtCompact(target)} per quarter` : 'No target set yet · add a commit forecast to compare'}
      summary={data.map((d) => `${d.label}: won ${fmtCompact(d.won)}${d.weighted ? `, weighted ${fmtCompact(d.weighted)}` : ''}`).join('; ')}
      table={{ columns: ['Quarter', 'Won', 'Weighted', 'Open'], rows: data.map((d) => [d.label, fmtCompact(d.won), fmtCompact(d.weighted), fmtCompact(d.open)]) }}>
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

export function TopAccountsBarCard({ rows, headingLevel }: { rows: OppRow[]; headingLevel?: 2 | 3 }) {
  const data = accountBars(rows);
  return (
    <ChartCard headingLevel={headingLevel} title="Top accounts" meta="Won plus open value"
      summary={data.map((d) => `${d.label}: won ${fmtCompact(d.won)}, open ${fmtCompact(d.open)}`).join('; ')}
      table={{ columns: ['Account', 'Won', 'Open'], rows: data.map((d) => [d.label, fmtCompact(d.won), fmtCompact(d.open)]) }}>
      <HBars data={data} format={fmtCompact} />
      <ul className="viz-legend" aria-hidden>
        <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--success, #177048) 75%, transparent)' }} />Won</li>
        <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--brand-primary, #006b4f) 22%, transparent)' }} />Open</li>
      </ul>
    </ChartCard>
  );
}

const isSampleTitle = (t: string) => /^sample:/i.test(t);

export function WatchdogHeatCard({ feed }: { feed?: WatchdogFeed }) {
  const weeks = (feed?.heatWeekStarts ?? []).map((w) => weekFmt.format(new Date(w)));
  const rows = (feed?.heat ?? []).map((h) => ({ id: h.companyId, name: h.companyName, cells: h.weeks.map((w) => ({ kind: w.worst, count: w.count })) }));
  const sample = (feed?.alerts ?? []).some((a) => isSampleTitle(a.title));
  return (
    <ChartCard title="Account watchdog" meta="Signals per week, last 8 weeks"
      sample={sample ? 'Local demo signals (titles start with "Sample:")' : undefined}
      summary={rows.map((r) => `${r.name}: ${r.cells.reduce((n, c) => n + c.count, 0)} signals`).join('; ') || 'No signals in the last 8 weeks'}
      table={{ columns: ['Account', ...weeks], rows: rows.map((r) => [r.name, ...r.cells.map((c) => (c.count ? `${c.count} ${c.kind ? KIND_LABEL[c.kind] : ''}` : '–'))]) }}>
      {rows.length ? <HeatStrip rows={rows} weeks={weeks} /> : <p className="viz-empty">No signals in the last 8 weeks.</p>}
      <SignalLegend />
    </ChartCard>
  );
}

export function EarningsCard({ feed }: { feed?: WatchdogFeed }) {
  const items = (feed?.earnings ?? []).map((e) => ({ id: e.id, date: e.expectedAt, label: e.companyName }));
  return (
    <ChartCard title="Upcoming results" meta={`Next ${feed?.days ?? 30} days`}
      summary={items.map((i) => `${i.label} on ${dayFmt.format(new Date(i.date))}`).join('; ') || 'No results expected'}
      table={{ columns: ['Account', 'Date'], rows: items.map((i) => [i.label, dayFmt.format(new Date(i.date))]) }}>
      {items.length ? <EarningsStrip items={items} days={feed?.days ?? 30} /> : <p className="viz-empty">No results expected in this window.</p>}
    </ChartCard>
  );
}

/** Revenue, win rate and top accounts in one card with kokonutui SmoothTab
 *  (MIT): one surface instead of three, each view keeps its own summary and
 *  table toggle. */
export function PerformanceCard({ rows, projection }: {
  rows: OppRow[];
  projection?: Parameters<typeof ForecastCard>[0]['projection'];
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
      </header>
      <SmoothTab
        label="Performance views"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'revenue', title: 'Revenue', content: <ForecastCard rows={rows} projection={projection} headingLevel={3} /> },
          { id: 'winrate', title: 'Win rate', content: <WinRateTrendCard rows={rows} headingLevel={3} /> },
          { id: 'accounts', title: 'Top accounts', content: <TopAccountsBarCard rows={rows} headingLevel={3} /> },
        ]}
      />
    </section>
  );
}
