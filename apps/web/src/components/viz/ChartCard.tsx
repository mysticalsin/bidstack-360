// Shared frame for every visual: title, meta, an optional "Sample" badge,
// and a chart/table toggle so each chart has a text alternative.
import './viz.css';

import { useId, useState, type ReactNode } from 'react';

import { KIND_LABEL } from './viz-kinds';

export interface TableData {
  columns: string[];
  rows: Array<Array<string | number>>;
}

export function ChartCard({
  title, meta, sample, table, summary, children, className, testId, headingLevel = 2,
}: {
  title: string;
  meta?: ReactNode;
  /** Set when any series is illustrative, not from the API. */
  sample?: string | boolean;
  table?: TableData;
  /** One-sentence text alternative read by screen readers. */
  summary: string;
  children: ReactNode;
  className?: string;
  testId?: string;
  headingLevel?: 2 | 3;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={`viz${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-t`} data-testid={testId}>
      <header className="viz-head">
        <div style={{ minWidth: 0 }}>
          <H id={`${id}-t`} className="viz-title">{title}</H>
          {meta ? <div className="viz-meta">{meta}</div> : null}
        </div>
        <div className="viz-tools">
          {sample ? (
            <span className="viz-sample" title={typeof sample === 'string' ? sample : 'Illustrative data, not from your records'}>
              Sample
            </span>
          ) : null}
          {table ? (
            <button type="button" className="viz-toggle" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? 'Chart' : 'Table'}
            </button>
          ) : null}
        </div>
      </header>
      {asTable && table ? (
        <table className="viz-table">
          <caption className="sr-only">{summary}</caption>
          <thead><tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => (j === 0 ? <th key={j} scope="row" style={{ fontWeight: 400, color: 'var(--viz-ink)', borderBottom: '1px solid var(--viz-line)', padding: '8px 8px 8px 0', textAlign: 'left' }}>{c}</th> : <td key={j}>{c}</td>))}</tr>
            ))}
          </tbody>
        </table>
      ) : (
        <figure className="viz-figure" role="img" aria-label={summary}>
          {children}
        </figure>
      )}
    </section>
  );
}

/** Colour + shape per signal implication (never colour alone). */
export function SignalShape({ kind, x, y, r = 5, i = 0 }: { kind: string; x: number; y: number; r?: number; i?: number }) {
  const style = { '--i': i } as React.CSSProperties;
  if (kind === 'RISK') {
    const h = r * 1.9;
    return <path className="viz-pop" style={style} data-kind={kind} d={`M${x} ${y - h / 1.6} L${x + r} ${y + h / 2.6} L${x - r} ${y + h / 2.6} Z`} />;
  }
  if (kind === 'NEUTRAL') {
    // Rotate on the wrapper: the pop animation's CSS transform would otherwise
    // replace the rotate attribute and turn the diamond into a square.
    return (
      <g transform={`rotate(45 ${x} ${y})`}>
        <rect className="viz-pop" style={style} data-kind={kind} x={x - r * 0.8} y={y - r * 0.8} width={r * 1.6} height={r * 1.6} />
      </g>
    );
  }
  return <circle className="viz-pop" style={style} data-kind={kind} cx={x} cy={y} r={r} />;
}


export function SignalLegend() {
  return (
    <ul className="viz-legend" aria-hidden>
      {(['OPPORTUNITY', 'NEUTRAL', 'RISK'] as const).map((k) => (
        <li key={k}>
          <svg width="12" height="12" className="viz-svg" style={{ width: 12 }}><SignalShape kind={k} x={6} y={6} r={4} /></svg>
          {KIND_LABEL[k]}
        </li>
      ))}
    </ul>
  );
}

export function ChartTip({ active, payload, label, format }: {
  active?: boolean; payload?: Array<{ name?: string; value?: number | string; color?: string }>; label?: string | number;
  format?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="viz-tip">
      {label !== undefined ? <div style={{ marginBottom: 4 }}><b>{label}</b></div> : null}
      {payload.map((p, i) => (
        <div key={i}>{p.name}: {typeof p.value === 'number' && format ? format(p.value) : p.value}</div>
      ))}
    </div>
  );
}
