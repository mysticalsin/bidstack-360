// "What they're likely doing": initiatives inferred from hiring (the existing
// posting reverse-engineering), news and filings, and meeting notes. Each one
// shows confidence, evidence counts with links on click, and the hook to our
// offering. Most confident first; four by default, the rest on click.
import './signals.css';

import { ChevronDown, ExternalLink } from 'lucide-react';
import { useId, useState } from 'react';

import type { Initiative } from '@bidstack/shared';

import { useAccountInitiatives } from '@/hooks/useAccountSignals';

import { noDash, sourceLabel } from './category';

const TOP = 4;
const CONF_LABEL: Record<Initiative['confidence'], string> = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const CONF_BARS: Record<Initiative['confidence'], number> = { high: 3, medium: 2, low: 1 };
const EV_LABEL: Record<Initiative['evidence'][number]['kind'], [string, string]> = {
  hiring: ['job posting', 'job postings'],
  news: ['news item', 'news items'],
  filing: ['filing', 'filings'],
  funding: ['funding event', 'funding events'],
  launch: ['launch', 'launches'],
  meeting: ['meeting note', 'meeting notes'],
};
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function Confidence({ level }: { level: Initiative['confidence'] }) {
  return (
    <span className="sg-conf">
      <span className="sg-conf-bars" aria-hidden>
        {[1, 2, 3].map((n) => <i key={n} data-on={n <= CONF_BARS[level]} />)}
      </span>
      {CONF_LABEL[level]}
    </span>
  );
}

function InitiativeCard({ it, i }: { it: Initiative; i: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const byKind = new Map<string, number>();
  for (const e of it.evidence) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  return (
    <article className="sg-init sg-arrive" style={{ '--i': Math.min(i, 5) } as React.CSSProperties} aria-labelledby={`${id}-t`}>
      <div className="sg-init-top">
        <h3 id={`${id}-t`}>{noDash(it.title)}</h3>
        <Confidence level={it.confidence} />
      </div>
      <p>{noDash(it.rationale)}</p>
      <div className="sg-ev-sum">
        <span>{it.themeLabel}</span>
        {[...byKind.entries()].map(([k, n]) => {
          const [one, many] = EV_LABEL[k as keyof typeof EV_LABEL] ?? [k, k];
          return <span key={k}>{n} {n === 1 ? one : many}</span>;
        })}
        {it.lastSeen ? <span>Last seen {dateFmt.format(new Date(it.lastSeen))}</span> : null}
        {it.sample ? <span className="sg-sample">Sample</span> : null}
      </div>
      <div className="sg-hook">
        {it.hook.alreadySold ? (
          <span><b>Already working together here.</b> {it.hook.offering} is on this account; look for the next phase.</span>
        ) : (
          <span><b>How we can help: {it.hook.offering}.</b> {it.hook.nextStep}</span>
        )}
      </div>
      <button type="button" className="sg-link" aria-expanded={open} aria-controls={`${id}-ev`} onClick={() => setOpen((v) => !v)}>
        {open
          ? 'Hide evidence'
          : (it.evidenceHidden ?? 0) > 0
            ? `See ${it.evidence.length} of ${it.evidence.length + (it.evidenceHidden ?? 0)} evidence items`
            : `See ${it.evidence.length} evidence ${it.evidence.length === 1 ? 'item' : 'items'}`}
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 200ms cubic-bezier(0.22,1,0.36,1)' }} />
      </button>
      <ul id={`${id}-ev`} className="sg-ev" hidden={!open}>
        {it.evidence.map((e, n) => (
          <li key={`${e.kind}-${n}`}>
            {e.url && /^https?:\/\//.test(e.url) ? (
              <a href={e.url} target="_blank" rel="noreferrer">{noDash(e.title)} <ExternalLink size={12} strokeWidth={1.5} aria-hidden /></a>
            ) : (
              <span>{noDash(e.title)}</span>
            )}
            <span className="sg-meta"> · {e.sample ? 'Sample' : sourceLabel(e.source)}{e.at ? ` · ${dateFmt.format(new Date(e.at))}` : ''}</span>
          </li>
        ))}
        {(it.evidenceHidden ?? 0) > 0 ? (
          <li className="sg-meta">{it.evidenceHidden} older {it.evidenceHidden === 1 ? 'item is' : 'items are'} not listed.</li>
        ) : null}
      </ul>
    </article>
  );
}

export function InitiativesView({
  items,
  subsidiariesCapped,
  evidenceCapped,
}: {
  items: Initiative[];
  subsidiariesCapped?: boolean;
  evidenceCapped?: boolean;
}) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const note = (
    <>
      {subsidiariesCapped ? <p className="sg-meta">Latest 1,000 subsidiaries</p> : null}
      {evidenceCapped ? <p className="sg-meta">Latest 100 news and meetings</p> : null}
    </>
  );
  if (!items.length) {
    return (
      <>
        {note}
        <p className="sg-empty">
          <span>No initiatives spotted yet</span>
          They appear when hiring, news or meeting notes point to a project.
        </p>
      </>
    );
  }
  const shown = all ? items : items.slice(0, TOP);
  return (
    <>
      {note}
      <div id={listId} className="sg-init-grid">
        {shown.map((it, i) => <InitiativeCard key={it.id} it={it} i={i} />)}
      </div>
      {items.length > TOP ? (
        <button type="button" className="sg-link" aria-expanded={all} aria-controls={listId} onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${items.length} initiatives`}
        </button>
      ) : null}
    </>
  );
}

export function InitiativesBoard({ companyId }: { companyId: string }) {
  const q = useAccountInitiatives(companyId);
  return (
    <section id="initiatives" className="sg sg-surface" style={{ marginBottom: 24, scrollMarginTop: 80 }} aria-labelledby="sg-init-h" data-testid="initiatives-board">
      <header className="sg-head">
        <h2 id="sg-init-h" className="sg-h">What they&apos;re likely doing</h2>
        <span className="sg-meta">Inferred from hiring, news and meetings</span>
      </header>
      {q.isLoading ? (
        <div className="sg-skel" aria-busy="true" style={{ minHeight: 200 }} />
      ) : q.isError || !q.data ? (
        <p className="sg-empty" role="alert">
          <span>Couldn&apos;t load initiatives</span>
          <button type="button" className="sg-link" onClick={() => void q.refetch()}>Retry</button>
        </p>
      ) : (
        <InitiativesView items={q.data.items} subsidiariesCapped={q.data.subsidiariesCapped} evidenceCapped={q.data.evidenceCapped} />
      )}
    </section>
  );
}

export default InitiativesBoard;
