import { motion } from 'framer-motion';

import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';

interface ProgressRingProps {
  /** Progress value 0–100 */
  value: number;
  /** Ring diameter in px */
  size?: number;
  /** Stroke width in px */
  strokeWidth?: number;
  /** Gradient start/end colors */
  colors?: [string, string];
  /** Content rendered in the center */
  children?: React.ReactNode;
  className?: string;
  /** ARIA label for the progress ring */
  label?: string;
}

/**
 * ProgressRing — Circular progress indicator with gradient stroke and
 * animated fill. Used for health scores, completion percentages, and
 * win probability displays.
 */
export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 4,
  colors = ['var(--brand-primary)', 'var(--success)'],
  children,
  className,
  label,
}: ProgressRingProps) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const gradientId = `prog-ring-${size}-${clamped}`;

  return (
    <div
      className={cn('inline-flex items-center justify-center relative', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `${clamped}% complete`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors[0]} />
            <stop offset="100%" stopColor={colors[1]} />
          </linearGradient>
        </defs>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--border-subtle)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Fill */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: reduced ? offset : circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={
            reduced ? { duration: 0 } : { type: 'spring', stiffness: 60, damping: 15, delay: 0.2 }
          }
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}
