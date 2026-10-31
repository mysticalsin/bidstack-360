// Account page: watchdog signals (2/3) beside upcoming results (1/3), then one
// "Track record" surface (won/lost summary, expandable projects, one quiet
// timeline). Direction: Tony 13:12 BRT + /workspace/fleet/polo-DESIGN.md.
// Density rules: top 3 signals by default, one line + one meta line per row,
// details on click, a single tinted pill instead of severity dots.
import '@/components/viz/viz.css';
import './watchdog.css';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';

import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { SignalLegend } from '@/components/viz/ChartCard';
import { MiniCalendar, SignalStrip, YearBars } from '@/components/viz/charts';
import { fmtCompact } from '@/components/viz/viz-data';
import { useAccountWatchdog, type AccountWatchdog, type WatchImplication } from '@/hooks/useAccountWatchdog';
import { daysUntil } from '@/lib/format';

const PILL: Record<WatchImplication, string> = {
  OPPORTUNITY: 'Opportunity',
  NEUTRAL: 'Watch',
  RISK: 'Risk',
};

const SOURCE: Record<string, string> = {
  sec_edgar: 'SEC EDGAR',
  companies_house: 'Companies House',
  amf: 'AMF',
  ir_feed: 'Investor relations',
  gdelt: 'News',
};

const TOP_SIGNALS = 3;
const TOP_TIMELINE = 4;

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const shortFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

const stagger = (i: number) => ({ '--i': Math.min(i, 5) }) as React.CSSProperties;

function Pill({ kind, children }: { kind: string; children: React.ReactNode }) {
  return (
    <span className="wd-pill" data-kind={kind}>
      {children}
    </span>
  );
}

function ShowMore({ total, shown, open, onToggle, noun, controls }: {
  total: number; shown: number; open: boolean; onToggle: () => void; noun: string; controls: string;
}) {
  if (total <= shown) return null;
  return (
    <button type="button" className="wd-more" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? 'Show fewer' : `Show all ${total} ${noun}`}
    </button>
  );
}

type WatchEvent = AccountWatchdog['events'][number];

