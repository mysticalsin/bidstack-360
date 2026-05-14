import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Card, SectionHeader } from '@/components/ui/Card';
import { formatMoney, relativeTime } from '@/lib/format';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { headquartersFor, labelForBand } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

// Memoized — see TechStackCard for the rationale (stable cockpit prop;
// avoids re-render churn when sibling cards refetch).
export const BusinessSnapshotCard = memo(function BusinessSnapshotCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const c = cockpit.company;
  const headquarters = headquartersFor(c.name);
  const sourceCount = c.sourceAttribution.length;
  const rows: Array<[string, string]> = [
    ['Legal name', c.legalName ?? c.name],
    ['Founded', c.incorporationDate ? c.incorporationDate.slice(0, 4) : 'Not verified'],
    ['Headquarters', headquarters ?? 'Not verified'],
    [
      'Annual revenue',
      c.annualRevenueMicros
        ? formatMoney(c.annualRevenueMicros / 1_000_000, 'EUR')
        : 'Not verified',
    ],
    ['Employees', c.employeeCount ? c.employeeCount.toLocaleString() : 'Not verified'],
    ['Source receipts', `${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}`],
    ['Last refreshed', relativeTime(c.updatedAt)],
    ['Confidence', `${Math.round(c.confidence * 100)}%`],
  ];
  return (
    <Card role="region" aria-label="Business snapshot">
      <SectionHeader
        title="Business snapshot"
        caption={`Health: ${labelForBand(cockpit.health.band)} - score ${cockpit.health.score}/100`}
      />
      <div style={{ padding: '14px 18px 18px' }}>
        <dl className="kvlist">
          {rows.map(([label, value], index) => (
            <motion.div
              key={label}
              className="kv"
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.032 }}
            >
              <dt>{label}</dt>
              <dd>
                <AnimatedMetric value={value} />
              </dd>
            </motion.div>
          ))}
        </dl>
      </div>
    </Card>
  );
});
