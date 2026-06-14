/**
 * dashboard/widgets/KpiRow.tsx — animated KPI grid row with per-card mini
 * signal bar charts.
 *
 * WHY a separate module: KpiRow + KpiSignal together (~117 source lines) are
 * self-contained presentation logic. Extracting them keeps OrgDashboard an
 * orchestration shell and makes the KPI grid independently testable.
 */
import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/components/ui/GlassCard';
import { Icon } from '@/components/ui/Icon';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { springSoft, springSnap, staggerParent, staggerChild } from '@/lib/motion';

import {
  type OrgKpi,
  type KpiTone,
  type SignalPoint,
  TONE_BG,
  TONE_FG,
  TONE_GLOW,
} from './dashboard-types';

// ─── KpiRow ─────────────────────────────────────────────────────────────────

export function KpiRow({ kpis, reduced }: { kpis: OrgKpi[]; reduced: boolean | null }) {
  const { t } = useTranslation('crm');
  return (
    <motion.section
      className="kpi-grid cols-6"
      aria-label={t('kpiRow.workspaceMetricsAriaLabel', 'Workspace metrics')}
      variants={reduced ? undefined : staggerParent}
      initial="initial"
      animate="animate"
    >
      {kpis.map((kpi, i) => (
        <GlassCard
          key={kpi.label}
          className="flex gap-3 dashboard-kpi-card"
          variants={reduced ? undefined : staggerChild}
          transition={springSnap}
          hoverable
          glow={kpi.tone}
        >
          <Link
            to={kpi.href}
            className="dashboard-kpi-link"
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <div
              className="kpi-icon"
              style={{
                background: TONE_BG[kpi.tone],
                color: TONE_FG[kpi.tone],
                boxShadow: `0 0 16px ${TONE_GLOW[kpi.tone]}`,
              }}
              aria-hidden
            >
              <Icon name={kpi.icon} size={18} />
            </div>
            <div className="kpi-text" style={{ flex: 1, minWidth: 0 }}>
              <div className="kpi-label">{kpi.label}</div>
              <div className="kpi-value" style={{ fontSize: 26, fontWeight: 800 }}>
                <AnimatedNumber
                  value={kpi.value}
                  duration={reduced ? 0 : 0.9}
                  format={(n) => Math.round(n).toLocaleString()}
                />
              </div>
              <div className="kpi-meta">
                {kpi.detail ? <span className="kpi-sub">{kpi.detail}</span> : null}
                {kpi.trend !== undefined && (
                  <span className={`kpi-trend ${kpi.trend >= 0 ? 'trend-up' : 'trend-down'}`}>
                    {kpi.trend >= 0 ? '↑' : '↓'} {Math.abs(kpi.trend)}%
                  </span>
                )}
              </div>
            </div>
            <div className="dashboard-kpi-signal" aria-hidden style={{ color: TONE_FG[kpi.tone] }}>
              <KpiSignal points={kpi.signal} tone={kpi.tone} reduced={reduced} delay={i * 0.04} />
            </div>
          </Link>
        </GlassCard>
      ))}
    </motion.section>
  );
}

// ─── KpiSignal (private — used only by KpiRow) ───────────────────────────────

function KpiSignal({
  points,
  tone,
  reduced,
  delay = 0,
}: {
  points: SignalPoint[];
  tone: KpiTone;
  reduced: boolean | null;
  delay?: number;
}) {
  const { t } = useTranslation('crm');
  const visible = points
    .filter((point) => Number.isFinite(point.value) && point.value > 0)
    .slice(0, 5);

  if (visible.length === 0) {
    return (
      <div
        className="kpi-signal kpi-signal-empty"
        title={t('kpiRow.noLiveSignalTitle', 'No live signal yet')}
      >
        <span />
        <span />
        <span />
      </div>
    );
  }

  const max = Math.max(...visible.map((point) => point.value), 1);
  const title = visible
    .map((point) => `${point.label}: ${Math.round(point.value).toLocaleString()}`)
    .join(', ');

  return (
    <div className="kpi-signal" title={title}>
      {visible.map((point, index) => {
        const height = Math.max(18, (point.value / max) * 100);
        return (
          <motion.span
            key={`${point.label}-${index}`}
            className="kpi-signal-bar"
            style={
              {
                '--signal-color': point.color ?? TONE_FG[tone],
              } as CSSProperties
            }
            initial={
              reduced ? { height: `${height}%`, opacity: 1 } : { height: '18%', opacity: 0.45 }
            }
            animate={{ height: `${height}%`, opacity: 1 }}
            transition={{ ...springSoft, delay: reduced ? 0 : delay + index * 0.045 }}
          />
        );
      })}
    </div>
  );
}
