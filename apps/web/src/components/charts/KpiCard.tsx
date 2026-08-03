// KpiCard — large number + trend arrow + sparkline + delta vs previous period.
// Animates the number from 0 to target in 800ms ease-out.
// Respects prefers-reduced-motion: jumps directly to final value.

import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { springSoft } from '@/lib/motion';
import { Sparkline } from './Sparkline';

interface Props {
  title: string;
  value: number;
  unit?: string;
  // positive = up, negative = down
  deltaPercent?: number;
  deltaPeriod?: string;
  sparklineData?: number[];
  format?: (n: number) => string;
  loading?: boolean;
  className?: string;
}

function defaultFormat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function KpiCard({
  title,
  value,
  unit,
  deltaPercent,
  deltaPeriod,
  sparklineData,
  format = defaultFormat,
  loading = false,
  className,
}: Props) {
  const { t } = useTranslation('crm');
  const reduced = useReducedMotion();
  const numRef = useRef<HTMLSpanElement>(null);
  const deltaPeriodLabel = deltaPeriod ?? t('kpi.deltaPeriodDefault', 'vs last period');

  // Count-up animation: use requestAnimationFrame for smooth interpolation.
  // If reduced motion is set, immediately display final value.
  useEffect(() => {
    const el = numRef.current;
    if (!el) return;
    if (reduced) {
      el.textContent = format(value);
      return;
    }
    const duration = 800;
    const start = performance.now();
    let rafId: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(value * eased);
      if (progress < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [value, format, reduced]);

  const deltaSign = deltaPercent !== undefined ? Math.sign(deltaPercent) : 0;

  if (loading) {
    return (
      <div
        className={cn(
          'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]',
          'dark:bg-[var(--surface-glass)] p-5 animate-pulse',
          className,
        )}
        role="status"
        aria-label={t('kpi.loadingAriaLabel', 'Loading KPI')}
      >
        <div className="h-3 w-24 rounded bg-[var(--border-subtle)] mb-3" />
        <div className="h-8 w-32 rounded bg-[var(--border-subtle)] mb-2" />
        <div className="h-2 w-16 rounded bg-[var(--border-subtle)]" />
      </div>
    );
  }

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springSoft}
      className={cn(
        'rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]',
        'p-5 flex flex-col gap-2',
        className,
      )}
    >
      <p className="text-xs font-medium text-[var(--fg-tertiary)] uppercase tracking-wide">
        {title}
      </p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="flex items-baseline gap-1">
            <span
              ref={numRef}
              className="text-3xl font-bold text-[var(--fg-primary)] tabular-nums"
              aria-label={t('kpi.valueAriaLabel', '{{title}}: {{value}}', {
                title,
                value: format(value),
              })}
            >
              {reduced ? format(value) : '0'}
            </span>
            {unit && (
              <span className="text-sm text-[var(--fg-tertiary)]">{unit}</span>
            )}
          </div>
          {deltaPercent !== undefined && (
            <div
              className={cn(
                'flex items-center gap-1 mt-1 text-xs font-medium',
                deltaSign > 0 && 'text-[var(--success)]',
                deltaSign < 0 && 'text-[var(--danger)]',
                deltaSign === 0 && 'text-[var(--fg-tertiary)]',
              )}
            >
              {deltaSign > 0 ? (
                <TrendingUp size={12} aria-label={t('kpi.trendUpAriaLabel', 'Up')} />
              ) : deltaSign < 0 ? (
                <TrendingDown size={12} aria-label={t('kpi.trendDownAriaLabel', 'Down')} />
              ) : (
                <Minus size={12} aria-label={t('kpi.trendFlatAriaLabel', 'Flat')} />
              )}
              <span>
                {deltaSign > 0 ? '+' : ''}
                {deltaPercent.toFixed(1)}% {deltaPeriodLabel}
              </span>
            </div>
          )}
        </div>
        {sparklineData && sparklineData.length > 1 && (
          <div className="w-24 opacity-80" aria-hidden="true">
            <Sparkline data={sparklineData} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
