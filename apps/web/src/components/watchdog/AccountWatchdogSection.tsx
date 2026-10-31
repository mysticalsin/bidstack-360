// Account page: Financial watchdog feed (2/3), earnings calendar (1/3), then
// Past projects / History tabs. Spec: /workspace/fleet/polo-DESIGN.md.
import './watchdog.css';

import { AlertTriangle, ArrowUpRight, CalendarDays, Eye, History, Radar } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { formatUnspecifiedAmount, UNSPECIFIED_CURRENCY_BASIS } from '@/components/dashboard/unspecified-currency';
import { useAccountWatchdog, type AccountWatchdog, type WatchImplication } from '@/hooks/useAccountWatchdog';
import { daysUntil } from '@/lib/format';

const TAG: Record<WatchImplication, { label: string; icon: ReactNode }> = {
  OPPORTUNITY: { label: 'Opportunity', icon: <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden /> },
  RISK: { label: 'Risk', icon: <AlertTriangle size={14} strokeWidth={1.5} aria-hidden /> },
  NEUTRAL: { label: 'Watch', icon: <Eye size={14} strokeWidth={1.5} aria-hidden /> },
};

const SOURCE: Record<string, string> = {
  sec_edgar: 'SEC EDGAR',
  companies_house: 'Companies House',
  amf: 'AMF',
  ir_feed: 'Investor relations',
  gdelt: 'GDELT news',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit' });
const monFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });

