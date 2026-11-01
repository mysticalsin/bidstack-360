// Account pulse: answers "are we gaining traction or declining?" in five
// seconds. One hero figure (momentum 0..100), trend arrow with the 4-week
// change, a 13-week sparkline, a plain-English verdict and the top 3 drivers.
// A driver opens a drill panel (motion-primitives TransitionPanel) with what
// it measures and every driver's contribution. Contract: polo-signals-api.md.
import './signals.css';

import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';

import type { AccountPulse } from '@bidstack/shared';

import { AreaSparkline } from '@/components/charts/bklit-sparkline';
import { AnimatedNumber } from '@/components/motion-primitives/animated-number';
import { TransitionPanel } from '@/components/motion-primitives/transition-panel';
import { useAccountPulse } from '@/hooks/useAccountSignals';

type Driver = AccountPulse['drivers'][number];

const TREND_WORD: Record<AccountPulse['trend'], string> = { gaining: 'Gaining', steady: 'Steady', declining: 'Declining' };
const TREND_COLOR: Record<AccountPulse['trend'], string> = {
  gaining: 'var(--success, #177048)',
  steady: 'var(--brand-primary, #006b4f)',
  declining: 'var(--danger, #b82032)',
};

const DRIVER_INFO: Record<Driver['key'], { measures: string; link: (id: string) => { to: string; label: string } }> = {
  pipeline: { measures: 'Open pipeline value now compared with 90 days ago.', link: () => ({ to: '#signals-timeline', label: 'See deals on the timeline' }) },
  meetings: { measures: 'Meetings in the last 60 days against the 60 before, and how recent the last one was.', link: (id) => ({ to: `/meetings?account=${encodeURIComponent(id)}`, label: 'Open meetings' }) },
  winloss: { measures: 'Deals won and lost in the last 180 days.', link: () => ({ to: '#signals-timeline', label: 'See wins and losses' }) },
  hiring: { measures: 'Job postings in the last 30 days against the 30 before, plus 12-month headcount growth.', link: () => ({ to: '#initiatives', label: 'See what they are hiring for' }) },
  news: { measures: 'Tone of their news in the last 90 days, weighted by importance.', link: () => ({ to: '#watchdog', label: 'Open the watchdog feed' }) },
};

const fmtPts = (raw: number) => {
  const n = Math.round(raw);
  return n > 0 ? `+${n}` : n < 0 ? `${n}` : '0';
};
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

function TrendIcon({ trend }: { trend: AccountPulse['trend'] }) {
  const Icon = trend === 'gaining' ? ArrowUpRight : trend === 'declining' ? ArrowDownRight : ArrowRight;
  return <Icon size={18} strokeWidth={2} aria-hidden />;
}

function PulseLink({ to, children }: { to: string; children: React.ReactNode }) {
  if (to.startsWith('#')) {
    return (
      <a className="sg-link" href={to} onClick={(e) => {
        const el = document.getElementById(to.slice(1));
        if (!el) return;
        e.preventDefault();
        el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      }}>{children}</a>
    );
  }
  return <Link className="sg-link" to={to}>{children}</Link>;
}

