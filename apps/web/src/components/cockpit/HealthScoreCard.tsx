import { motion, useReducedMotion } from 'framer-motion';

import { AnimatedMetric } from '@/components/motion/AnimatedMetric';
import { Card, SectionHeader } from '@/components/ui/Card';
import { springSoft } from '@/lib/motion';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

const ORDER = ['strong', 'good', 'needs_attention', 'critical'] as const;

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export function HealthScoreCard({ cockpit }: Props) {
  const reducedMotion = useReducedMotion();
  const total = ORDER.reduce((acc, key) => acc + (cockpit.health.counts[key] ?? 0), 0) || 1;
  const segments = ORDER.map((key) => ({
    key,
    count: cockpit.health.counts[key] ?? 0,
    pct: ((cockpit.health.counts[key] ?? 0) / total) * 100,
  }));
  const stops = segments
    .reduce(
      (acc, segment) => {
        const start = acc.cursor;
        const end = start + segment.pct;
        return {
          cursor: end,
          values: [
            ...acc.values,
            `${colorForHealth(segment.key)} ${start.toFixed(2)}% ${end.toFixed(2)}%`,
          ],
        };
      },
      { cursor: 0, values: [] as string[] },
    )
    .values.join(', ');

  return (
    <Card role="region" aria-label="Health score">
      <SectionHeader title="Health Score" caption={`${total} scored signals`} />
      <div className="health-card-body">
        <motion.div
          className="health-ring"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={springSoft}
          style={{ background: `conic-gradient(${stops})` }}
          aria-label={`Health score ${cockpit.health.score} out of 100`}
          role="img"
        >
          <div>
            <strong>
              <AnimatedMetric value={cockpit.health.score.toLocaleString()} />
            </strong>
            <span>/100</span>
          </div>
        </motion.div>
        <ul className="health-legend" aria-label="Health bands">
          {segments.map((segment, index) => (
            <motion.li
              key={segment.key}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...springSoft, delay: reducedMotion ? 0 : index * 0.04 }}
            >
              <span className={`legend-dot ${segment.key}`} aria-hidden />
              <span>{labelForHealth(segment.key)}</span>
              <strong>
                <AnimatedMetric value={segment.count.toLocaleString()} />
              </strong>
            </motion.li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function labelForHealth(key: (typeof ORDER)[number]): string {
  if (key === 'strong') return 'Strong';
  if (key === 'good') return 'Good';
  if (key === 'needs_attention') return 'Needs attention';
  return 'Critical';
}

function colorForHealth(key: (typeof ORDER)[number]): string {
  if (key === 'strong') return 'var(--success)';
  if (key === 'good') return 'var(--tag-jade-fg)';
  if (key === 'needs_attention') return 'var(--warning)';
  return 'var(--danger)';
}
