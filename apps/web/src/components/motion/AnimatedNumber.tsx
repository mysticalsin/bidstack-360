// Settled KPI figure. The count-up tween ran on the main thread for most of a
// second after first paint, which is the dashboard's total-blocking-time miss.
// The accessible name and the visible text are the final value.

interface Props {
  value: number;
  /** Render hook — format the number for display (e.g. with units). */
  format?: (n: number) => string;
  /** Kept so existing call sites compile. The figure no longer tweens. */
  duration?: number;
  startWhen?: boolean;
  className?: string;
}

export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: Props) {
  const formattedValue = format(value);
  return (
    <span className={className} aria-label={formattedValue}>
      {formattedValue}
    </span>
  );
}
