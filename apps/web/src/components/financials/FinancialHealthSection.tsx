// v23: compact "Financial health" for the account page. Four sparklines
// (revenue, margin, capex, cash) from filed annual statements, each number
// with its period and source, then the top early-warning cards. Strategic and
// Top accounts are pulled automatically; General accounts show why not and,
// for Admin / AE, a Track financials toggle. Never invents a number: missing
// lines read "Not filed", and the built-in example is labelled Sample.
import '@/components/watchdog/watchdog.css';
import './financials.css';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';
import type { AccountFinancials } from '@bidstack/shared';

import { Spark } from '@/components/viz/charts';
import { noDash } from '@/components/signals/category';
import { useAccountFinancials, useTrackFinancials } from '@/hooks/useAccountFinancials';

import { buildTiles, type Tile } from './financials-format';

type Signal = AccountFinancials['signals'][number];

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
// Period ends are calendar dates: format in UTC so 31 Dec never shows as 30 Dec west of Greenwich.
const periodFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const STALE_MS = 548 * 24 * 3600 * 1000; // about 18 months

function MetricTile({ t, sample }: { t: Tile; sample: boolean }) {
  const last = t.series.at(-1);
  const prev = t.series.at(-2);
  if (!last) {
    return (
      <div className="fh-tile" data-testid={`fh-tile-${t.key}`}>
        <span className="wd-row-meta">{t.label}</span>
        <span className="fh-none">Not filed</span>
      </div>
    );
  }
  const source = sample ? 'Sample' : last.p.source;
  return (
    <div className="fh-tile" data-testid={`fh-tile-${t.key}`}>
      <span className="wd-row-meta">{t.label}</span>
      <span className="fh-value">
        {t.fmt(last.v, last.p)}
        {prev ? <span className="fh-delta">{t.delta(last.v, prev.v)}</span> : null}
      </span>
      <Spark values={t.series.map((s) => s.v)} label={`${t.label}, ${t.series.length} years`} width={120} height={28} />
      <span className="fh-src">
        FY{last.p.fiscalYear}, {t.series.length > 1 ? `${t.series.length} years, ` : ''}
        {last.p.sourceUrl && !sample ? (
          <a className="wd-link" href={last.p.sourceUrl} target="_blank" rel="noreferrer">{source}</a>
        ) : (
          source
        )}
      </span>
    </div>
  );
}

const CONF: Record<Signal['confidence'], string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const RANK: Record<Signal['confidence'], number> = { high: 0, medium: 1, low: 2 };
const PILL: Record<Signal['implication'], string> = { OPPORTUNITY: 'Opportunity', RISK: 'Risk', NEUTRAL: 'Watch' };

