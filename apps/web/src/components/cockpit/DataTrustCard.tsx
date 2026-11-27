import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { relativeTime } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, CrmLogoSource, SourceAttribution } from '@bidstack/shared';

import { dataTrustPosture } from './data-trust-posture';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const DataTrustCard = memo(function DataTrustCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const { t } = useTranslation('crm');
  const company = cockpit.company;
  const posture = dataTrustPosture(company.sourceAttribution);
  const sources = posture.realSources.slice(0, 4);
  const sourceCount = posture.realSources.length;
  const notVerified = t('dataTrust.valueNotVerified', 'Not verified');
  const latestFetch = posture.latestFetch;

  const checks: Array<{ label: string; value: string; tone: BadgeTone }> = [
    {
      label: t('dataTrust.checkLegalIdentity', 'Legal identity'),
      value: company.legalName
        ? t('dataTrust.valueAttributed', 'Attributed')
        : t('dataTrust.valuePending', 'Pending'),
      tone: company.legalName ? 'jade' : 'amber',
    },
    {
      label: t('dataTrust.checkLogo', 'Logo'),
      value: company.logo
        ? logoSourceLabel(company.logo.source, t)
        : t('dataTrust.logoSourceInitials', 'Initials'),
      tone: company.logo?.url ? 'jade' : 'gray',
    },
    {
      label: t('dataTrust.checkFreshness', 'Freshness'),
      value: latestFetch ? relativeTime(latestFetch) : notVerified,
      tone: latestFetch && isFresh(latestFetch) ? 'jade' : 'amber',
    },
  ];

  return (
    <Card role="region" aria-label={t('dataTrust.regionLabel', 'Data trust and attribution')}>
      <SectionHeader
        title={t('dataTrust.title', 'Data trust')}
        caption={t('dataTrust.caption', 'Key fields include available source attribution')}
      />
      <div className="data-trust">
        <div className="data-trust-score">
          <span>{t('dataTrust.attributionConfidence', 'Attribution confidence')}</span>
          <strong data-testid="data-trust-confidence">
            {posture.confidence === null ? (
              notVerified
            ) : (
              <AnimatedMetric value={`${Math.round(posture.confidence * 100)}%`} />
            )}
          </strong>
          <small>
            {sourceCount === 0
              ? t('dataTrust.noExternalSource', 'No external source is attached.')
              : t('dataTrust.attributedSources', '{{count}} attributed sources', {
                  count: sourceCount,
                })}
          </small>
        </div>

        <div className="data-trust-checks">
          {checks.map((check, index) => (
            <motion.div
              key={check.label}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.035 }}
            >
              <span>{check.label}</span>
              <Badge tone={check.tone}>{check.value}</Badge>
            </motion.div>
          ))}
        </div>

        <div className="data-trust-sources" aria-label={t('dataTrust.sourceReceipts', 'Source receipts')}>
          {sources.length === 0 ? (
            <div className="data-trust-empty">
              {company.sourceAttribution.length > 0
                ? t(
                    'dataTrust.placeholderSources',
                    'A CRM placeholder or demo seed profile is not an external attribution.',
                  )
                : t(
                    'dataTrust.emptySources',
                    'Run data verification to attach registry, logo, and market data sources.',
                  )}
            </div>
          ) : (
            sources.map((source, index) => (
              <SourceReceipt
                key={`${source.source}-${source.fetchedAt}-${index}`}
                source={source}
                index={index}
                reducedMotion={Boolean(reducedMotion)}
              />
            ))
          )}
        </div>
      </div>
    </Card>
  );
});

function SourceReceipt({
  source,
  index,
  reducedMotion,
}: {
  source: SourceAttribution;
  index: number;
  reducedMotion: boolean;
}) {
  const content = (
    <>
      <div>
        <strong>{source.label}</strong>
        <span>{relativeTime(source.fetchedAt)}</span>
      </div>
      <Badge
        tone={source.confidence >= 0.9 ? 'jade' : source.confidence >= 0.72 ? 'blue' : 'amber'}
      >
        {Math.round(source.confidence * 100)}%
      </Badge>
    </>
  );

  const motionProps = {
    initial: reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 },
    animate: { opacity: 1, x: 0 },
    transition: { ...springSoft, delay: reducedMotion ? 0 : index * 0.04 },
  };

  if (source.sourceUrl) {
    return (
      <motion.a
        className="data-trust-source"
        href={source.sourceUrl}
        target="_blank"
        rel="noreferrer"
        {...motionProps}
      >
        {content}
      </motion.a>
    );
  }

  return (
    <motion.div className="data-trust-source" {...motionProps}>
      {content}
    </motion.div>
  );
}

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 1000 * 60 * 60 * 24 * 30;
}

function logoSourceLabel(source: CrmLogoSource, t: TFunction): string {
  if (source === 'logo_dev') return t('dataTrust.logoSourceLogoDev', 'Logo.dev');
  if (source === 'official_website') return t('dataTrust.logoSourceOfficial', 'Official');
  if (source === 'brandfetch') return t('dataTrust.logoSourceBrandfetch', 'Brandfetch');
  if (source === 'wikimedia') return t('dataTrust.logoSourceWikimedia', 'Wikimedia');
  if (source === 'favicon') return t('dataTrust.logoSourceFavicon', 'Favicon');
  if (source === 'manual') return t('dataTrust.logoSourceManual', 'Manual');
  return t('dataTrust.logoSourceInitials', 'Initials');
}
