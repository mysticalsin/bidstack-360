// v24 key numbers: the first thing on the account page. Big numbers, small
// arrows and sparklines, colour only for direction. Every number names its
// source and period on hover or focus; no data shows the reason, never a guess.
import './positioning.css';

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { useId } from 'react';

import type { KeyNumber } from '@bidstack/shared';

import { useAccountKeyNumbers } from '@/hooks/useAccountPositioning';

import { directionOf, formatDelta, formatValue, sparkPoints, toneOf } from './positioning-format';

const ARROW = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

function Spark({ series, tone }: { series: number[]; tone: string | null }) {
  const pts = sparkPoints(series, 64, 20);
  if (!pts) return null;
  return (
    <svg className="kn-spark" data-tone={tone ?? 'flat'} width="64" height="20" viewBox="0 0 64 20" aria-hidden focusable="false">
      <polyline points={pts} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ n }: { n: KeyNumber }) {
  const tipId = useId();
  const dir = directionOf(n);
  const tone = toneOf(n);
  const delta = formatDelta(n);
  const Arrow = dir ? ARROW[dir] : null;
  const missing = n.value === null;
  return (
    <li className="kn-tile" data-missing={missing} data-testid={`kn-${n.id}`} tabIndex={0} aria-describedby={tipId}>
      <span className="kn-label">
        {n.label}
        {n.sample ? <span className="sg-sample">Sample</span> : null}
      </span>
      <span className="kn-value">{formatValue(n)}</span>
      <span className="kn-foot">
        {Arrow && delta ? (
          <span className="kn-delta" data-tone={tone}>
            <Arrow size={12} aria-hidden />
            {delta}
            <span className="sr-only">{dir === 'up' ? ' up' : dir === 'down' ? ' down' : ' flat'}</span>
          </span>
        ) : null}
        <Spark series={n.series} tone={tone} />
      </span>
      <span className="kn-sub">{missing ? n.missing : n.sub}</span>
      <span className="kn-tip" role="tooltip" id={tipId}>
        <b>Source:</b> {n.source}
        <br />
        <b>Period:</b> {n.period}
        {n.sourceUrl ? (
          <>
            <br />
            <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer">
              Open source
            </a>
          </>
        ) : null}
      </span>
    </li>
  );
}

export function KeyNumbersStrip({ companyId }: { companyId: string }) {
  const q = useAccountKeyNumbers(companyId);
  if (q.isLoading) return <div className="kn" aria-busy="true"><div className="sg-skel" style={{ minHeight: 196 }} /></div>;
  if (q.isError || !q.data) {
    return (
      <section className="kn sg-surface">
        <p className="sg-empty" role="alert">
          <span>Couldn&apos;t load the key numbers</span>
          <button type="button" className="sg-link" onClick={() => void q.refetch()}>Retry</button>
        </p>
      </section>
    );
  }
  const company = q.data.items.filter((i) => i.group === 'company');
  const health = q.data.items.filter((i) => i.group === 'health');
  return (
    <section className="kn" aria-labelledby="kn-h" data-testid="key-numbers">
      <h2 id="kn-h" className="sr-only">Key numbers</h2>
      <div className="kn-group">
        <p className="kn-eyebrow">Company</p>
        <ul className="kn-row" data-count={company.length}>
          {company.map((n) => <Tile key={n.id} n={n} />)}
        </ul>
      </div>
      <div className="kn-group">
        <p className="kn-eyebrow">Account health</p>
        <ul className="kn-row" data-count={health.length}>
          {health.map((n) => <Tile key={n.id} n={n} />)}
        </ul>
      </div>
    </section>
  );
}

export default KeyNumbersStrip;
