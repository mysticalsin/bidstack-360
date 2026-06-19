/**
 * SectorViewPage - Amaris presence by industry sector globally (A3).
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
import { useSectorView, type SectorAccount, type SectorRow } from '@/hooks/useSectorView';
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

  const sectors = view.data?.sectors ?? [];
  const selectedSector =
    sectors.find((sector) => sector.sector === selectedSectorName) ?? sectors[0] ?? null;
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
            'Accounts gain a sector when ABC classification or external enrichment fills their industry.',
          )}
        />
      ) : (
        <>
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
              value={selectedSector?.sector ?? '-'}
              detail={
                selectedSector
                  ? t('sectorView.metricLeaderDetail', '{{count}} accounts', {
                      count: selectedSector.accountCount,
                    })
                  : '-'
              }
            />
          </section>

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
