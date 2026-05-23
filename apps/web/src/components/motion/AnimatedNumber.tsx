// Number that ticks up to its final value on first render. Matches the
// behavior of macOS Stocks / iOS Activity rings counting up. Useful for KPI
// tiles where a static number feels lifeless next to the rest of the page
// animating in.
//
// Uses framer-motion's MotionValue + useTransform so the work happens on
// the animation frame, not via setState — won't trigger a React re-render
// per tick.

import { animate, useMotionValue, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';

interface Props {
  value: number;
  /** Render hook — format the number for display (e.g. with units). */
  format?: (n: number) => string;
  /** Tween duration in seconds. */
  duration?: number;
  /** Hold off the animation until the parent says so (useful inside Reveal). */
  startWhen?: boolean;
  className?: string;
}

export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 0.9,
  startWhen = true,
  className,
}: Props) {
  const reduced = useReducedMotion();
  // The motion value tracks the displayed number. We start at 0 on first
  // mount so the user sees the count-up effect; subsequent value changes
  // animate from the current motion value to the new target (framer-motion's
  // `animate()` reads the current value when invoked).
  const motion = useMotionValue(0);
  const ref = useRef<HTMLSpanElement | null>(null);

  const formattedValue = useMemo(() => format(value), [value, format]);

  useEffect(() => {
    if (!startWhen) return;
    if (reduced) {
      // Respect prefers-reduced-motion: render final value immediately.
      if (ref.current) ref.current.textContent = formattedValue;
      return;
    }
    const controls = animate(motion, value, {
      duration,
      ease: [0, 0.72, 0.32, 1],
      onUpdate: (n) => {
        if (ref.current) ref.current.textContent = format(n);
      },
    });
    return () => controls.stop();
    // `format` and `motion` intentionally excluded — they are render-stable
    // for our call sites and including them would restart the tween on
    // parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, startWhen, duration, reduced, formattedValue]);

  // First paint shows the formatted starting value (0), or the final value
  // when reduced motion is preferred. The effect drives ref.current.textContent
  // directly without React re-renders.
  return (
    <span ref={ref} className={className} aria-label={formattedValue}>
      {reduced ? formattedValue : format(0)}
    </span>
  );
}
