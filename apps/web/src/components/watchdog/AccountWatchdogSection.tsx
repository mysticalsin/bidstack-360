// Account page: watchdog feed (2/3) beside upcoming results (1/3), then one
// "Track record" surface (won/lost summary, expandable projects). v21: the
// feed is ordered by importance (Latest on toggle), each row carries its
// category, outlet count and a Sample badge; the signal strip and the track
// record timeline moved into the Signals timeline above. Direction: Tony 13:12 BRT + /workspace/fleet/polo-DESIGN.md.
// Density rules: top 3 signals by default, one line + one meta line per row,
// details on click, a single tinted pill instead of severity dots.
import '@/components/viz/viz.css';
import './watchdog.css';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { MiniCalendar, YearBars } from '@/components/viz/charts';
import { CATEGORY_LABEL, noDash, sourceLabel } from '@/components/signals/category';
import type { SignalCategory } from '@bidstack/shared';
import { fmtCompact } from '@/components/viz/viz-data';
import { useAccountWatchdog, useSetWatchEventStatus, type AccountWatchdog, type WatchImplication } from '@/hooks/useAccountWatchdog';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useMeetingWatchdogFeed } from '@/hooks/useMeetingIntel';
import { mergeMeetingSignals } from '@/lib/meeting-intel/watchdog';
import { useCompanyEnrichment } from '@/hooks/useCompanyEnrichment';
import { mergeEnrichmentSignals } from '@/lib/enrichment/aggregate';
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
  meeting_intel: 'Meeting intel',
  enrichment: 'Hiring signals',
  financials: 'Filed financials',
};

const TOP_SIGNALS = 3;
const ALERT_LINE = 70;

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

const INTERNAL_LINK: Record<string, string> = {
  meeting_intel: 'Open flag and talking points',
  enrichment: 'See the evidence postings',
};

type WatchEvent = AccountWatchdog['events'][number];

