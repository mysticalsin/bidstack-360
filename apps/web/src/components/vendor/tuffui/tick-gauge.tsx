// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/tick-gauge/tick-gauge.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: "use client" dropped; @/components/ui/surface -> ./surface; @/lib/utils -> @/lib/cn;
// Phosphor Gauge -> lucide Gauge; RollingNumber -> a plain tabular span (no rolling digits in Polo);
// stroke-brand -> stroke-brand-deep; stroke-negative -> stroke-danger; stroke-foreground/N -> stroke-fg-primary/N;
// stroke-foreground -> stroke-fg-primary; fill-muted-foreground / text-muted-foreground -> fill-fg-secondary /
// text-fg-secondary; big number gains text-fg-primary; double quotes -> single quotes; upstream donation line dropped.
import { Gauge } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { CSS_EASE_OUT } from '@/lib/motion-tokens';

import { Panel, Shell, ShellHeader } from './surface';

export type TickGaugeProps = {
  /** Current value, 0–1. */
  value: number;
  title: string;
  subtitle?: string;
  /** Goal, 0–1. Ticks between the value and the goal show the shortfall. */
  target?: number;
  /** Label under the right end, e.g. "SLO 99%". */
  targetLabel?: string;
  /** Line under the big number, e.g. "412 of 5,980 failed". */
  caption?: string;
  /** Formats the big number. Defaults to one decimal percent. */
  format?: (value: number) => string;
  /** Number of ticks on the arc. */
  ticks?: number;
  /** Header aside, e.g. a status pill. */
  aside?: React.ReactNode;
  className?: string;
};

// The arc spans 220°, opening at the bottom.
const SWEEP = 220;
const CX = 120;
const CY = 112;
const OUTER = 96;
const INNER = 78;

const round = (n: number) => Math.round(n * 100) / 100;

const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  // Rounded so server and client trig agree and hydration matches.
  return [round(CX + r * Math.cos(a)), round(CY + r * Math.sin(a))] as const;
};

/**
 * A meter drawn as ticks around an arc. Filled ticks are the value; when a
 * target is set, the ticks between the value and the target turn red, so the
 * gap reads at a glance.
 */
export function TickGauge({
  value,
  title,
  subtitle,
  target,
  targetLabel,
  caption,
  format = (v) => `${(v * 100).toFixed(1)}%`,
  ticks = 44,
  aside,
  className,
}: TickGaugeProps) {
  const reduce = useReducedMotion();
  // Ticks fill in order on mount; later changes recolor them in place.
  const [shown, setShown] = useState(reduce ? value : 0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), reduce ? 0 : ticks * 12 + 240);
    return () => clearTimeout(id);
  }, [reduce, ticks]);

  const v = Math.min(Math.max(shown, 0), 1);
  const goal = target === undefined ? undefined : Math.min(Math.max(target, 0), 1);
  const angle = (t: number) => -SWEEP / 2 + SWEEP * t;

  return (
    <Shell className={cn('max-w-sm', className)}>
      <ShellHeader icon={Gauge} title={title} subtitle={subtitle} aside={aside} />
      <Panel className="px-4 pt-5 pb-4">
        <div
          role="meter"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={value}
          aria-valuetext={`${format(value)}${caption ? `, ${caption}` : ''}${targetLabel ? `, target ${targetLabel}` : ''}`}
          className="relative mx-auto w-full max-w-72"
        >
          <svg viewBox="0 0 240 196" className="block w-full overflow-visible" aria-hidden="true">
            {Array.from({ length: ticks }, (_, i) => {
              const t = i / (ticks - 1);
              const [x1, y1] = polar(angle(t), INNER);
              const [x2, y2] = polar(angle(t), OUTER);
              const filled = t <= v + 1e-9;
              const short = !filled && goal !== undefined && t <= goal + 1e-9 && mounted;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  className={cn(
                    filled ? 'stroke-brand-deep' : short ? 'stroke-danger' : 'stroke-fg-primary/10',
                  )}
                  style={{
                    transition: reduce ? undefined : `stroke 240ms ${CSS_EASE_OUT}`,
                    transitionDelay: reduce || mounted ? undefined : `${i * 12}ms`,
                  }}
                />
              );
            })}

            {goal !== undefined &&
              (() => {
                const [x1, y1] = polar(angle(goal), INNER - 8);
                const [x2, y2] = polar(angle(goal), OUTER + 6);
                return (
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    strokeWidth={1.5}
                    strokeDasharray="2 3"
                    className="stroke-fg-primary"
                  />
                );
              })()}

            <text
              x={polar(angle(0), OUTER)[0]}
              y={polar(angle(0), OUTER)[1] + 22}
              textAnchor="middle"
              fontSize="11"
              className="fill-fg-secondary"
            >
              {format(0).replace(/\.0+(?=%|$)/, '')}
            </text>
            {targetLabel && (
              <text
                x={polar(angle(1), OUTER)[0]}
                y={polar(angle(1), OUTER)[1] + 22}
                textAnchor="middle"
                fontSize="11"
                className="fill-fg-secondary"
              >
                {targetLabel}
              </text>
            )}
          </svg>

          {/* Centered on the arc's pivot, not on the box. */}
          <div
            className="absolute inset-x-0 flex -translate-y-1/2 flex-col items-center text-center"
            style={{ top: `${((CY - 14) / 196) * 100}%` }}
          >
            <span className="text-3xl font-medium tracking-tight text-fg-primary tabular-nums">
              {format(value)}
            </span>
            {caption && <p className="mt-1 text-xs text-fg-secondary">{caption}</p>}
          </div>
        </div>
      </Panel>
    </Shell>
  );
}
