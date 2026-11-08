// Account page, top: revenue, headcount (with its 12-month trend), industry,
// locations. Every value carries its source and date underneath.
// Slice 22: a filed, sourced manual or Wikidata figure from the key numbers
// fills a gap or beats provider and sample data, with its source chip; a
// missing figure offers Refresh from public sources and Add manually.
import './enrichment.css';

import { useState } from 'react';

import { FigureActions, SourceChip } from '@/components/figures/SourcedFigure';
import { Spark } from '@/components/viz/charts';
import { useHasPermission } from '@/hooks/useCapabilities';
import { awaitingRefresh, useCompanyEnrichment, useRefreshEnrichment } from '@/hooks/useCompanyEnrichment';
import { beatsProvider, figureText, useSourcedFigures } from '@/hooks/useSourcedFigures';
import { trendPct } from '@/lib/enrichment/aggregate';
import { fmtAsOf, fmtMoney } from '@/lib/enrichment/client';

import { SampleBadge, SourceNote } from './SourceNote';

const NA = <span className="en-fact-sm" style={{ color: 'var(--fg-tertiary)' }}>Not known</span>;

export function FirmographicsStrip({ companyId }: { companyId: string }) {
  const refresh = useRefreshEnrichment(companyId);
  const q = useCompanyEnrichment(companyId, { pollUntil: refresh.pollUntil });
  const canRefresh = useHasPermission('companies:write');
  const [allLocations, setAllLocations] = useState(false);
  const sourced = useSourcedFigures(companyId);
  if (!q.data) return null;
  const d = q.data;
  const f = d.firmographics;
  const hc = f.headcount;
  const trend = hc?.value.trend ?? [];
  const pct = hc ? (hc.value.growth12m ?? (trend.length > 1 ? trendPct(trend) : null)) : null;
  // Judged at the last fetch time, which advances on every poll (keeps render pure).
  const polling = awaitingRefresh(d, refresh.pollUntil, q.dataUpdatedAt);
  const locs = f.locations?.value ?? [];
  const hq = locs.find((l) => l.hq);
  const others = locs.filter((l) => !l.hq);
  const useRevenue = Boolean(figureText(sourced.revenue)) && (!f.revenue || d.sample || beatsProvider(sourced.revenue));
  const useEmployees = Boolean(figureText(sourced.employees)) && (!hc || d.sample || beatsProvider(sourced.employees));
  const missingAction = (fieldKey: 'annualRevenueMicros' | 'employeeCount' | 'industry', label: string, text: string) =>
    sourced.companyName ? <FigureActions companyId={companyId} companyName={sourced.companyName} fieldKey={fieldKey} label={label} missing={text} /> : NA;
  return (
    <section className="en-section" aria-labelledby="en-firmo-h" data-testid="account-firmographics" style={{ padding: '16px 24px' }}>
      <div className="en-head">
        <h2 id="en-firmo-h" className="sr-only">Company facts</h2>
        <dl className="en-strip" style={{ flex: '1 1 100%' }}>
          <div>
            <dt>Revenue</dt>
            <dd>
              {useRevenue ? (
                <>
                  <span className="en-fact" title={figureText(sourced.revenue)!}>{figureText(sourced.revenue)}</span>
                  {sourced.revenue?.provenance ? <SourceChip p={sourced.revenue.provenance} testId="en-chip-revenue" /> : null}
                </>
              ) : f.revenue ? (
                <>
                  <span className="en-fact">
                    {f.revenue.value.amount != null ? fmtMoney(f.revenue.value.amount, f.revenue.value.currency) : `${f.revenue.value.currency} ${f.revenue.value.range}`}
                  </span>
                  <SourceNote source={f.revenue.value.fiscalYear ? `${f.revenue.source}, ${f.revenue.value.fiscalYear}` : f.revenue.source} asOf={f.revenue.asOf} />
                </>
              ) : missingAction('annualRevenueMicros', 'Revenue', sourced.revenue?.missing ?? 'No public revenue figure found yet')}
            </dd>
          </div>
          <div>
            <dt>Headcount</dt>
            <dd>
              {useEmployees ? (
                <>
                  <span className="en-fact" title={figureText(sourced.employees)!}>{figureText(sourced.employees)}</span>
                  {sourced.employees?.provenance ? <SourceChip p={sourced.employees.provenance} testId="en-chip-employees" /> : null}
                </>
              ) : hc ? (
                <>
                  <span className="en-fact">
                    {hc.value.current != null ? hc.value.current.toLocaleString('en-GB') : hc.value.range}
                    {trend.length > 1 ? (
                      <Spark values={trend.map((p) => p.value)} label={`Headcount over the last ${trend.length} months, ${pct === null ? 'no change data' : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%`}`} width={64} height={20} />
                    ) : null}
                    {pct !== null ? <span className="en-delta" data-down={pct < 0}>{pct > 0 ? '+' : ''}{pct}% in 12 mo</span> : null}
                  </span>
                  <SourceNote source={hc.source} asOf={hc.asOf} />
                </>
              ) : missingAction('employeeCount', 'Headcount', sourced.employees?.missing ?? 'No headcount on record or in public sources')}
            </dd>
          </div>
          <div>
            <dt>Industry</dt>
            <dd>
              {f.industry ? (
                <>
                  <span className="en-fact-sm" title={f.industry.value}>{f.industry.value}</span>
                  <SourceNote source={f.industry.source} asOf={f.industry.asOf} />
                </>
              ) : missingAction('industry', 'Industry', 'No industry on record')}
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
      <div className="en-foot">
        <p className="en-src" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }} role="status">
          {d.sample ? <SampleBadge show /> : null}
          {polling
            ? 'Enrichment queued. Results appear here when the run finishes.'
            : d.notice ?? (d.sample ? 'Illustrative firmographics until company enrichment is connected.' : null)}
          {!d.sample && d.fetchedAt && !polling ? (
            <span>
              Enriched <time dateTime={d.fetchedAt}>{fmtAsOf(d.fetchedAt)}</time>{d.stale ? ' · due for refresh' : ''}
            </span>
          ) : null}
        </p>
        {canRefresh && d.status !== 'not_configured' ? (
          <button type="button" className="en-link" onClick={() => refresh.mutate()} disabled={refresh.isPending || polling} data-testid="enrichment-refresh">
            {refresh.isPending || polling ? 'Refreshing…' : d.sample ? 'Enrich now' : 'Refresh'}
          </button>
        ) : null}
        {refresh.isError ? <p className="en-src" role="alert">Could not queue enrichment. Try again later.</p> : null}
      </div>
    </section>
  );
}