function SignalRow({ e, i }: { e: WatchEvent; i: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="wd-row wd-arrive" style={stagger(i)}>
      <button
        type="button"
        className="wd-row-btn"
        aria-expanded={open}
        aria-controls={`${id}-d`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="wd-row-main">
          <span className="wd-row-title">{e.title}</span>
          <span className="wd-row-meta">
            {SOURCE[e.source] ?? e.source} · <time dateTime={e.occurredAt}>{dateFmt.format(new Date(e.occurredAt))}</time>
            {e.status === 'NEW' ? <span className="wd-new"> · New</span> : null}
          </span>
        </span>
        <Pill kind={e.implication}>{PILL[e.implication]}</Pill>
        <ChevronDown className="wd-chev" size={16} strokeWidth={1.5} aria-hidden />
      </button>
      <div id={`${id}-d`} className="wd-detail" data-open={open} hidden={!open}>
        <p>{e.summary}</p>
        {e.implicationRationale ? <p className="wd-row-meta">{e.implicationRationale}</p> : null}
        <a className="wd-link" href={e.sourceUrl} target="_blank" rel="noreferrer">
          Open source <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
        </a>
      </div>
    </li>
  );
}

function Signals({ data }: { data: AccountWatchdog }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  if (data.events.length === 0) {
    return (
      <p className="wd-empty">
        <span>Nothing new in public filings</span>
        {data.monitoring.identifiers.length > 0
          ? `Watching ${data.monitoring.identifiers.join(' · ')}.`
          : 'Add a ticker, SEC CIK or Companies House number to start watching.'}
      </p>
    );
  }
  const shown = all ? data.events : data.events.slice(0, TOP_SIGNALS);
  const to = new Date();
  // Axis spans the oldest signal (max 12 months back, min 6) up to today.
  const oldest = Math.min(...data.events.map((e) => new Date(e.occurredAt).getTime()));
  const floor = new Date(to.getFullYear(), to.getMonth() - 11, 1).getTime();
  const sixAgo = new Date(to.getFullYear(), to.getMonth() - 5, 1).getTime();
  const start = new Date(Math.max(floor, Math.min(sixAgo, oldest)));
  const from = new Date(start.getFullYear(), start.getMonth(), 1);
  const counts = { OPPORTUNITY: 0, NEUTRAL: 0, RISK: 0 } as Record<string, number>;
  for (const e of data.events) counts[e.implication] = (counts[e.implication] ?? 0) + 1;
  const sample = data.events.some((e) => /^sample:/i.test(e.title));
  return (
    <>
      <figure
        className="wd-strip viz-figure"
        role="img"
        aria-label={`Signals since ${from.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}: ${counts.OPPORTUNITY} opportunity, ${counts.NEUTRAL} watch, ${counts.RISK} risk. Listed below.`}
      >
        <SignalStrip
          events={data.events.map((e) => ({ id: e.id, at: e.occurredAt, kind: e.implication, title: e.title }))}
          from={from}
          to={to}
        />
        <figcaption className="wd-strip-cap">
          <SignalLegend />
          {sample ? <span className="viz-sample" title='Local demo signals (titles start with "Sample:")'>Sample</span> : null}
        </figcaption>
      </figure>
      <ul className="wd-list" id={listId} aria-live="polite">
        {shown.map((e, i) => (
          <SignalRow key={e.id} e={e} i={i} />
        ))}
      </ul>
      <ShowMore total={data.events.length} shown={TOP_SIGNALS} open={all} onToggle={() => setAll((v) => !v)} noun="signals" controls={listId} />
    </>
  );
}

function Results({ data }: { data: AccountWatchdog }) {
  if (data.earnings.length === 0) {
    return (
      <p className="wd-empty">
        <span>No results dates announced</span>Checked for the next 90 days.
      </p>
    );
  }
  const first = new Date(data.earnings[0]!.expectedAt);
  return (
    <>
    <div className="wd-cal viz-figure" aria-hidden>
      <MiniCalendar
        month={first}
        marks={data.earnings.map((d) => ({ date: d.expectedAt, label: `${d.fiscalPeriod.replace('-', ' ')} results` }))}
      />
    </div>
    <ul className="wd-list">
      {data.earnings.slice(0, TOP_SIGNALS).map((d, i) => {
        const days = daysUntil(d.expectedAt);
        return (
          <li key={d.id} className="wd-row wd-row-static wd-arrive" style={stagger(i)}>
            <span className="wd-row-main">
              <span className="wd-row-title">{d.fiscalPeriod.replace('-', ' ')} results</span>
              <span className="wd-row-meta">
                <time dateTime={d.expectedAt}>{shortFmt.format(new Date(d.expectedAt))}</time> ·{' '}
                {d.confirmed ? 'Confirmed' : 'Expected'}
              </span>
            </span>
            <span className="wd-when">{days === null ? '' : days <= 0 ? 'Today' : `in ${days} d`}</span>
          </li>
        );
      })}
    </ul>
    </>
  );
}

const amount = (micros: bigint) => formatUnspecifiedAmount(Number(micros / 1_000_000n));

function TrackRecord({ data }: { data: AccountWatchdog }) {
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [timelineAll, setTimelineAll] = useState(false);
  const projectsId = useId();
  const timelineId = useId();
  const won = data.pastProjects.filter((p) => p.outcome === 'won');
  const lost = data.pastProjects.length - won.length;
  const total = data.pastProjects.reduce((s, p) => s + BigInt(p.valueMicros), 0n);
  const wonValue = won.reduce((s, p) => s + BigInt(p.valueMicros), 0n);
  const wonShare = total > 0n ? Number((wonValue * 1000n) / total) / 10 : 0;
  const timeline = timelineAll ? data.history : data.history.slice(0, TOP_TIMELINE);
  const byYear = new Map<string, { won: number; lost: number }>();
  for (const p of data.pastProjects) {
    const y = String(new Date(p.closedAt).getUTCFullYear());
    const cur = byYear.get(y) ?? { won: 0, lost: 0 };
    const v = Number(BigInt(p.valueMicros) / 1_000_000n);
    if (p.outcome === 'won') cur.won += v; else cur.lost += v;
    byYear.set(y, cur);
  }
  const years = [...byYear.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([year, v]) => ({ year, ...v }));

  return (
    <section className="wd-surface" aria-labelledby="wd-track-h">
      <h2 id="wd-track-h" className="wd-h">Track record</h2>
      {data.pastProjects.length === 0 ? (
        <p className="wd-empty"><span>No closed projects yet</span>Won and lost bids appear here.</p>
      ) : (
        <div className="wd-track-grid">
        <div className="wd-summary">
          <p className="wd-summary-line">
            <span className="wd-summary-big">{won.length} won, {lost} lost</span>
            <span className="wd-row-meta" title={UNSPECIFIED_CURRENCY_BASIS}>{amount(total)} total value</span>
          </p>
          <div
            className="wd-bar"
            role="img"
            aria-label={`Won ${Math.round(wonShare)}% of closed value`}
          >
            <i style={{ '--w': `${wonShare}%` } as React.CSSProperties} />
          </div>
          <button
            type="button"
            className="wd-more"
            aria-expanded={projectsOpen}
            aria-controls={projectsId}
            onClick={() => setProjectsOpen((v) => !v)}
          >
            {projectsOpen ? 'Hide projects' : `Show ${data.pastProjects.length} projects`}
          </button>
        </div>
          <figure
            className="wd-years viz-figure"
            role="img"
            aria-label={`Won and lost value by close year: ${years.map((y) => `${y.year} won ${fmtCompact(y.won)}, lost ${fmtCompact(y.lost)}`).join('; ')}`}
          >
            <YearBars data={years} format={fmtCompact} />
            <ul className="viz-legend" aria-hidden>
              <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--success, #177048) 75%, transparent)' }} />Won</li>
              <li><i className="dash-key" style={{ background: 'color-mix(in srgb, var(--fg-tertiary, #6b6b6b) 30%, transparent)' }} />Lost</li>
            </ul>
          </figure>
          <ul id={projectsId} className="wd-list wd-projects" hidden={!projectsOpen}>
            {data.pastProjects.map((p) => (
              <li key={p.id} className="wd-row wd-row-static">
                <span className="wd-row-main">
                  <span className="wd-row-title">{p.name}</span>
                  <span className="wd-row-meta">
                    <time dateTime={p.closedAt}>{dateFmt.format(new Date(p.closedAt))}</time> ·{' '}
                    <span title={UNSPECIFIED_CURRENCY_BASIS}>{amount(BigInt(p.valueMicros))}</span>
                  </span>
                </span>
                <Pill kind={p.outcome === 'won' ? 'OPPORTUNITY' : 'NEUTRAL'}>{p.outcome === 'won' ? 'Won' : 'Lost'}</Pill>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="wd-sub-h">Timeline</h3>
      {data.history.length === 0 ? (
        <p className="wd-empty"><span>No history yet</span>Filings and closed bids build the timeline.</p>
      ) : (
        <>
          <ol className="wd-timeline" id={timelineId}>
            {timeline.map((h) => (
              <li key={h.id} data-type={h.type}>
                <time dateTime={h.at}>{shortFmt.format(new Date(h.at))}</time>
                <span className="wd-row-main">
                  <span className="wd-row-title">{h.title}</span>
                  <span className="wd-row-meta">{h.type === 'filing' ? 'Public filing' : 'Bid'} · {h.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <ShowMore total={data.history.length} shown={TOP_TIMELINE} open={timelineAll} onToggle={() => setTimelineAll((v) => !v)} noun="events" controls={timelineId} />
        </>
      )}
    </section>
  );
}

export function AccountWatchdogSection({ companyId }: { companyId: string }) {
  const q = useAccountWatchdog(companyId);
  const checked = q.data?.monitoring.lastCheckedAt;
  const fresh = q.data?.events.filter((e) => e.status === 'NEW').length ?? 0;
  return (
    <div className="wd" data-testid="account-watchdog">
      <div className="wd-grid">
        <section className="wd-surface" aria-labelledby="wd-feed-h">
          <header className="wd-head">
            <h2 id="wd-feed-h" className="wd-h">Signals</h2>
            {q.data ? (
              <span className="wd-row-meta">
                {fresh > 0 ? `${fresh} new` : 'Up to date'}
                {checked ? ` · checked ${shortFmt.format(new Date(checked))}` : ''}
              </span>
            ) : null}
          </header>
          {q.isLoading ? (
            <div aria-busy="true"><div className="wd-skel" /><div className="wd-skel" /><div className="wd-skel" /></div>
          ) : q.isError ? (
            <p className="wd-empty" role="alert">
              <span>Couldn&apos;t load signals</span>
              <button type="button" className="wd-more" onClick={() => void q.refetch()}>Retry</button>
            </p>
          ) : q.data ? (
            <>
              {q.data.monitoring.lastError ? (
                <p className="wd-row-meta" role="status">Last check failed. Showing the last good data.</p>
              ) : null}
              <Signals data={q.data} />
            </>
          ) : null}
        </section>
        <section className="wd-surface" aria-labelledby="wd-cal-h">
          <header className="wd-head">
            <h2 id="wd-cal-h" className="wd-h">Upcoming results</h2>
          </header>
          {q.isLoading ? <div className="wd-skel" /> : q.data ? <Results data={q.data} /> : null}
        </section>
      </div>
      {q.data ? <TrackRecord data={q.data} /> : null}
    </div>
  );
}
