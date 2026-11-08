// v24 key numbers: the first thing on the account page. Big numbers, small
// arrows and sparklines, colour only for direction. Every number names its
// source and period on hover or focus; no data shows the reason, never a guess.
// Slice 22: company figures also carry a visible source chip and an Edit, and
// a missing one offers Refresh from public sources and Add manually.
import './positioning.css';

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { useId } from 'react';

import type { KeyNumber } from '@bidstack/shared';

import { FigureActions, SourceChip } from '@/components/figures/SourcedFigure';
import { useAccountKeyNumbers } from '@/hooks/useAccountPositioning';
import { useFormatMoney } from '@/hooks/useFormatMoney';

import { directionOf, formatDelta, formatValue, sparkPoints, toneOf, type MicrosFormatter } from './positioning-format';

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

interface TileCompany {
  id: string;
  name: string;
}

/** Placeholder text from older cached responses is treated as no text at all. */
const real = (text: string | null | undefined): string | null => {
  const t = text?.trim();
  return t && !/^(n\/a|none)$/i.test(t) ? t : null;
};

function Tile({ n, fmtMicros, company }: { n: KeyNumber; fmtMicros: MicrosFormatter; company: TileCompany }) {
  const tipId = useId();
  const dir = directionOf(n);
  const tone = toneOf(n);
  const delta = formatDelta(n);
  const Arrow = dir ? ARROW[dir] : null;
  const missing = n.value === null;
  const tipSource = real(n.source);
  const tipPeriod = real(n.period);
  const hasTip = Boolean(tipSource || tipPeriod);
  return (
    <li className="kn-tile" data-missing={missing} data-testid={`kn-${n.id}`} tabIndex={0} aria-describedby={hasTip ? tipId : undefined}>
      <span className="kn-label">
        {n.label}
        {n.sample ? <span className="sg-sample">Sample</span> : null}
      </span>
      <span className="kn-value" title={missing ? undefined : formatValue(n, fmtMicros)}>
        {missing && n.editKey ? 'Not found yet' : formatValue(n, fmtMicros)}
      </span>
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
      {n.editKey ? (
        missing ? (
          <FigureActions companyId={company.id} companyName={company.name} fieldKey={n.editKey} label={n.label} missing={n.missing ?? `No ${n.label.toLowerCase()} on record`} />
        ) : (
          <span className="sf-line kn-prov">
            {n.provenance ? <SourceChip p={n.provenance} testId={`kn-chip-${n.id}`} /> : null}
            <FigureActions companyId={company.id} companyName={company.name} fieldKey={n.editKey} label={n.label} />
          </span>
        )
      ) : null}
      {n.editKey && missing ? null : <span className="kn-sub">{missing ? n.missing : n.sub}</span>}
      {hasTip ? (
        <span className="kn-tip" role="tooltip" id={tipId}>
          {tipSource ? (
            <span className="kn-tip-line">
              <b>Source:</b> {tipSource}
            </span>
          ) : null}
          {tipPeriod ? (
            <span className="kn-tip-line">
              <b>Period:</b> {tipPeriod}
            </span>
          ) : null}
          {n.sourceUrl ? (
            <span className="kn-tip-line">
              <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer">
                Open source
              </a>
            </span>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

export function KeyNumbersStrip({ companyId }: { companyId: string }) {
  const money = useFormatMoney();
  // Pipeline micros are EUR at rest; show them in the user's display currency like the rest of the page.
  const fmtMicros: MicrosFormatter = (m) => money.formatMoneyMicros(m, 'EUR', { compact: true });
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
  const tileCompany: TileCompany = { id: q.data.companyId, name: q.data.companyName ?? '' };
  const company = q.data.items.filter((i) => i.group === 'company');
  const health = q.data.items.filter((i) => i.group === 'health');
  return (
    <section className="kn" aria-labelledby="kn-h" data-testid="key-numbers">
      <h2 id="kn-h" className="sr-only">Key numbers</h2>
      <div className="kn-group">
        <p className="kn-eyebrow">Company</p>
        <ul className="kn-row" data-count={company.length}>
          {company.map((n) => <Tile key={n.id} n={n} fmtMicros={fmtMicros} company={tileCompany} />)}
        </ul>
      </div>
      <div className="kn-group">
        <p className="kn-eyebrow">Account health</p>
        <ul className="kn-row" data-count={health.length}>
          {health.map((n) => <Tile key={n.id} n={n} fmtMicros={fmtMicros} company={tileCompany} />)}
        </ul>
      </div>
    </section>
  );
}

export default KeyNumbersStrip;
