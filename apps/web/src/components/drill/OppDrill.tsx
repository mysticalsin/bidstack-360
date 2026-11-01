// Bid drill-down: one sheet behind the hero numbers, the pipeline funnel, the
// status counts and the performance views. Filters are local state, so the
// trail (All bids › Open › S4 negotiation) is always one click from the top.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { DrillSheet, type DrillCrumb } from './DrillSheet';
import { filterOpps, type OppDrillFilter } from './filterOpps';
import { headlineMicrosLabel, recordedMicros } from '@/components/dashboard/unspecified-currency';
import { closeDate, OPEN_STAGES, stageBuckets, stageKey, stageText, type OppRow, type OppStatus } from '@/components/viz/viz-data';

export type { OppDrillFilter } from './filterOpps';

const STATUS_LABEL: Record<OppStatus | 'all', string> = { all: 'All bids', open: 'Open', won: 'Won', lost: 'Lost' };
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/** The sheet lists the largest bids. The caption still counts every match. */
const DRILL_BID_LIST = 100;

function byRecordedValue(a: OppRow, b: OppRow): number {
  const av = recordedMicros(a.value ?? 0, a.valueMicros);
  const bv = recordedMicros(b.value ?? 0, b.valueMicros);
  if (av === bv) return (a.name ?? a.id).localeCompare(b.name ?? b.id);
  return av > bv ? -1 : 1;
}

export function OppDrill({ rows, filter, onFilterChange, onClose, rootLabel = 'Dashboard' }: {
  rows: OppRow[];
  filter: OppDrillFilter | null;
  onFilterChange: (f: OppDrillFilter) => void;
  onClose: () => void;
  rootLabel?: string;
}) {
  const [q, setQ] = useState('');
  const f = useMemo<OppDrillFilter>(() => filter ?? {}, [filter]);
  const status = f.status ?? 'all';
  const shown = useMemo(() => filterOpps(rows, f, q).sort(byRecordedValue), [rows, f, q]);
  const totalMicros = shown.reduce((n, o) => n + recordedMicros(o.value ?? 0, o.valueMicros), 0n);
  const weightedMicros = shown.reduce(
    (n, o) => n + (recordedMicros(o.value ?? 0, o.valueMicros) * BigInt(Math.trunc(o.probability ?? 0))) / 100n,
    0n,
  );
  const totalLabel = headlineMicrosLabel(totalMicros, 'en-GB');
  const weightedLabel = headlineMicrosLabel(weightedMicros, 'en-GB');

  // Stage breakdown when no stage is chosen yet: the next level down.
  const byStage = useMemo(() => {
    if (f.stage) return [];
    return stageBuckets(filterOpps(rows, { ...f, stage: null }, q));
  }, [rows, f, q]);
  const stageChoices = useMemo(() => {
    const fixed = new Set<string>([...OPEN_STAGES, 'closed_won', 'closed_lost']);
    const extra = stageBuckets(rows).filter((stage) => !fixed.has(stage.id));
    return [
      ...[...OPEN_STAGES, 'closed_won', 'closed_lost'].map((id) => ({ id, label: stageText(id) })),
      ...extra.map((stage) => ({ id: stage.id, label: stage.label })),
    ];
  }, [rows]);
  const maxStageMicros = byStage.reduce((max, stage) => {
    const value = BigInt(stage.micros);
    return value > max ? value : max;
  }, 1n);

  const title = f.account ?? (f.stage ? stageText(f.stage) : f.thisYear ? 'Won this year' : STATUS_LABEL[status]);
  const trail: DrillCrumb[] = [
    { label: rootLabel, onSelect: onClose },
    { label: STATUS_LABEL[status], onSelect: f.stage || f.account ? () => onFilterChange({ status, thisYear: f.thisYear }) : undefined },
    ...(f.stage ? [{ label: stageText(f.stage) }] : []),
    ...(f.account ? [{ label: f.account }] : []),
  ];

  return (
    <DrillSheet
      open={filter !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      testId="opp-drill"
      title={title}
      caption={`${shown.length} bid${shown.length === 1 ? '' : 's'} worth ${totalLabel}. Pick a stage or a bid to go deeper.`}
      trail={trail}
      stats={[
        { label: 'Bids', value: shown.length },
        { label: 'Total value', value: totalLabel },
        ...(status === 'open' || status === 'all' ? [{ label: 'Weighted', value: weightedLabel }] : []),
      ]}
      filters={
        <>
          <input type="search" aria-label="Search bids" placeholder="Search bid or account" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="drill-seg" role="group" aria-label="Status">
            {(['all', 'open', 'won', 'lost'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => onFilterChange({ ...f, status: s })}>
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <select aria-label="Stage" value={f.stage ?? ''} onChange={(e) => onFilterChange({ ...f, stage: e.target.value || null })}>
            <option value="">Any stage</option>
            {stageChoices.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </>
      }
      footer={<Link to="/opportunities" className="btn btn-secondary">Open all in Opportunities</Link>}
    >
      {byStage.length > 1 ? (
        <section aria-labelledby="drill-stage-t">
          <h3 id="drill-stage-t" className="drill-section-title">By stage</h3>
          <table className="drill-table">
            <thead><tr><th scope="col">Stage</th><th scope="col" className="num">Bids</th><th scope="col" className="num">Value</th></tr></thead>
            <tbody>
              {byStage.map((s) => (
                <tr key={s.id}>
                  <td>
                    <button type="button" className="drill-link" onClick={() => onFilterChange({ ...f, stage: s.id })}>{s.label}</button>
                    <span className="drill-bar" style={{ width: `${Math.max(4, Number((BigInt(s.micros) * 10_000n) / maxStageMicros) / 100)}%` }} aria-hidden />
                  </td>
                  <td className="num">{s.count}</td>
                  <td className="num">{s.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      <section aria-labelledby="drill-recs-t">
        <h3 id="drill-recs-t" className="drill-section-title">Bids</h3>
        {shown.length > DRILL_BID_LIST ? (
          <p className="drill-caption">Showing the largest {DRILL_BID_LIST} of {shown.length}.</p>
        ) : null}
        {shown.length === 0 ? <p className="drill-empty">No bids match these filters.</p> : (
          <table className="drill-table">
            <thead>
              <tr><th scope="col">Bid</th><th scope="col">Stage</th><th scope="col" className="num">Value</th><th scope="col" className="num">Due</th></tr>
            </thead>
            <tbody>
              {shown.slice(0, DRILL_BID_LIST).map((o) => {
                const d = closeDate(o);
                return (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/opportunities/${o.id}`}>{o.name ?? o.code ?? 'Untitled bid'}</Link>
                      {o.customer ? (
                        <button type="button" className="drill-sub drill-link" onClick={() => onFilterChange({ ...f, account: o.customer })}>{o.customer}</button>
                      ) : null}
                    </td>
                    <td>{stageText(stageKey(o.stage))}</td>
                    <td className="num">{headlineMicrosLabel(recordedMicros(o.value ?? 0, o.valueMicros), 'en-GB')}</td>
                    <td className="num">{d ? dateFmt.format(new Date(d)) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </DrillSheet>
  );
}
