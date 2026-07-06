/**
 * SectorViewPage - Mantu presence by industry sector globally (A3).
 * Source: ABC sector classification mirrored on company records. Sparse data
 * raises a quality banner instead of hiding the view.
 */
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { WorldMap } from '@/components/territories/WorldMap';
import { useSectorView, type SectorAccount, type SectorRow } from '@/hooks/useSectorView';
import {
  useTerritoryAnalytics,
  useTerritorySegments,
  type TerritorySegment,
} from '@/hooks/useTerritories';
import { formatMoneyMicros } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import { StrategicSignalInsight } from './accountsPage/StrategicSignalInsight';
import { sourceLabel, titleCase } from './accountsPage/accountUtils';
import { sectorAccountSignal, sectorCoverageSignal } from './accountsPage/strategicSignals';

export default function SectorViewPage() {
  const { t } = useTranslation('crm');
  const view = useSectorView();
  const reducedMotion = useReducedMotion();
  const [selectedSectorName, setSelectedSectorName] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<'country' | 'industry'>('country');
  const [mapCountry, setMapCountry] = useState<string | null>(null);
  const analytics = useTerritoryAnalytics();
  const industrySegments = useTerritorySegments('industry');

  const sectors = view.data?.sectors ?? [];
  const selectedSector =
    sectors.find((sector) => sector.sector === selectedSectorName) ?? sectors[0] ?? null;
  // The "Largest sector" tile must reflect the sector with the most accounts —
  // independent of which sector the user has selected in the radar list.
  const largestSector = sectors.reduce<(typeof sectors)[number] | null>(
    (max, sector) => (!max || sector.accountCount > max.accountCount ? sector : max),
    null,
  );
  const selectedSectorSignal = selectedSector ? sectorCoverageSignal(selectedSector) : null;
  const filteredAccounts = selectedSector
    ? country
      ? selectedSector.accounts.filter((account) => account.countryCode === country)
      : selectedSector.accounts
    : [];

  const classifiedPercent = view.data
    ? formatPercent(view.data.classifiedAccounts, view.data.totalAccounts)
    : '0%';
  const maxSectorAccounts = Math.max(
    1,
    ...sectors.map((sector) => sector.accountCount),
  );

  return (
    <div className="space-y-5">
      <motion.div
        className="page-head motion-page-head"
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(6px)' }}
        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={springSoft}
      >
        <div>
          <h1 className="page-title gradient-text">{t('sectorView.title', 'Sector view')}</h1>
          <div className="page-sub">
            {t(
              'sectorView.subtitle',
              'Industry presence, country depth, and account-level coverage from ABC.',
            )}
          </div>
        </div>
        <div className="page-actions">
          <Link to="/accounts" className="btn btn-secondary">
            <Icon name="building" size={14} />
            {t('sectorView.openAccounts', 'Accounts')}
          </Link>
        </div>
      </motion.div>

      {view.isLoading ? (
        <LoadingSkeleton rows={6} />
      ) : view.isError && !view.data ? (
        // Hard error only when there is NO data to show. A background refetch
        // (refetchOnWindowFocus / reconnect after idle) that fails while we
        // still hold the last good data must NOT wipe the view — that case is
        // handled by the non-blocking stale banner in the content branch below.
        <ErrorState
          title={t('sectorView.errorTitle', 'Could not load the sector view')}
          message={
            view.error?.message ??
            t('sectorView.errorMessage', 'The sector endpoint did not respond.')
          }
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void view.refetch()}
            >
              {t('sectorView.retry', 'Retry')}
            </button>
          }
        />
      ) : !view.isError && (!view.data || view.data.sectors.length === 0) ? (
        <EmptyState
          title={t('sectorView.emptyTitle', 'No sector data yet')}
          message={t(
            'sectorView.emptyMessage',
            'Accounts gain a sector when ABC classification or external enrichment fills their industry.',
          )}
        />
      ) : (
        <>
          {view.isError ? (
            // We have valid data but the latest refresh failed (e.g. focus
            // refetch after idle). Keep the view; offer a manual retry instead
            // of replacing everything with an error wall.
            <div role="status" className="sector-quality-banner">
              <Icon name="warning" size={16} aria-hidden />
              <div>
                <strong>
                  {t('sectorView.staleHeading', 'Showing the last loaded sector view.')}
                </strong>{' '}
                {t(
                  'sectorView.staleDetail',
                  'We could not refresh sector data just now — it will retry automatically.',
                )}{' '}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void view.refetch()}
                >
                  {t('sectorView.retry', 'Retry')}
                </button>
              </div>
            </div>
          ) : null}

          {view.data.dataQualityWarning ? (
            <div
              role="status"
              className="sector-quality-banner"
            >
              <Icon name="info" size={16} aria-hidden />
              <div>
                <strong>{t('sectorView.qualityWarningHeading', 'Sector coverage is low.')}</strong>{' '}
                {t(
                  'sectorView.qualityWarningDetail',
                  '{{classified}} of {{total}} accounts carry an industry classification. Treat the split as directional until ABC coverage improves.',
                  {
                    classified: view.data.classifiedAccounts,
                    total: view.data.totalAccounts,
                  },
                )}
              </div>
            </div>
          ) : null}

          <section className="sector-command-strip" aria-label={t('sectorView.metricsLabel', 'Sector metrics')}>
            <SectorMetric
              icon="building"
              label={t('sectorView.metricAccounts', 'Accounts')}
              value={view.data.totalAccounts.toLocaleString()}
              detail={t('sectorView.metricAccountsDetail', 'sampled portfolio')}
            />
            <SectorMetric
              icon="checkCircle"
              label={t('sectorView.metricClassified', 'Classified')}
              value={classifiedPercent}
              detail={t('sectorView.metricClassifiedDetail', '{{count}} accounts', {
                count: view.data.classifiedAccounts,
              })}
            />
            <SectorMetric
              icon="globe"
              label={t('sectorView.metricSectors', 'Sectors')}
              value={view.data.sectors.length.toLocaleString()}
              detail={t('sectorView.metricSectorsDetail', 'industry clusters')}
            />
            <SectorMetric
              icon="contacts"
              label={t('sectorView.metricLeaders', 'Largest sector')}
              value={largestSector?.sector ?? '-'}
              detail={
                largestSector
                  ? t('sectorView.metricLeaderDetail', '{{count}} accounts', {
                      count: largestSector.accountCount,
                    })
                  : '-'
              }
            />
          </section>

          <Card className="overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
                  {t('sectorView.geoEyebrow', 'Global opportunity map')}
                </p>
                <h2 className="text-base font-semibold text-[var(--fg-primary)]">
                  {mapMode === 'country'
                    ? t('sectorView.geoCountryTitle', 'Pipeline by country')
                    : t('sectorView.geoIndustryTitle', 'Pipeline by industry')}
                </h2>
              </div>
              <div
                role="tablist"
                aria-label={t('sectorView.geoModeLabel', 'Map dimension')}
                className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-0.5"
              >
                {(['country', 'industry'] as const).map((mode) => (
                  <button
                    key={mode}
                    role="tab"
                    aria-selected={mapMode === mode}
                    onClick={() => setMapMode(mode)}
                    className={`min-h-9 rounded-md px-3 text-xs font-semibold transition-colors ${
                      mapMode === mode
                        ? 'bg-[var(--brand-primary)] text-white'
                        : 'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]'
                    }`}
                  >
                    {mode === 'country'
                      ? t('sectorView.geoModeCountry', 'By country')
                      : t('sectorView.geoModeIndustry', 'By industry')}
                  </button>
                ))}
              </div>
            </div>

            {mapMode === 'country' ? (
              <div className="h-[440px]">
                {analytics.isLoading ? (
                  <div className="p-4">
                    <LoadingSkeleton rows={6} />
                  </div>
                ) : analytics.isError ? (
                  <ErrorState
                    title={t('sectorView.geoErrorTitle', 'Could not load the map')}
                    message={analytics.error?.message ?? t('sectorView.geoErrorMessage', 'The analytics endpoint did not respond.')}
                  />
                ) : (analytics.data?.items.length ?? 0) === 0 ? (
                  <EmptyState
                    title={t('sectorView.geoEmptyTitle', 'No geographic data')}
                    message={t('sectorView.geoEmptyMessage', 'Opportunities need a country to appear on the map.')}
                  />
                ) : (
                  <WorldMap
                    data={analytics.data?.items ?? []}
                    selectedCountryCode={mapCountry}
                    onCountryClick={(item) =>
                      setMapCountry((c) => (c === item.countryCode ? null : item.countryCode))
                    }
                    className="!rounded-none !border-0 !border-t-0"
                  />
                )}
              </div>
            ) : (
              <div className="p-4">
                {industrySegments.isLoading ? (
                  <LoadingSkeleton rows={6} />
                ) : industrySegments.isError ? (
                  <ErrorState
                    title={t('sectorView.geoErrorTitle', 'Could not load the map')}
                    message={industrySegments.error?.message ?? t('sectorView.geoErrorMessage', 'The analytics endpoint did not respond.')}
                  />
                ) : (
                  <IndustryBars items={industrySegments.data?.items ?? []} />
                )}
              </div>
            )}
          </Card>

          <section className="sector-experience-grid">
            <Card className="sector-radar-panel">
              <div className="sector-panel-head">
                <div>
                  <p>{t('sectorView.mapEyebrow', 'Industry map')}</p>
                  <h2>{t('sectorView.mapTitle', 'Sector momentum')}</h2>
                </div>
                <Badge tone="blue">{t('sectorView.mapBadge', 'ABC')}</Badge>
              </div>
              <div className="sector-radar-list">
                {view.data.sectors.map((sector) => (
                  <SectorButton
                    key={sector.sector}
                    sector={sector}
                    maxAccounts={maxSectorAccounts}
                    selected={selectedSector?.sector === sector.sector}
                    onSelect={() => {
                      setSelectedSectorName(sector.sector);
                      setCountry(null);
                    }}
                  />
                ))}
              </div>
            </Card>

            {selectedSector ? (
              <Card className="sector-detail-panel">
                <div className="sector-detail-hero">
                  <div>
                    <p>{t('sectorView.detailEyebrow', 'Selected sector')}</p>
                    <h2>{titleCase(selectedSector.sector)}</h2>
                    <span>
                      {t('sectorView.detailSummary', '{{accounts}} accounts across {{countries}} countries', {
                        accounts: selectedSector.accountCount,
                        countries: selectedSector.countries.length,
                      })}
                    </span>
                  </div>
                  <div className="sector-detail-score" aria-label={t('sectorView.knownFteLabel', 'Known FTE coverage')}>
                    <strong>{formatPercent(selectedSector.coverage.knownFteAccounts, selectedSector.accountCount)}</strong>
                    <span>{t('sectorView.knownFte', 'known FTE')}</span>
                  </div>
                </div>

                <div className="sector-coverage-grid">
                  <CoverageBar
                    label={t('sectorView.coverageFte', 'FTE coverage')}
                    value={selectedSector.coverage.knownFteAccounts}
                    total={selectedSector.accountCount}
                  />
                  <CoverageBar
                    label={t('sectorView.coverageVerified', 'Verified accounts')}
                    value={selectedSector.coverage.verifiedAccounts}
                    total={selectedSector.accountCount}
                  />
                  <CoverageBar
                    label={t('sectorView.coverageLogos', 'Logo coverage')}
                    value={selectedSector.coverage.logoAccounts}
                    total={selectedSector.accountCount}
                  />
                </div>
                {selectedSectorSignal ? (
                  <div className="sector-detail-insight">
                    <StrategicSignalInsight
                      signal={selectedSectorSignal}
                      label={`${selectedSector.sector} sector coverage signal`}
                    />
                  </div>
                ) : null}

                <div className="sector-country-strip" aria-label={t('sectorView.countryFilterLabel', 'Country filter')}>
                  <button
                    type="button"
                    className={country === null ? 'is-active' : ''}
                    onClick={() => setCountry(null)}
                  >
                    {t('sectorView.countryAll', 'All')}
                  </button>
                  {selectedSector.countries.map((item) => (
                    <button
                      key={item.countryCode}
                      type="button"
                      className={country === item.countryCode ? 'is-active' : ''}
                      onClick={() => setCountry(item.countryCode)}
                    >
                      {countryLabel(item.countryCode)}
                      <span>{item.accountCount}</span>
                    </button>
                  ))}
                </div>

                <div className="sector-account-list" aria-label={t('sectorView.accountListLabel', 'Sector accounts')}>
                  {filteredAccounts.length > 0 ? (
                    filteredAccounts.map((account) => (
                      <SectorAccountRow key={account.id} account={account} />
                    ))
                  ) : (
                    <EmptyState
                      title={t('sectorView.countryEmptyTitle', 'No account in this country sample')}
                      message={t('sectorView.countryEmptyMessage', 'Choose another country or return to all accounts.')}
                    />
                  )}
                </div>
              </Card>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}

function SectorMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: 'building' | 'checkCircle' | 'globe' | 'contacts';
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="sector-metric">
      <span className="sector-metric-icon">
        <Icon name={icon} size={16} aria-hidden />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function IndustryBars({ items }: { items: TerritorySegment[] }) {
  const { t } = useTranslation('crm');
  if (items.length === 0) {
    return (
      <EmptyState
        title={t('sectorView.geoIndustryEmptyTitle', 'No industry pipeline yet')}
        message={t('sectorView.geoIndustryEmptyMessage', 'Opportunities gain an industry from their account classification.')}
      />
    );
  }
  const sorted = [...items].sort((a, b) => b.totalValueMicros - a.totalValueMicros);
  const max = Math.max(1, ...sorted.map((s) => s.totalValueMicros));
  return (
    <div className="space-y-2.5">
      {sorted.map((seg) => (
        <div key={seg.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-[var(--fg-primary)]">{titleCase(seg.label)}</span>
            <span className="shrink-0 tabular-nums text-xs text-[var(--fg-tertiary)]">
              {t('sectorView.geoIndustryMeta', '{{count}} opps · {{value}}', {
                count: seg.opportunityCount,
                value: formatMoneyMicros(seg.totalValueMicros, 'EUR'),
              })}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
            <span
              className="block h-full rounded-full bg-[var(--brand-primary)] transition-[width] duration-500"
              style={{ width: `${Math.max(3, Math.round((seg.totalValueMicros / max) * 100))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SectorButton({
  sector,
  maxAccounts,
  selected,
  onSelect,
}: {
  sector: SectorRow;
  maxAccounts: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('crm');
  const width = `${Math.max(8, Math.round((sector.accountCount / maxAccounts) * 100))}%`;
  return (
    <button
      type="button"
      className={`sector-radar-row${selected ? ' is-active' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="sector-radar-main">
        <span>{titleCase(sector.sector)}</span>
        <small>
          {t('sectorView.radarMeta', '{{accounts}} accounts / {{countries}} countries', {
            accounts: sector.accountCount,
            countries: sector.countries.length,
          })}
        </small>
      </span>
      <span className="sector-radar-bar" aria-hidden>
        <span style={{ width }} />
      </span>
      <span className="sector-radar-fte">
        {sector.fteVolume != null ? sector.fteVolume.toLocaleString() : t('sectorView.fteUnknown', 'FTE unknown')}
      </span>
    </button>
  );
}

function CoverageBar({ label, value, total }: { label: string; value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="sector-coverage-item">
      <div>
        <span>{label}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="sector-coverage-bar" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SectorAccountRow({ account }: { account: SectorAccount }) {
  const { t } = useTranslation('crm');
  const signal = sectorAccountSignal(account);
  return (
    <Link to={`/accounts/${encodeURIComponent(account.id)}`} className="sector-account-row">
      <span className="sector-account-avatar" aria-hidden>
        {account.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="sector-account-main">
        <strong>{account.name}</strong>
        <small>
          {countryLabel(account.countryCode)}
          {account.domain ? ` / ${account.domain}` : ''}
        </small>
        <span className={`sector-account-next${signal.status === 'complete' ? ' is-complete' : ''}`}>
          {signal.reason} <b>{`Next: ${signal.nextAction}`}</b>
        </span>
      </span>
      <span className="sector-account-signal">
        <Badge tone={account.source === 'verified_data' ? 'jade' : 'gray'}>
          {sourceLabel(account.source)}
        </Badge>
        <small>{t('sectorView.accountConfidence', '{{value}}% confidence', { value: Math.round(account.confidence * 100) })}</small>
      </span>
      <Icon name="chevron-right" size={16} aria-hidden />
    </Link>
  );
}

function formatPercent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
}

function countryLabel(countryCode: string): string {
  return countryCode === '??' ? 'Unknown' : countryCode;
}
