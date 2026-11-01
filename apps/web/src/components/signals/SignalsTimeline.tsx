// Signals timeline: one picture of our activity (meetings, deals, bids) above
// their events (funding, launches, initiatives, exec moves, earnings, M&A,
// risk, hiring spikes). Colour by family, filter chips, click a mark for the
// one-line summary and the source. Positions are percentages, so nothing is
// measured and nothing shifts. Under 640px it becomes a month-grouped list.
import './signals.css';

import { ExternalLink } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { scaleTime } from 'd3-scale';

import type { SignalCategory, TimelineItem } from '@bidstack/shared';

import { TransitionPanel } from '@/components/motion-primitives/transition-panel';
import { useAccountTimeline } from '@/hooks/useAccountSignals';

import { CATEGORY_LABEL, CATEGORY_TONE, noDash, OUR_FILTERS, sourceLabel, THEIR_FILTERS } from './category';

const MOBILE_TOP = 8;
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short' });
const monthYearFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

function useNarrow(query = '(max-width: 640px)') {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mql = window.matchMedia?.(query);
    if (!mql) return;
    const on = () => setNarrow(mql.matches);
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return Boolean(narrow);
}

/** Stack marks that would overlap (closer than 1.6% of the axis) into rows 0..2. */
function layout(items: TimelineItem[], x: (d: Date) => number) {
  const out: Array<{ item: TimelineItem; left: number; row: number }> = [];
  const lastLeft: number[] = [-100, -100, -100];
  for (const item of [...items].sort((a, b) => a.at.localeCompare(b.at))) {
    const left = Math.max(0, Math.min(100, x(new Date(item.at))));
    let row = lastLeft.findIndex((l) => left - l >= 1.6);
    if (row === -1) row = lastLeft.indexOf(Math.min(...lastLeft));
    lastLeft[row] = left;
    out.push({ item, left, row: row === 0 ? 0 : row === 1 ? 1 : -1 });
  }
  return out;
}

