import { motion, useReducedMotion } from 'framer-motion';
import { memo } from 'react';

import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { Icon } from '@/components/ui/Icon';
import { springSnap, staggerChild, staggerParent } from '@/lib/motion';
import { Sparkline } from './Sparkline';
import { seedSeries } from './sparkSeed';
import { GlassCard } from '@/components/ui/GlassCard';

import type { AccountCockpitSnapshot } from '@bidstack/shared';

import { KPI_TONE_BG, KPI_TONE_FG, iconForKpi } from './_tokens';

interface Props {
  cockpit: AccountCockpitSnapshot;
}

export const KpiRow = memo(function KpiRow({ cockpit }: Props) {
  const reduced = useReducedMotion();
  // Adapt the column count to the available KPI tiles — 6 is the design
  // ceiling, 3 is the minimum that still reads as a row. The CSS classes
  // .cols-3/4/6 live in index.css and collapse responsively below ~720px.
  const cols = Math.min(6, Math.max(3, cockpit.kpis.length));
  const colsClass = cols >= 6 ? 'cols-6' : cols === 4 ? 'cols-4' : 'cols-3';
  return (
    <motion.section
      className={`kpi-grid ${colsClass}`}
      aria-label="Account metrics"
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
    >
      {cockpit.kpis.map((kpi) => (
        <GlassCard
          key={kpi.label}
          /* spotlight removed — no cursor-tracking glow */
          className="flex gap-3"
          variants={reduced ? undefined : staggerChild}
          transition={springSnap}
        >
          <div
            className="kpi-icon"
            style={{ background: KPI_TONE_BG[kpi.tone], color: KPI_TONE_FG[kpi.tone] }}
            aria-hidden
          >
            <Icon name={iconForKpi(kpi.label)} size={18} />
          </div>
          <div className="kpi-text" style={{ flex: 1, minWidth: 0 }}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value">
              <KpiValue raw={kpi.value} reduced={reduced} />
            </div>
            {kpi.detail ? <div className="kpi-sub">{kpi.detail}</div> : null}
          </div>
          <div
            aria-hidden
            style={{
              color: KPI_TONE_FG[kpi.tone],
              alignSelf: 'flex-end',
              marginBottom: 4,
            }}
          >
            <Sparkline values={seedSeries(kpi.label)} />
          </div>
        </GlassCard>
      ))}
    </motion.section>
  );
});

// Parse a formatted KPI value like "€12,345", "48%", "2.5x", "1,200 days"
// and animate just the numeric portion. The prefix and suffix render as
// static text so currency symbols and units don't flicker mid-tween.
// If no number is found (e.g. "Healthy"), render the string verbatim.
const NUM_RE = /(-?\d[\d,]*(?:\.\d+)?)/;

function KpiValue({ raw, reduced }: { raw: string; reduced: boolean | null }) {
  const match = NUM_RE.exec(raw);
  if (!match) return <>{raw}</>;
  const literal = match[1] ?? '';
  const target = Number(literal.replace(/,/g, ''));
  if (!Number.isFinite(target)) return <>{raw}</>;
  // Honor reduced motion: print the final value with zero-duration animate.
  // We still mount AnimatedNumber so the layout doesn't shift between modes.
  const prefix = raw.slice(0, match.index);
  const suffix = raw.slice(match.index + literal.length);
  const hasDecimals = literal.includes('.');
  return (
    <>
      {prefix}
      <AnimatedNumber
        value={target}
        duration={reduced ? 0 : 0.9}
        format={(n) =>
          hasDecimals
            ? n.toLocaleString(undefined, { maximumFractionDigits: 1 })
            : Math.round(n).toLocaleString()
        }
      />
      {suffix}
    </>
  );
}
