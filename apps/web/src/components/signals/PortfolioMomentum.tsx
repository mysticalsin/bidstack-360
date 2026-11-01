// Portfolio view (dashboard): every account ranked by momentum change, grouped
// gaining / steady / declining, with a mini trend line, the score and a
// diverging bar for the 4-week change. Beside it, the top watchdog alerts
// across accounts. Contract: GET /portfolio/momentum (polo-signals-api.md).
import './signals.css';

import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';

import type { PortfolioMomentum as PortfolioData } from '@bidstack/shared';

import { AreaSparkline } from '@/components/charts/bklit-sparkline';
import { usePortfolioMomentum } from '@/hooks/useAccountSignals';

import { CATEGORY_LABEL, CATEGORY_TONE, noDash, sourceLabel } from './category';

type Trend = PortfolioData['accounts'][number]['trend'];
const TRENDS: Array<{ key: Trend | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'gaining', label: 'Gaining' },
  { key: 'steady', label: 'Steady' },
  { key: 'declining', label: 'Declining' },
];
const COLOR: Record<Trend, string> = {
  gaining: 'var(--success, #177048)',
  steady: 'var(--fg-tertiary, #6b6b6b)',
  declining: 'var(--danger, #b82032)',
};
const TOP = 10;
const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

export function MomentumList({ data }: { data: PortfolioData }) {
  const reduced = useReducedMotion();
  const [filter, setFilter] = useState<Trend | 'all'>('all');
  const [all, setAll] = useState(false);
  const listId = useId();
  // Biggest movers first in either direction, so a decline is never below the fold.
  const rows = data.accounts
    .filter((a) => filter === 'all' || a.trend === filter)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.score - a.score);
  const shown = all ? rows : rows.slice(0, TOP);
  const maxAbs = Math.max(10, ...data.accounts.map((a) => Math.abs(a.delta)));
  const total = data.accounts.length;
  return (
    <>
      <div className="sg-head">
        <div className="sg-port-seg" role="group" aria-label="Filter accounts by momentum">
          {TRENDS.map((t) => (
            <button key={t.key} type="button" aria-pressed={filter === t.key} onClick={() => { setFilter(t.key); setAll(false); }}>
              {t.label} <b>{t.key === 'all' ? total : data.counts[t.key]}</b>
            </button>
          ))}
        </div>
        {data.accounts.some((a) => a.sample) ? <span className="sg-sample" title="Includes sample signals seeded for the demo">Sample</span> : null}
      </div>
      <p className="sr-only">
        {`${data.counts.gaining} accounts gaining, ${data.counts.steady} steady, ${data.counts.declining} declining. `}
        {data.accounts.slice(0, 5).map((a) => `${a.companyName} ${a.score}, ${fmt(a.delta)} in 4 weeks`).join('; ')}.
      </p>
      {rows.length === 0 ? (
        <p className="sg-empty"><span>No accounts here</span>Try another filter.</p>
      ) : (
        <ol id={listId} className="sg-port-list" aria-label="Accounts ranked by size of momentum change">
          {shown.map((a, i) => {
            const w = (Math.abs(a.delta) / maxAbs) * 50;
            return (
              <li key={a.companyId} className="sg-port-row" style={{ '--i': Math.min(i, 5) } as React.CSSProperties}>
                <span className="sg-port-name">
                  <Link to={`/accounts/${encodeURIComponent(a.companyId)}`} title={a.companyName}>{a.companyName}</Link>
                  <span>
                    {noDash(a.verdict)}
                    {a.dealsCapped ? ' · Latest 1,000 deals' : ''}
                    {a.feedsCapped ? ' · Latest 1,000 signals' : ''}
                    {a.childrenCapped ? ' · Latest 1,000 subsidiaries' : ''}
                  </span>
                </span>
                <span className="sg-port-spark" aria-hidden>
                  {a.series.length > 1 ? (
                    <AreaSparkline data={a.series.map((v) => ({ v }))} dataKey="v" height={28} color={COLOR[a.trend]} yDomain={[0, 100]} animate={!reduced} interactive={false} fillOpacity={0.12} />
                  ) : null}
                </span>
                <span className="sg-port-score" aria-label={`Momentum ${a.score} of 100`}>{a.score}</span>
                <span className="sg-contrib-track" aria-hidden>
                  <i
                    className="sg-contrib-bar sg-grow"
                    data-dir={a.trend === 'gaining' ? 'up' : a.trend === 'declining' ? 'down' : 'flat'}
                    style={a.delta >= 0 ? { left: '50%', width: `${Math.max(1, w)}%` } : { right: '50%', width: `${w}%` }}
                  />
                </span>
                <span className="sg-port-delta" data-trend={a.trend} aria-label={`${fmt(a.delta)} in 4 weeks`}>{fmt(a.delta)}</span>
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > TOP ? (
        <button type="button" className="sg-link" aria-expanded={all} aria-controls={listId} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${rows.length} accounts`}
        </button>
      ) : null}
    </>
  );
}

export function AlertsList({ alerts }: { alerts: PortfolioData['alerts'] }) {
  if (!alerts.length) {
    return <p className="sg-empty"><span>No important alerts</span>The watchdog flags funding, launches, exec moves and risks here.</p>;
  }
  return (
    <ul className="sg-alerts" aria-live="polite">
      {alerts.map((a) => (
        <li key={a.id}>
          <article className="sg-alert" aria-labelledby={`al-${a.id}`}>
            <span className="sg-alert-meta">
              <span className="sg-tag" data-tone={CATEGORY_TONE[a.category]}>
                <i className="sg-dot-key" aria-hidden />
                {CATEGORY_LABEL[a.category]}
              </span>
              <span>{a.companyName}</span>
              <time dateTime={a.occurredAt}>{shortFmt.format(new Date(a.occurredAt))}</time>
              {a.sample ? <span className="sg-sample">Sample</span> : <span>{sourceLabel(a.source)}</span>}
            </span>
            <Link id={`al-${a.id}`} to={`/accounts/${encodeURIComponent(a.companyId)}#watchdog`}>{noDash(a.title)}</Link>
          </article>
        </li>
      ))}
    </ul>
  );
}

export function PortfolioMomentum() {
  const q = usePortfolioMomentum();
  const body = (render: (d: PortfolioData) => React.ReactNode, h: number) =>
    q.isLoading ? <div className="sg-skel" aria-busy="true" style={{ minHeight: h }} /> : q.isError || !q.data ? (
      <p className="sg-empty" role="alert"><span>Couldn&apos;t load momentum</span><button type="button" className="sg-link" onClick={() => void q.refetch()}>Retry</button></p>
    ) : render(q.data);
  return (
    <div className="sg viz-grid-3" data-testid="portfolio-momentum">
      <section className="sg-surface" aria-labelledby="sg-port-h">
        <header className="sg-head" style={{ marginBottom: 8 }}>
          <h2 id="sg-port-h" className="sg-h">Account momentum</h2>
          <span className="sg-meta">Change in the last 4 weeks</span>
        </header>
        {body((d) => <MomentumList data={d} />, 360)}
      </section>
      <section className="sg-surface" aria-labelledby="sg-alerts-h">
        <header className="sg-head">
          <h2 id="sg-alerts-h" className="sg-h">Watchdog alerts</h2>
          <span className="sg-meta">Most important first</span>
        </header>
        {body((d) => <AlertsList alerts={d.alerts} />, 360)}
      </section>
    </div>
  );
}

export default PortfolioMomentum;