function SignalCard({ s }: { s: Signal }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li className="fh-card" data-confidence={s.confidence}>
      <button type="button" className="wd-row-btn" aria-expanded={open} aria-controls={`${id}-d`} onClick={() => setOpen((v) => !v)}>
        <span className="wd-row-main">
          <span className="wd-row-title">{noDash(s.title)}</span>
          <span className="wd-row-meta">
            {CONF[s.confidence]} · period to {periodFmt.format(new Date(`${s.periodEnd}T00:00:00Z`))}
            {s.sample ? <span className="wd-sample-badge">Sample</span> : null}
          </span>
        </span>
        <span className="wd-pill" data-kind={s.implication}>{PILL[s.implication]}</span>
        <ChevronDown className="wd-chev" size={16} strokeWidth={1.5} aria-hidden />
      </button>
      <div id={`${id}-d`} className="wd-detail" data-open={open} hidden={!open}>
        <p>{noDash(s.explanation)}</p>
        {s.snippet ? <blockquote className="fh-quote">{s.snippet}</blockquote> : null}
        {s.sourceUrl ? (
          <a className="wd-link" href={s.sourceUrl} target="_blank" rel="noreferrer">
            Open filing <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}

function TrackToggle({ data, companyId }: { data: AccountFinancials; companyId: string }) {
  const m = useTrackFinancials(companyId);
  if (!data.canToggle || data.gate === 'tier' || data.gate === 'top_rank') return null;
  const on = data.trackFinancials;
  return (
    <label className="fh-toggle">
      <input type="checkbox" role="switch" checked={on} disabled={m.isPending} onChange={(e) => m.mutate(e.target.checked)} aria-describedby={`fh-gate-${companyId}`} />
      <span>Track financials</span>
      {m.isError ? <span className="wd-row-meta" role="alert"> Couldn&apos;t save. Try again.</span> : null}
    </label>
  );
}

export function FinancialHealthSection({ companyId }: { companyId: string }) {
  const q = useAccountFinancials(companyId);
  const d = q.data;
  const general = d?.gate === 'general';
  const tiles = d ? buildTiles(d.periods) : [];
  const latest = d && !d.sample ? d.periods.reduce<string | null>((m, p) => (!m || p.periodEnd > m ? p.periodEnd : m), null) : null;
  const latestFy = latest && d ? d.periods.find((p) => p.periodEnd === latest)?.fiscalYear : null;
  // Measured against the last pull (not the clock) so render stays pure.
  const stale = latest && d?.lastPulledAt ? new Date(d.lastPulledAt).getTime() - new Date(`${latest}T00:00:00Z`).getTime() > STALE_MS : false;
  const signals = d ? d.signals.slice().sort((a, b) => RANK[a.confidence] - RANK[b.confidence]).slice(0, 3) : [];
  return (
    <div className="wd fh" data-testid="financial-health">
      <section className="wd-surface" aria-labelledby="fh-h">
        <header className="wd-head">
          <h2 id="fh-h" className="wd-h">
            Financial health {d?.sample ? <span className="wd-sample-badge">Sample</span> : null}
          </h2>
          {d ? (
            <span className="wd-row-meta">
              {d.tierLabel} account
              {d.entity ? ` · ${d.entity.source}` : ''}
              {d.lastPulledAt && !d.sample ? ` · pulled ${dateFmt.format(new Date(d.lastPulledAt))}` : ''}
            </span>
          ) : null}
        </header>
        {q.isLoading ? (
          <div aria-busy="true"><div className="wd-skel" /><div className="wd-skel" /></div>
        ) : q.isError ? (
          <p className="wd-empty" role="alert">
            <span>Couldn&apos;t load financials</span>
            <button type="button" className="wd-more" onClick={() => void q.refetch()}>Retry</button>
          </p>
        ) : d ? (
          <>
            {general && !d.periods.length ? (
              <div className="fh-empty" data-testid="fh-empty">
                <p id={`fh-gate-${companyId}`}>{d.gateCopy}</p>
                <TrackToggle data={d} companyId={companyId} />
              </div>
            ) : (
              <>
                {d.sample ? <p className="wd-row-meta">Example layout. {d.statusCopy ?? 'Real filed numbers replace it after the next pull.'}</p> : null}
                {!d.sample && d.periodsCapped ? <p className="wd-row-meta">Latest 20 fiscal years.</p> : null}
                {!d.sample && d.statusCopy ? <p className="wd-row-meta" role="status">{d.statusCopy}</p> : null}
                {stale ? (
                  <p className="wd-row-meta fh-stale" data-testid="fh-stale">
                    Latest filed period is FY{latestFy}. No newer statements at this source, so read the trend as history.
                  </p>
                ) : null}
                <div className="fh-tiles">
                  {tiles.map((t) => <MetricTile key={t.key} t={t} sample={d.sample} />)}
                </div>
                {signals.length ? (
                  <>
                    <h3 className="wd-sub-h">Early warnings</h3>
                    <ul className="wd-list fh-cards">{signals.map((s) => <SignalCard key={s.id} s={s} />)}</ul>
                  </>
                ) : (
                  <p className="wd-row-meta">No early warnings in the filed numbers.</p>
                )}
                <footer className="fh-foot">
                  <span id={`fh-gate-${companyId}`} className="wd-row-meta">{d.gateCopy}</span>
                  <TrackToggle data={d} companyId={companyId} />
                </footer>
              </>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