export function PulseView({ pulse }: { pulse: AccountPulse }) {
  const reduced = useReducedMotion();
  const panelId = useId();
  const top = useMemo(() => [...pulse.drivers].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3), [pulse.drivers]);
  const [open, setOpen] = useState<Driver['key'] | null>(null);
  const active = pulse.drivers.find((d) => d.key === open) ?? null;
  const first = pulse.series[0];
  const last = pulse.series[pulse.series.length - 1];
  const maxAbs = Math.max(10, ...pulse.drivers.map((d) => Math.abs(d.points)));
  const series = pulse.series.map((p) => ({ score: p.score }));
  // Fit the line to its own range (at least 30 points tall) so a trend reads.
  const lo = Math.min(...pulse.series.map((p) => p.score), pulse.score);
  const hi = Math.max(...pulse.series.map((p) => p.score), pulse.score);
  const pad = Math.max(0, 30 - (hi - lo)) / 2 + 4;
  const yDomain: [number, number] = [Math.max(0, lo - pad), Math.min(100, hi + pad)];
  const thin = pulse.coverage < 0.4;

  return (
    <section className="sg sg-surface sg-pulse" aria-labelledby={`${panelId}-h`} data-testid="account-pulse">
      <div>
        <h2 id={`${panelId}-h`} className="sg-pulse-label">Account pulse</h2>
        <div className="sg-score-row">
          <span className="sg-score">
            <AnimatedNumber value={pulse.score} from={50} />
            <small>/ 100</small>
          </span>
          <span className="sg-trend" data-trend={pulse.trend}>
            <TrendIcon trend={pulse.trend} />
            {TREND_WORD[pulse.trend]} {fmtPts(pulse.delta)}
            <span className="sg-meta">in 4 weeks</span>
          </span>
          {pulse.sample ? <span className="sg-sample" title="Includes sample signals seeded for the demo">Sample</span> : null}
        </div>
        <p className="sg-verdict">{pulse.verdict}</p>
        <div className="sg-drivers" role="group" aria-label="Top drivers">
          {top.map((d) => (
            <button
              key={d.key}
              type="button"
              className="sg-driver"
              aria-pressed={open === d.key}
              aria-controls={`${panelId}-drill`}
              onClick={() => setOpen((k) => (k === d.key ? null : d.key))}
            >
              <span>{d.label}</span>
              <span className="sg-driver-pts" data-dir={d.direction}>{fmtPts(d.points)}</span>
            </button>
          ))}
        </div>
      </div>

      <figure
        className="sg-spark"
        role="img"
        aria-label={`Momentum over ${pulse.series.length} weeks: from ${first?.score ?? pulse.score} to ${last?.score ?? pulse.score}.`}
      >
        <div className="sg-spark-plot" aria-hidden>
          <AreaSparkline
            data={series}
            dataKey="score"
            height={112}
            color={TREND_COLOR[pulse.trend]}
            yDomain={yDomain}
            animate={!reduced}
            endDot
            fillOpacity={0.16}
          />
        </div>
        <figcaption className="sg-spark-cap" aria-hidden>
          <span>{first ? dayFmt.format(new Date(first.at)) : ''}</span>
          <span>{thin ? 'Early read, few signals' : 'Weekly momentum'}</span>
          <span>Today</span>
        </figcaption>
      </figure>

      <div id={`${panelId}-drill`} className="sg-drill" hidden={!active} aria-live="polite">
        <TransitionPanel activeIndex={active ? pulse.drivers.indexOf(active) : 0}>
          {pulse.drivers.map((d) => (
            <div key={d.key} className="sg-drill-grid">
              <div>
                <h3>{d.label}: {fmtPts(d.points)} points</h3>
                <p>{d.detail}</p>
                <p className="sg-meta">{DRIVER_INFO[d.key].measures}</p>
                <PulseLink to={DRIVER_INFO[d.key].link(pulse.companyId).to}>{DRIVER_INFO[d.key].link(pulse.companyId).label}</PulseLink>
              </div>
              <ul className="sg-contrib" aria-label="What moves the score">
                {pulse.drivers.map((c) => {
                  const w = (Math.abs(c.points) / maxAbs) * 50;
                  return (
                    <li key={c.key} data-active={c.key === d.key}>
                      <span>{c.label}</span>
                      <span className="sg-contrib-track" aria-hidden>
                        <i
                          className="sg-contrib-bar"
                          data-dir={c.direction}
                          style={c.points >= 0 ? { left: '50%', width: `${Math.max(1, w)}%` } : { right: '50%', width: `${w}%` }}
                        />
                      </span>
                      <span className="sg-contrib-num">{fmtPts(c.points)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </TransitionPanel>
      </div>

    </section>
  );
}

export function PulseHero({ companyId }: { companyId: string }) {
  const q = useAccountPulse(companyId);
  if (q.isLoading) return <div className="sg sg-pulse" aria-busy="true"><div className="sg-skel" style={{ gridColumn: '1 / -1', minHeight: 252 }} /></div>;
  if (q.isError || !q.data) {
    return (
      <section className="sg sg-surface" style={{ marginBottom: 24 }}>
        <p className="sg-empty" role="alert">
          <span>Couldn&apos;t load the account pulse</span>
          <button type="button" className="sg-link" onClick={() => void q.refetch()}>Retry</button>
        </p>
      </section>
    );
  }
  return <PulseView pulse={q.data} />;
}

export default PulseHero;
