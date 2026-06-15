/**
 * SectorViewPage — Amaris presence by industry sector globally (A3).
 * Source: ABC sector classification mirrored on company records. Sparse data
 * raises a quality banner instead of hiding the view — managers use this to
 * prep sector-specific pitch decks.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { useSectorView, type SectorRow } from '@/hooks/useSectorView';

export default function SectorViewPage() {
  const { t } = useTranslation('crm');
  const view = useSectorView();

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('sectorView.title', 'Sector view')}</h1>
          <div className="page-sub">
            {t(
              'sectorView.subtitle',
              'Where Amaris is active by industry — accounts, countries, and FTE volume from ABC.',
            )}
          </div>
        </div>
      </div>

      {view.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : view.isError ? (
        <ErrorState
          title={t('sectorView.errorTitle', 'Could not load the sector view')}
          message={
            view.error?.message ??
            t('sectorView.errorMessage', 'The sector endpoint did not respond.')
          }
        />
      ) : !view.data || view.data.sectors.length === 0 ? (
        <EmptyState
          title={t('sectorView.emptyTitle', 'No sector data yet')}
          message={t(
            'sectorView.emptyMessage',
            'Accounts gain a sector when ABC classification (or external enrichment) fills their industry.',
          )}
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
                <strong className="font-semibold">
                  {t('sectorView.qualityWarningHeading', 'Sector data quality is low.')}
                </strong>{' '}
                {t(
                  'sectorView.qualityWarningDetail',
                  '{{classified}} of {{total}} accounts carry an ABC sector classification — treat these splits as directional until ABC coverage improves.',
                  {
                    classified: view.data.classifiedAccounts,
                    total: view.data.totalAccounts,
                  },
                )}
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
  const { t } = useTranslation('crm');
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
            {sector.accountCount === 1
              ? t('sectorView.accountCountOne', '{{count}} account', {
                  count: sector.accountCount,
                })
              : t('sectorView.accountCountOther', '{{count}} accounts', {
                  count: sector.accountCount,
                })}
          </span>
          {sector.fteVolume != null ? (
            <span>
              {t('sectorView.fteValue', '{{value}} FTE', {
                value: sector.fteVolume.toLocaleString(),
              })}
            </span>
          ) : (
            <span title={t('sectorView.fteUnknownTooltip', 'No account in this sector has a known headcount')}>
              {t('sectorView.fteUnknown', 'FTE unknown')}
            </span>
          )}
          <Badge tone="blue">
            {t('sectorView.countriesBadge', '{{count}} countries', {
              count: sector.countries.length,
            })}
          </Badge>
          <span aria-hidden>{open ? '−' : '+'}</span>
        </span>
      </button>
      {open ? (
        <div className="border-t border-[var(--border)] px-5 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-[var(--fg-tertiary)]">
                <th className="py-1.5 font-medium">{t('sectorView.tableCountry', 'Country')}</th>
                <th className="py-1.5 text-right font-medium">
                  {t('sectorView.tableAccounts', 'Accounts')}
                </th>
                <th className="py-1.5 text-right font-medium">
                  {t('sectorView.tableFteVolume', 'FTE volume')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sector.countries.map((c) => (
                <tr key={c.countryCode} className="border-t border-[var(--border)]">
                  <td className="py-1.5 text-[var(--fg-primary)]">
                    {c.countryCode === '??' ? t('sectorView.unknownCountry', 'Unknown') : c.countryCode}
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
