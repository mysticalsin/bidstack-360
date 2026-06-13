/**
 * SectorViewPage — Amaris presence by industry sector globally (A3).
 * Source: ABC sector classification mirrored on company records. Sparse data
 * raises a quality banner instead of hiding the view — managers use this to
 * prep sector-specific pitch decks.
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useSectorView, type SectorRow } from '@/hooks/useSectorView';

export default function SectorViewPage() {
  const view = useSectorView();

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sector view</h1>
          <div className="page-sub">
            Where Amaris is active by industry — accounts, countries, and FTE volume from ABC.
          </div>
        </div>
      </div>

      {view.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : view.isError ? (
        <ErrorState
          title="Could not load the sector view"
          message={view.error?.message ?? 'The sector endpoint did not respond.'}
        />
      ) : !view.data || view.data.sectors.length === 0 ? (
        <EmptyState
          title="No sector data yet"
          message="Accounts gain a sector when ABC classification (or external enrichment) fills their industry."
        />
      ) : (
        <>
          {view.data.dataQualityWarning ? (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-[var(--warning)] bg-[var(--warning-tint)] p-4 text-sm text-[var(--fg-primary)]"
            >
              <Icon name="info" size={16} aria-hidden />
              <div>
                <strong className="font-semibold">Sector data quality is low.</strong>{' '}
                {view.data.classifiedAccounts} of {view.data.totalAccounts} accounts carry an ABC
                sector classification — treat these splits as directional until ABC coverage
                improves.
              </div>
            </div>
          ) : null}
          <div className="space-y-3">
            {view.data.sectors.map((sector) => (
              <SectorCard key={sector.sector} sector={sector} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SectorCard({ sector }: { sector: SectorRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[56px] w-full items-center justify-between gap-3 px-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
      >
        <span className="font-medium text-[var(--fg-primary)]">{sector.sector}</span>
        <span className="flex items-center gap-3 text-xs text-[var(--fg-tertiary)]">
          <span>
            {sector.accountCount} account{sector.accountCount === 1 ? '' : 's'}
          </span>
          {sector.fteVolume != null ? (
            <span>{sector.fteVolume.toLocaleString()} FTE</span>
          ) : (
            <span title="No account in this sector has a known headcount">FTE unknown</span>
          )}
          <Badge tone="blue">{sector.countries.length} countries</Badge>
          <span aria-hidden>{open ? '−' : '+'}</span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] px-5 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                <th className="py-1.5 font-medium">Country</th>
                <th className="py-1.5 text-right font-medium">Accounts</th>
                <th className="py-1.5 text-right font-medium">FTE volume</th>
              </tr>
            </thead>
            <tbody>
              {sector.countries.map((c) => (
                <tr key={c.countryCode} className="border-t border-[var(--border)]">
                  <td className="py-1.5 text-[var(--fg-primary)]">
                    {c.countryCode === '??' ? 'Unknown' : c.countryCode}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{c.accountCount}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {c.fteVolume != null ? c.fteVolume.toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