function Severity({ value }: { value: number }) {
  return (
    <span className="wd-sev" role="img" aria-label={`Severity ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <i key={n} data-on={String(n <= value)} />
      ))}
    </span>
  );
}

function Feed({ data }: { data: AccountWatchdog }) {
  if (data.events.length === 0) {
    return (
      <div className="wd-empty">
        <strong>No public filings tracked yet</strong>
        {data.monitoring.identifiers.length > 0
          ? `Watching ${data.monitoring.identifiers.join(' · ')}. Nothing filed since the last check.`
          : 'Add a ticker, SEC CIK or Companies House number to start monitoring.'}
      </div>
    );
  }
  return (
    <ul className="wd-list" aria-live="polite">
      {data.events.slice(0, 8).map((e, i) => {
        const tag = TAG[e.implication];
        return (
          <li
            key={e.id}
            className="wd-item wd-arrive"
            style={{ '--i': Math.min(i, 5) } as React.CSSProperties}
          >
            <span className="wd-tag" data-kind={e.implication} style={{ paddingTop: 2 }}>
              {tag.icon}
            </span>
            <article>
              <div className="wd-item-title">
                <a className="wd-link" href={e.sourceUrl} target="_blank" rel="noreferrer">
                  {e.title}
                </a>
              </div>
              <div className="wd-item-meta">
                {SOURCE[e.source] ?? e.source} · <time dateTime={e.occurredAt}>{dateFmt.format(new Date(e.occurredAt))}</time>
              </div>
              <p className="wd-item-sum">{e.summary}</p>
            </article>
            <span className="wd-tag" data-kind={e.implication}>
              {tag.label}
              <Severity value={e.severity} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Calendar({ data }: { data: AccountWatchdog }) {
  if (data.earnings.length === 0) {
    return (
      <div className="wd-empty">
        <strong>No scheduled results</strong>
        Nothing announced for the next 90 days.
      </div>
    );
  }
  return (
    <ul className="wd-list">
      {data.earnings.map((d, i) => {
        const days = daysUntil(d.expectedAt);
        const at = new Date(d.expectedAt);
        return (
          <li key={d.id} className="wd-cal wd-arrive" style={{ '--i': Math.min(i, 5) } as React.CSSProperties}>
            <time className="wd-date" dateTime={d.expectedAt}>
              <b>{dayFmt.format(at)}</b>
              <span>{monFmt.format(at)}</span>
            </time>
            <div style={{ minWidth: 0 }}>
              <div className="wd-item-title">{d.fiscalPeriod.replace('-', ' ')} results</div>
              <div className="wd-item-meta">
                {d.confirmed ? 'Confirmed' : 'Expected'} · {SOURCE[d.source] ?? d.source}
              </div>
            </div>
            <span className="wd-count">{days === null ? '' : days <= 0 ? 'today' : `in ${days} d`}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PastAndHistory({ data }: { data: AccountWatchdog }) {
  const [tab, setTab] = useState<'projects' | 'history'>('projects');
  const id = useId();
  const won = data.pastProjects.filter((p) => p.outcome === 'won');
  return (
    <section className="wd-card" aria-labelledby={`${id}-h`}>
      <div className="wd-head">
        <h3 id={`${id}-h`} className="wd-title">
          <History size={16} strokeWidth={1.5} aria-hidden /> Past projects &amp; history
        </h3>
        <span className="wd-count">
          {won.length} won · {data.pastProjects.length - won.length} lost
        </span>
      </div>
      <div role="tablist" className="wd-tabs" aria-label="Account record">
        {(['projects', 'history'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            id={`${id}-${k}`}
            aria-selected={tab === k}
            aria-controls={`${id}-${k}-panel`}
            className="wd-tab"
            onClick={() => setTab(k)}
          >
            {k === 'projects' ? 'Past projects' : 'History'}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}`} className="wd-panel" key={tab}>
        {tab === 'projects' ? (
          data.pastProjects.length === 0 ? (
            <div className="wd-empty"><strong>No closed projects yet</strong>Won and lost bids appear here.</div>
          ) : (
            <ul className="wd-list">
              {data.pastProjects.slice(0, 10).map((p) => (
                <li key={p.id} className="wd-cal">
                  <div style={{ minWidth: 0 }}>
                    <div className="wd-item-title">{p.name}</div>
                    <div className="wd-item-meta">
                      <time dateTime={p.closedAt}>{dateFmt.format(new Date(p.closedAt))}</time> ·{' '}
                      <span title={UNSPECIFIED_CURRENCY_BASIS}>
                        {formatUnspecifiedAmount(Number(BigInt(p.valueMicros) / 1_000_000n))}
                      </span>
                    </div>
                  </div>
                  <span className="wd-count wd-tag" data-kind={p.outcome === 'won' ? 'OPPORTUNITY' : 'RISK'}>
                    {p.outcome === 'won' ? 'Won' : 'Lost'}
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : data.history.length === 0 ? (
          <div className="wd-empty"><strong>No history yet</strong>Filings and closed bids build the timeline.</div>
        ) : (
          <ol className="wd-list">
            {data.history.slice(0, 12).map((h) => (
              <li key={h.id} className="wd-cal">
                <time className="wd-count" style={{ marginLeft: 0, width: 88 }} dateTime={h.at}>
                  {dateFmt.format(new Date(h.at))}
                </time>
                <div style={{ minWidth: 0 }}>
                  <div className="wd-item-title">{h.title}</div>
                  <div className="wd-item-meta">{h.type === 'filing' ? 'Public filing' : 'Opportunity'} · {h.detail}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function AccountWatchdogSection({ companyId }: { companyId: string }) {
  const q = useAccountWatchdog(companyId);
  const checked = q.data?.monitoring.lastCheckedAt;
  return (
    <div className="wd" data-testid="account-watchdog">
      <div className="wd-grid">
        <section className="wd-card" aria-labelledby="wd-feed-h">
          <div className="wd-head">
            <h3 id="wd-feed-h" className="wd-title">
              <Radar size={16} strokeWidth={1.5} aria-hidden /> Financial watchdog
            </h3>
            {q.data && (
              <span className="wd-count">
                {q.data.events.filter((e) => e.status === 'NEW').length} new
              </span>
            )}
          </div>
          <p className="wd-sub">
            Public filings, results and leadership moves, each tagged as opportunity or risk.
            {checked ? ` Checked ${dateFmt.format(new Date(checked))}.` : ''}
          </p>
          {q.isLoading ? (
            <div aria-busy="true"><div className="wd-skel" /><div className="wd-skel" /><div className="wd-skel" /></div>
          ) : q.isError ? (
            <div className="wd-empty" role="alert">
              <strong>Couldn&apos;t load watchdog signals</strong>
              <button type="button" className="wd-tab" onClick={() => void q.refetch()}>Retry</button>
            </div>
          ) : q.data ? (
            <>
              {q.data.monitoring.lastError && (
                <p className="wd-sub" role="status">Last source check failed: {q.data.monitoring.lastError}. Showing last good data.</p>
              )}
              <Feed data={q.data} />
            </>
          ) : null}
        </section>
        <section className="wd-card" aria-labelledby="wd-cal-h">
          <div className="wd-head">
            <h3 id="wd-cal-h" className="wd-title">
              <CalendarDays size={16} strokeWidth={1.5} aria-hidden /> Upcoming earnings
            </h3>
          </div>
          <p className="wd-sub">Results dates from filings and investor-relations calendars.</p>
          {q.isLoading ? <div className="wd-skel" /> : q.data ? <Calendar data={q.data} /> : null}
        </section>
      </div>
      {q.data && <PastAndHistory data={q.data} />}
    </div>
  );
}
