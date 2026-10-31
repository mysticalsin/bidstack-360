// Account page, top: revenue, headcount (with its 12-month trend), industry,
// locations. Every value carries its source and date underneath.
import './enrichment.css';

import { useState } from 'react';

import { Spark } from '@/components/viz/charts';
import { useCompanyEnrichment } from '@/hooks/useCompanyEnrichment';
import { trendPct } from '@/lib/enrichment/aggregate';
import { fmtMoney } from '@/lib/enrichment/client';

import { SampleBadge, SourceNote } from './SourceNote';

const NA = <span className="en-fact-sm" style={{ color: 'var(--fg-tertiary)' }}>Not known</span>;

export function FirmographicsStrip({ companyId }: { companyId: string }) {
  const q = useCompanyEnrichment(companyId);
  const [allLocations, setAllLocations] = useState(false);
  if (!q.data) return null;
  const f = q.data.firmographics;
  const hc = f.headcount;
  const pct = hc ? trendPct(hc.value.trend) : null;
  const locs = f.locations?.value ?? [];
  const hq = locs.find((l) => l.hq);
  const others = locs.filter((l) => !l.hq);
  return (
    <section className="en-section" aria-labelledby="en-firmo-h" data-testid="account-firmographics" style={{ padding: '16px 24px' }}>
      <div className="en-head">
        <h2 id="en-firmo-h" className="sr-only">Company facts</h2>
        <dl className="en-strip" style={{ flex: '1 1 100%' }}>
          <div>
            <dt>Revenue</dt>
            <dd>
              {f.revenue ? (
                <>
                  <span className="en-fact">{fmtMoney(f.revenue.value.amount, f.revenue.value.currency)}</span>
                  <SourceNote source={`${f.revenue.source}, ${f.revenue.value.fiscalYear}`} asOf={f.revenue.asOf} />
                </>
              ) : NA}
            </dd>
          </div>
          <div>
            <dt>Headcount</dt>
            <dd>
              {hc ? (
                <>
                  <span className="en-fact">
                    {hc.value.current.toLocaleString('en-GB')}
                    <Spark values={hc.value.trend.map((p) => p.value)} label={`Headcount over the last ${hc.value.trend.length} months, ${pct === null ? 'no change data' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%`}`} width={64} height={20} />
                    {pct !== null ? <span className="en-delta" data-down={pct < 0}>{pct > 0 ? '+' : ''}{pct}% in 12 mo</span> : null}
                  </span>
                  <SourceNote source={hc.source} asOf={hc.asOf} />
                </>
              ) : NA}
            </dd>
          </div>
          <div>
            <dt>Industry</dt>
            <dd>
              {f.industry ? (
                <>
                  <span className="en-fact-sm">{f.industry.value}</span>
                  <SourceNote source={f.industry.source} asOf={f.industry.asOf} />
                </>
              ) : NA}
            </dd>
          </div>
          <div>
            <dt>Locations</dt>
            <dd>
              {f.locations && locs.length ? (
                <>
                  <span className="en-fact-sm">
                    {hq ? `${hq.city} (HQ)` : `${locs[0]!.city}`}
                    {others.length && !allLocations ? (
                      <button type="button" className="en-link" style={{ minHeight: 24, padding: '0 4px' }} aria-expanded={false} onClick={() => setAllLocations(true)}>
                        +{hq ? others.length : locs.length - 1} more
                      </button>
                    ) : null}
                  </span>
                  {allLocations ? (
                    <span className="en-fact-sm" style={{ fontWeight: 400 }}>{(hq ? others : locs.slice(1)).map((l) => `${l.city}, ${l.country}`).join(' · ')}</span>
                  ) : null}
                  <SourceNote source={f.locations.source} asOf={f.locations.asOf} />
                </>
              ) : NA}
            </dd>
          </div>
        </dl>
      </div>
      {q.data.sample ? (
        <p className="en-src" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SampleBadge show /> Illustrative firmographics until company enrichment is connected.
        </p>
      ) : null}
    </section>
  );
}
