// v24 "What to position": a plain-English account brief, the three best plays
// (offering, why now with evidence, who to approach, first step) and the gaps
// and risks to close. Built only from data Polo holds; details open on click.
import './positioning.css';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';

import { composeBrief, type AccountGap, type EvidenceChip, type PositioningPlay } from '@bidstack/shared';

import { fmtMoney } from '@/components/financials/financials-format';
import { useAccountPositioning } from '@/hooks/useAccountPositioning';
import { formatMoneyMicros } from '@/lib/format';

const CONF_LABEL: Record<PositioningPlay['confidence'], string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const CONF_BARS: Record<PositioningPlay['confidence'], number> = { high: 3, medium: 2, low: 1 };
const KIND_LABEL: Record<EvidenceChip['kind'], string> = {
  financial: 'Financials',
  hiring: 'Hiring',
  initiative: 'Initiative',
  news: 'News',
  funding: 'Funding',
  launch: 'Launch',
  filing: 'Filing',
  meeting: 'Meeting',
};
const SEN_LABEL: Record<string, string> = { c_level: 'C-level', vp: 'VP', director: 'Director', manager: 'Manager', ic: 'Individual contributor', unknown: 'Level unknown' };
const dateFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)) : null);
const micros = (m: string) => formatMoneyMicros(m, undefined, { compact: true });

function Chip({ e }: { e: EvidenceChip }) {
  const ext = Boolean(e.url);
  const when = fmtDate(e.at);
  return (
    <a
      className="wp-chip"
      data-kind={e.kind}
      href={ext ? e.url! : `#${e.anchor}`}
      {...(ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      title={`${e.source}${when ? `, ${when}` : ''}`}
    >
      <span className="wp-chip-kind">{KIND_LABEL[e.kind]}</span>
      <span className="wp-chip-text">{e.label}</span>
      {e.sample ? <span className="sg-sample">Sample</span> : null}
      {ext ? <ExternalLink size={12} aria-hidden /> : null}
      {ext ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </a>
  );
}

function Confidence({ level }: { level: PositioningPlay['confidence'] }) {
  return (
    <span className="sg-conf">
      <span className="sg-conf-bars" aria-hidden>
        {[1, 2, 3].map((n) => <i key={n} data-on={n <= CONF_BARS[level]} />)}
      </span>
      {CONF_LABEL[level]}
    </span>
  );
}

function Person({ p }: { p: PositioningPlay['approach'][number] }) {
  const when = fmtDate(p.lastMetAt);
  return (
    <span className="wp-person">
      <span className="wp-person-name">{p.name}</span>
      <span className="wp-person-meta">
        {[p.title, SEN_LABEL[p.seniority]].filter(Boolean).join(', ')}
        {' · '}
        <span data-met={p.met}>{p.met ? `Met${when ? ` ${when}` : ''}` : 'Not met yet'}</span>
      </span>
    </span>
  );
}

function PlayCard({ play }: { play: PositioningPlay }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const first = play.approach[0];
  return (
    <li className="wp-play" data-testid={`wp-play-${play.rank}`}>
      <div className="wp-play-top">
        <span className="wp-rank" aria-label={`Play ${play.rank}`}>{play.rank}</span>
        <div className="wp-play-head">
          <p className="wp-offering">
            {play.offering}
            {play.alreadySold ? <span className="wp-tag">Already a client here</span> : null}
            {play.sample ? <span className="sg-sample">Sample</span> : null}
          </p>
          <h3 className="wp-headline">{play.headline}</h3>
        </div>
        <Confidence level={play.confidence} />
      </div>
      <div className="wp-why">
        <span className="wp-k">Why now</span>
        <div className="wp-chips">
          {play.whyNow.slice(0, open ? 5 : 2).map((e, i) => <Chip key={`${e.kind}-${i}`} e={e} />)}
        </div>
      </div>
      <div className="wp-grid">
        <div>
          <span className="wp-k">Who to approach</span>
          {first ? <Person p={first} /> : <span className="wp-gap-note">{play.approachGap}</span>}
        </div>
        <div>
          <span className="wp-k">First step</span>
          <p className="wp-step">{play.firstStep}</p>
        </div>
      </div>
      <button type="button" className="sg-link wp-more" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide details' : 'Talking points and details'}
        <ChevronDown size={14} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }} />
      </button>
      <div id={bodyId} hidden={!open} className="wp-detail">
        <span className="wp-k">Talking points</span>
        <ul className="wp-points">
          {play.talkingPoints.map((t) => <li key={t}>{t}</li>)}
        </ul>
        {play.approach.length > 1 ? (
          <>
            <span className="wp-k">Also</span>
            <Person p={play.approach[1]!} />
          </>
        ) : null}
        {first && play.approachGap ? <p className="wp-gap-note">{play.approachGap}</p> : null}
        {play.dealRange ? (
          <p className="wp-range">
            <span className="wp-k">Expected deal size</span>
            {micros(play.dealRange.lowMicros)} to {micros(play.dealRange.highMicros)}
            <span className="wp-range-basis">{play.dealRange.basis}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Gap({ g }: { g: AccountGap }) {
  return (
    <li className="wp-risk" data-sev={g.severity}>
      <details>
        <summary>
          <i aria-hidden className="wp-sev" />
          <span className="sr-only">{g.severity} severity: </span>
          {g.title}
          <ChevronDown size={14} aria-hidden className="wp-risk-chev" />
        </summary>
        <p>{g.detail}</p>
        {g.evidence.length ? (
          <div className="wp-chips">
            {g.evidence.map((e, i) => <Chip key={i} e={e} />)}
          </div>
        ) : null}
      </details>
    </li>
  );
}

export function WhatToPosition({ companyId }: { companyId: string }) {
  const q = useAccountPositioning(companyId);
  if (q.isLoading) return <div className="sg wp" aria-busy="true"><div className="sg-skel" style={{ minHeight: 320 }} /></div>;
  if (q.isError || !q.data) {
    return (
      <section className="sg sg-surface wp">
        <p className="sg-empty" role="alert">
          <span>Couldn&apos;t load what to position</span>
          <button type="button" className="sg-link" onClick={() => void q.refetch()}>Retry</button>
        </p>
      </section>
    );
  }
  const d = q.data;
  const brief = composeBrief(d.brief, fmtMoney, micros);
  return (
    <section id="what-to-position" className="sg sg-surface wp" aria-labelledby="wp-h" data-testid="what-to-position">
      <div className="sg-head">
        <h2 id="wp-h" className="sg-h">What to position</h2>
        <span className="sg-meta">From signals, filings, people and pipeline in Polo</span>
      </div>
      <p className="wp-brief" data-testid="account-brief">{brief}</p>
      {d.plays.length ? (
        <ol className="wp-plays">
          {d.plays.map((p) => <PlayCard key={p.theme} play={p} />)}
        </ol>
      ) : (
        <p className="sg-empty">
          <span>No play to recommend yet</span>
          Polo needs a signal first: hiring, news, a filing or a meeting note on this account.
        </p>
      )}
      {d.gaps.length ? (
        <div className="wp-risks" data-testid="gaps-risks">
          <h3 className="wp-sub">Gaps and risks</h3>
          <ul>
            {d.gaps.map((g) => <Gap key={g.kind} g={g} />)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default WhatToPosition;
