/**
 * dashboard/widgets/KpiRow.tsx — the workspace metric strip.
 *
 * WHY a strip and not six cards: the previous design rendered six identical
 * glow-icon cards, each in its own accent hue with a decorative mini bar
 * chart. Six equal heroes = no hierarchy, six hues = color carrying zero
 * meaning, and the sparkbars mixed unrelated entities inside one tile. These
 * are entity COUNTS, not analytical series — so they read as one quiet row of
 * numbers: hairline-divided, neutral ink, tabular numerals, with a single
 * accent reserved for the one metric flagged `emphasis` (open pipeline — the
 * number a sales lead actually steers by). Identity comes from the label,
 * hierarchy from the accent, and the whole strip stays scannable in a glance.
 */
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { staggerParent, staggerChild } from '@/lib/motion';

import { type OrgKpi } from './dashboard-types';

export function KpiRow({ kpis, reduced }: { kpis: OrgKpi[]; reduced: boolean | null }) {
  const { t } = useTranslation('crm');
  return (
    <motion.section
      className="kpi-strip"
      aria-label={t('kpiRow.workspaceMetricsAriaLabel', 'Workspace metrics')}
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
    >
      {kpis.map((kpi) => (
        <motion.div
          key={kpi.label}
          className="kpi-strip-cell"
          variants={reduced ? undefined : staggerChild}
        >
          <Link
            to={kpi.href}
            className={`kpi-strip-item${kpi.emphasis ? ' is-primary' : ''}`}
            aria-label={`${kpi.label}: ${kpi.value.toLocaleString()}`}
          >
            <span className="kpi-strip-label">{kpi.label}</span>
            <span className="kpi-strip-value">
              <AnimatedNumber
                value={kpi.value}
                duration={reduced ? 0 : 0.9}
                format={(n) => Math.round(n).toLocaleString()}
              />
            </span>
          </Link>
        </motion.div>
      ))}
    </motion.section>
  );
}