function Detail({ item }: { item: TimelineItem }) {
  const tone = CATEGORY_TONE[item.category];
  return (
    <div>
      <span className="sg-tag" data-tone={tone}>
        <i className="sg-dot-key" aria-hidden />
        {CATEGORY_LABEL[item.category]} · <time dateTime={item.at}>{dateFmt.format(new Date(item.at))}</time>
        {item.upcoming ? ' · Upcoming' : ''}
        {item.sample ? <span className="sg-sample">Sample</span> : null}
      </span>
      <h3>{noDash(item.title)}</h3>
      {item.summary ? <p>{noDash(item.summary)}</p> : null}
      <p className="sg-meta">
        {item.sample ? 'Sample data, no live source' : sourceLabel(item.source)}
        {item.href ? (
          <>
            {' · '}
            <Link className="sg-link" to={item.href}>Open in Polo</Link>
          </>
        ) : null}
        {item.sourceUrl && /^https?:\/\//.test(item.sourceUrl) ? (
          <>
            {' · '}
            <a className="sg-link" href={item.sourceUrl} target="_blank" rel="noreferrer">
              Open source <ExternalLink size={13} strokeWidth={1.5} aria-hidden />
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}

export function TimelineView({ items, from, to }: { items: TimelineItem[]; from: string; to: string }) {
  const narrow = useNarrow();
  const id = useId();
  const present = useMemo(() => {
    const c = new Map<SignalCategory, number>();
    for (const i of items) c.set(i.category, (c.get(i.category) ?? 0) + 1);
    return c;
  }, [items]);
  const [off, setOff] = useState<Set<SignalCategory>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [listAll, setListAll] = useState(false);
  const [hover, setHover] = useState<{ id: string; left: number; lane: string } | null>(null);
  const visible = items.filter((i) => !off.has(i.category));
  const chips = [...OUR_FILTERS, ...THEIR_FILTERS].filter((c) => present.has(c));
  const start = new Date(from);
  // Upcoming events (results dates) extend the axis, but at most 120 days.
  const horizon = new Date(to).getTime() + 120 * 86_400_000;
  const latest = items.reduce((m, i) => Math.max(m, Math.min(horizon, new Date(i.at).getTime())), new Date(to).getTime());
  const end = new Date(latest);
  const x = scaleTime().domain([start, end]).range([0, 100]);
  const ticks = x.ticks(narrow ? 4 : 8);
  const todayLeft = x(new Date());
  const sel = items.find((i) => i.id === selected) ?? null;
  const onAxis = visible.filter((i) => new Date(i.at) <= end);
  const ours = layout(onAxis.filter((i) => i.lane === 'ours'), x);
  const theirs = layout(onAxis.filter((i) => i.lane === 'theirs'), x);
  const counts = { ours: items.filter((i) => i.lane === 'ours').length, theirs: items.filter((i) => i.lane === 'theirs').length };
  const toggle = (c: SignalCategory) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  const hovered = hover ? items.find((i) => i.id === hover.id) : null;

  if (!items.length) {
    return (
      <p className="sg-empty">
        <span>Nothing on the timeline yet</span>
        Meetings, deals and their news appear here as they happen.
      </p>
    );
  }

  const summary = `${counts.ours} of our activities and ${counts.theirs} of their events between ${monthYearFmt.format(start)} and ${monthYearFmt.format(end)}. ${[...present.entries()].map(([c, n]) => `${n} ${CATEGORY_LABEL[c].toLowerCase()}`).join(', ')}.`;

  return (
    <>
      <div className="sg-filters" role="group" aria-label="Filter the timeline">
        {chips.map((c) => (
          <button key={c} type="button" className="sg-chip" data-tone={CATEGORY_TONE[c]} data-cat={c} aria-pressed={!off.has(c)} onClick={() => toggle(c)}>
            <i className="sg-dot-key" aria-hidden />
            {CATEGORY_LABEL[c]} <b>{present.get(c)}</b>
          </button>
        ))}
      </div>
      <p className="sr-only">{summary}</p>
      {narrow ? (
        <>
        <ol id={`${id}-list`} className="sg-tl-list" aria-label="Timeline, newest first">
          {groupByMonth(listAll ? visible : [...visible].sort((a, b) => b.at.localeCompare(a.at)).slice(0, MOBILE_TOP)).map(([month, rows]) => (
            <li key={month}>
              <h3 className="sg-tl-month">{month}</h3>
              <ul className="sg-tl-list">
                {rows.map((i) => (
                  <li key={i.id} className="sg-tl-row" data-tone={CATEGORY_TONE[i.category]} data-cat={i.category}>
                    <i className="sg-dot-key" aria-hidden />
                    <div>
                      <button type="button" className="sg-link" style={{ minHeight: 0, textAlign: 'left', color: 'var(--sg-ink)' }} aria-expanded={selected === i.id} onClick={() => setSelected((s) => (s === i.id ? null : i.id))}>
                        {noDash(i.title)}
                      </button>
                      <div className="sg-meta">
                        {CATEGORY_LABEL[i.category]} · {dateFmt.format(new Date(i.at))}
                        {i.sample ? ' · Sample' : ''}
                      </div>
                      {selected === i.id ? <div className="sg-detail" style={{ minHeight: 0 }}><Detail item={i} /></div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {visible.length > MOBILE_TOP ? (
          <button type="button" className="sg-link" aria-expanded={listAll} aria-controls={`${id}-list`} onClick={() => setListAll((v) => !v)}>
            {listAll ? 'Show fewer' : `Show all ${visible.length} events`}
          </button>
        ) : null}
        </>
      ) : (
        <div className="sg-tl">
          {(
            [
              ['ours', 'Our activity', ours],
              ['theirs', 'Their news', theirs],
            ] as const
          ).map(([lane, label, marks]) => (
            <div key={lane} className="sg-lane">
              <span className="sg-lane-label" id={`${id}-${lane}`}>{label}</span>
              <div className="sg-lane-track" role="group" aria-labelledby={`${id}-${lane}`}>
                {marks.map(({ item, left, row }, n) => (
                  <button
                    key={item.id}
                    type="button"
                    className="sg-mark sg-mark-in"
                    data-tone={CATEGORY_TONE[item.category]}
                    data-cat={item.category}
                    data-big={item.importance >= 70}
                    data-upcoming={item.upcoming}
                    aria-pressed={selected === item.id}
                    aria-controls={`${id}-detail`}
                    aria-label={`${CATEGORY_LABEL[item.category]}, ${dateFmt.format(new Date(item.at))}: ${noDash(item.title)}`}
                    style={{ left: `${left}%`, '--row': row, '--i': Math.min(n, 30) } as React.CSSProperties}
                    onClick={() => setSelected((s) => (s === item.id ? null : item.id))}
                    onMouseEnter={() => setHover({ id: item.id, left, lane })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ id: item.id, left, lane })}
                    onBlur={() => setHover(null)}
                  >
                    <i aria-hidden />
                  </button>
                ))}
                {hovered && hover?.lane === lane ? (
                  <span className="sg-tip" role="presentation" aria-hidden style={{ left: `${Math.min(88, Math.max(12, hover.left))}%`, top: '50%' }}>
                    {noDash(hovered.title)}
                    <br />
                    <span style={{ opacity: 0.75 }}>{CATEGORY_LABEL[hovered.category]} · {dateFmt.format(new Date(hovered.at))}</span>
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          {todayLeft > 0 && todayLeft < 100 ? (
            <span className="sg-today" aria-hidden style={{ left: `calc(112px + (100% - 112px) * ${todayLeft / 100})` }} />
          ) : null}
          <div className="sg-axis" aria-hidden>
            {ticks.map((t) => (
              <span key={t.toISOString()} style={{ left: `${x(t)}%` }}>
                {t.getMonth() === 0 ? t.getFullYear() : monthFmt.format(t)}
              </span>
            ))}
          </div>
        </div>
      )}
      {!narrow ? (
        <div id={`${id}-detail`} className="sg-detail" aria-live="polite">
          {sel ? (
            <TransitionPanel activeIndex={0} key={sel.id}>
              {[<Detail key={sel.id} item={sel} />]}
            </TransitionPanel>
          ) : (
            <p className="sg-hint">Select a mark to see what happened and where it came from. Larger marks are more important; hollow ones are coming up.</p>
          )}
        </div>
      ) : null}
    </>
  );
}

function groupByMonth(items: TimelineItem[]): Array<[string, TimelineItem[]]> {
  const map = new Map<string, TimelineItem[]>();
  for (const i of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = monthYearFmt.format(new Date(i.at));
    const arr = map.get(k) ?? [];
    arr.push(i);
    map.set(k, arr);
  }
  return [...map.entries()];
}

export function SignalsTimeline({ companyId }: { companyId: string }) {
  const q = useAccountTimeline(companyId);
  const sample = q.data?.items.some((i) => i.sample);
  return (
    <section id="signals-timeline" className="sg sg-surface" style={{ marginBottom: 24, scrollMarginTop: 80 }} aria-labelledby="sg-tl-h" data-testid="signals-timeline">
      <header className="sg-head">
        <h2 id="sg-tl-h" className="sg-h">Signals timeline</h2>
        <span className="sg-meta">
          Our activity and their news, last 12 months {sample ? <span className="sg-sample">Sample</span> : null}
        </span>
      </header>
      {q.isLoading ? (
        <div className="sg-skel" aria-busy="true" style={{ minHeight: 232 }} />
      ) : q.isError || !q.data ? (
        <p className="sg-empty" role="alert">
          <span>Couldn&apos;t load the timeline</span>
          <button type="button" className="sg-link" onClick={() => void q.refetch()}>Retry</button>
        </p>
      ) : (
        <TimelineView items={q.data.items} from={q.data.from} to={q.data.to} />
      )}
    </section>
  );
}

export default SignalsTimeline;
