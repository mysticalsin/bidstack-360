import { cn } from '@/lib/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';

type StatusType = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface StatusPulseProps {
  status: StatusType;
  /** Label for screen readers */
  label: string;
  /** Show the pulsing animation */
  animate?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
} as const;

const colorMap: Record<StatusType, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-muted',
};

const pulseColorMap: Record<StatusType, string> = {
  success: 'shadow-[0_0_0_0_var(--success)]',
  warning: 'shadow-[0_0_0_0_var(--warning)]',
  danger: 'shadow-[0_0_0_0_var(--danger)]',
  info: 'shadow-[0_0_0_0_var(--info)]',
  neutral: 'shadow-[0_0_0_0_var(--fg-muted)]',
};

/**
 * StatusPulse — Live-breathing status indicator with accessible label.
 * Renders a colored dot with optional radial pulse animation.
 */
export function StatusPulse({
  status,
  label,
  animate = true,
  size = 'md',
  className,
}: StatusPulseProps) {
  const reduced = useReducedMotion();

  return (
    <span
      className={cn(
        'inline-block rounded-full flex-shrink-0',
        sizeMap[size],
        colorMap[status],
        animate && !reduced && 'status-pulse-anim',
        animate && !reduced && pulseColorMap[status],
        className,
      )}
      role="status"
      aria-label={label}
    />
  );
}
