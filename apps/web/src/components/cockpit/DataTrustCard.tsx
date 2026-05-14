import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Card, SectionHeader } from '@/components/ui/Card';
import { relativeTime } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot, CrmLogoSource, SourceAttribution } from '@bidstack/shared';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const DataTrustCard = memo(function DataTrustCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const company = cockpit.company;
  const sources = company.sourceAttribution.slice(0, 4);
  const sourceCount = company.sourceAttribution.length;
  const averageConfidence = sourceCount
    ? company.sourceAttribution.reduce((acc, source) => acc + source.confidence, 0) / sourceCount
    : company.confidence;
  const latestFetch = latestFetchedAt(company.sourceAttribution) ?? company.updatedAt;

  const checks: Array<{ label: string; value: string; tone: BadgeTone }> = [
    {
      label: 'Legal identity',
      value: company.legalName ? 'Verified' : 'Pending',
      tone: company.legalName ? 'jade' : 'amber',
    },
    {
      label: 'Logo',
      value: company.logo ? logoSourceLabel(company.logo.source) : 'Initials',
      tone: company.logo?.url ? 'jade' : 'gray',
    },
    {
      label: 'Freshness',
      value: relativeTime(latestFetch),
      tone: isFresh(latestFetch) ? 'jade' : 'amber',
    },
  ];

  return (
    <Card role="region" aria-label="Data trust and attribution">
      <SectionHeader title="Data trust" caption="Every field keeps its source receipt" />
      <div className="data-trust">
        <div className="data-trust-score">
          <span>Verified confidence</span>
          <strong>
            <AnimatedMetric value={`${Math.round(averageConfidence * 100)}%`} />
          </strong>
          <small>{sourceCount} attributed sources</small>
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

        <div className="data-trust-sources" aria-label="Source receipts">
          {sources.length === 0 ? (
            <div className="data-trust-empty">
              Run enrichment to attach official registry, logo, and market-source receipts.
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

function latestFetchedAt(sources: SourceAttribution[]): string | null {
  let latest: string | null = null;
  for (const source of sources) {
    if (!latest || source.fetchedAt > latest) latest = source.fetchedAt;
  }
  return latest;
}

function isFresh(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 1000 * 60 * 60 * 24 * 30;
}

function logoSourceLabel(source: CrmLogoSource): string {
  if (source === 'logo_dev') return 'Logo.dev';
  if (source === 'official_website') return 'Official';
  if (source === 'brandfetch') return 'Brandfetch';
  if (source === 'wikimedia') return 'Wikimedia';
  if (source === 'favicon') return 'Favicon';
  if (source === 'manual') return 'Manual';
  return 'Initials';
}