/** Server-stored watch events can be dismissed; signals merged in the browser (meeting flags, Sample) cannot. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStored = (e: WatchEvent) => UUID.test(e.id) && !/^sample:/i.test(e.title);

const titleOf = (e: WatchEvent) => noDash(e.displayTitle ?? e.title);
const isSample = (e: WatchEvent) => e.sample ?? /^sample:/i.test(e.title);
const importanceOf = (e: WatchEvent) => e.importance ?? e.severity * 20;
const sourceName = (s: string) => SOURCE[s] ?? sourceLabel(s);

function SignalRow({ e, i, onDismiss }: { e: WatchEvent; i: number; onDismiss?: (e: WatchEvent) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const category = e.category && e.category in CATEGORY_LABEL ? CATEGORY_LABEL[e.category as SignalCategory] : null;
  const important = importanceOf(e) >= ALERT_LINE;
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
          <span className="wd-row-title">
            {important ? <span className="wd-imp" title="High importance">Important</span> : null}
            {titleOf(e)}
          </span>
          <span className="wd-row-meta">
            {category ? `${category} · ` : ''}
            {sourceName(e.source)}
            {!e.group && e.mentions && e.mentions > 1 ? ` · ${e.mentions} outlets` : ''} · <time dateTime={e.occurredAt}>{dateFmt.format(new Date(e.occurredAt))}</time>
            {e.status === 'NEW' ? <span className="wd-new"> · New</span> : null}
            {isSample(e) ? <span className="wd-sample-badge">Sample</span> : null}
          </span>
        </span>
        <Pill kind={e.implication}>{PILL[e.implication]}</Pill>
        <ChevronDown className="wd-chev" size={16} strokeWidth={1.5} aria-hidden />
      </button>
      <div id={`${id}-d`} className="wd-detail" data-open={open} hidden={!open}>
        {e.group ? (
          <ul className="wd-group" aria-label="Analyst notes in this group">
            {e.group.map((g) => (
              <li key={g.id}>
                <a className="wd-link" href={g.sourceUrl} target="_blank" rel="noreferrer">
                  {noDash(g.title)}
                </a>{' '}
                <time className="wd-row-meta" dateTime={g.occurredAt}>{dateFmt.format(new Date(g.occurredAt))}</time>
              </li>
            ))}
          </ul>
        ) : (
          <p>{noDash(e.summary)}</p>
        )}
        {e.implicationRationale ? <p className="wd-row-meta">{e.implicationRationale}</p> : null}
        {e.group || !e.sourceUrl ? null : e.sourceUrl.startsWith('/') ? (
          <Link className="wd-link" to={e.sourceUrl}>{INTERNAL_LINK[e.source] ?? 'Open'}</Link>
        ) : (
          <a className="wd-link" href={e.sourceUrl} target="_blank" rel="noreferrer">
            Open source <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
          </a>
        )}
        {onDismiss ? (
          <button type="button" className="wd-more wd-dismiss" onClick={() => onDismiss(e)} aria-label={`Dismiss signal: ${titleOf(e)}`}>
            Dismiss
          </button>
        ) : null}
      </div>
    </li>
  );
}

function Signals({ data }: { data: AccountWatchdog }) {
  const [all, setAll] = useState(false);
  const [order, setOrder] = useState<'important' | 'latest'>('important');
  const listId = useId();
  const canDismiss = useHasPermission('accounts:write');
  const setStatus = useSetWatchEventStatus(data.companyId);
  const [undo, setUndo] = useState<WatchEvent | null>(null);
  const dismiss = (e: WatchEvent) => {
    setUndo(e);
    setStatus.mutate({ eventId: e.id, status: 'DISMISSED' });
  };
  const undoBar = undo ? (
    <p className="wd-row-meta wd-undo" role="status">
      Dismissed “{titleOf(undo)}”.{' '}
      <button
        type="button"
        className="wd-more"
        onClick={() => {
          setStatus.mutate({ eventId: undo.id, status: 'NEW' });
          setUndo(null);
        }}
      >
        Undo
      </button>
    </p>
  ) : setStatus.isError ? (
    <p className="wd-row-meta" role="alert">Couldn&apos;t update the signal. Try again.</p>
  ) : null;
  const newsHint = data.news?.hint ? (
    <p className="wd-news-hint" data-testid="wd-news-hint">
      {data.news.hint}
    </p>
  ) : null;
  if (data.events.length === 0) {
    return (
      <>
      {undoBar}
      {newsHint}
      <p className="wd-empty">
        <span>Nothing new in public filings</span>
        {data.monitoring.identifiers.length > 0
          ? `Watching ${data.monitoring.identifiers.join(' · ')}.`
          : 'Add a ticker, SEC CIK or Companies House number to start watching.'}
      </p>
      </>
    );
  }
  const sorted = [...data.events].sort((a, b) =>
    order === 'latest'
      ? b.occurredAt.localeCompare(a.occurredAt)
      : importanceOf(b) - importanceOf(a) || b.occurredAt.localeCompare(a.occurredAt),
  );
  const shown = all ? sorted : sorted.slice(0, TOP_SIGNALS);
  const important = data.events.filter((e) => importanceOf(e) >= ALERT_LINE).length;
  return (
    <>
      <div className="wd-toolbar">
        <span className="wd-row-meta">
          {data.events.length} {data.events.length === 1 ? 'signal' : 'signals'}
          {important ? `, ${important} important` : ''}
        </span>
        <div className="wd-seg" role="group" aria-label="Order signals">
          <button type="button" aria-pressed={order === 'important'} onClick={() => setOrder('important')}>Most important</button>
          <button type="button" aria-pressed={order === 'latest'} onClick={() => setOrder('latest')}>Latest</button>
        </div>
      </div>
      <ul className="wd-list" id={listId} aria-live="polite">
        {shown.map((e, i) => (
          <SignalRow key={e.id} e={e} i={i} onDismiss={canDismiss && isStored(e) ? dismiss : undefined} />
        ))}
      </ul>
      <ShowMore total={data.events.length} shown={TOP_SIGNALS} open={all} onToggle={() => setAll((v) => !v)} noun="signals" controls={listId} />
      {undoBar}
      {newsHint}
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
  const projectsId = useId();
  const won = data.pastProjects.filter((p) => p.outcome === 'won');
  const lost = data.pastProjects.length - won.length;
  const total = data.pastProjects.reduce((s, p) => s + BigInt(p.valueMicros), 0n);
  const wonValue = won.reduce((s, p) => s + BigInt(p.valueMicros), 0n);
  const wonShare = total > 0n ? Number((wonValue * 1000n) / total) / 10 : 0;
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

    </section>
  );
}

export function AccountWatchdogSection({ companyId }: { companyId: string }) {
  const raw = useAccountWatchdog(companyId);
  // Task 5: cross-region meeting flags (GET /meeting-intel/flags?format=watchdog)
  // join this account's signals as OPPORTUNITY rows. Optional: no access = none.
  const meetings = useMeetingWatchdogFeed(Boolean(raw.data));
  const enrichment = useCompanyEnrichment(raw.data ? companyId : undefined);
  const data = useMemo(
    () => (raw.data ? mergeEnrichmentSignals(mergeMeetingSignals(raw.data, meetings.data?.items, companyId), enrichment.data) : undefined),
    [raw.data, meetings.data, enrichment.data, companyId],
  );
  const q = { ...raw, data };
  const checked = q.data?.monitoring.lastCheckedAt;
  const fresh = q.data?.events.filter((e) => e.status === 'NEW').length ?? 0;
  return (
    <div className="wd" data-testid="account-watchdog">
      <div className="wd-grid">
        <section id="watchdog" className="wd-surface" style={{ scrollMarginTop: 80 }} aria-labelledby="wd-feed-h">
          <header className="wd-head">
            <h2 id="wd-feed-h" className="wd-h">Watchdog</h2>
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
