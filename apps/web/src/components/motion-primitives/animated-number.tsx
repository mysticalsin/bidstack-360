// Vendored from motion-primitives (ibelick, MIT) — components/core/animated-number.tsx
// https://github.com/ibelick/motion-primitives @120f64f. See THIRD_PARTY_NOTICES.md.
// Polo changes: motion.span instead of motion.create() in render (stable
// component identity), a `format` prop, count-up from `from` on mount, an
// sr-only final value with the animated digits aria-hidden (screen readers hear
// one number, not a ticker), and an instant snap under prefers-reduced-motion.
import { motion, type SpringOptions, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';

import { cn } from '@/lib/utils';

export type AnimatedNumberProps = {
  value: number;
  className?: string;
  springOptions?: SpringOptions;
  format?: (n: number) => string;
  /** Starting value on first paint (count-up). Defaults to 0. */
  from?: number;
};

const defaultFormat = (n: number) => Math.round(n).toLocaleString();

export function AnimatedNumber({
  value,
  className,
  springOptions = { stiffness: 90, damping: 22, mass: 0.8 },
  format = defaultFormat,
  from = 0,
}: AnimatedNumberProps) {
  const reduced = useReducedMotion();
  const spring = useSpring(reduced ? value : from, springOptions);
  const display = useTransform(spring, (current) => format(current));

  useEffect(() => {
    if (reduced) spring.jump(value);
    else spring.set(value);
  }, [spring, value, reduced]);

  return (
    <span className={cn('tabular-nums', className)}>
      <span className="sr-only">{format(value)}</span>
      <motion.span aria-hidden="true">{display}</motion.span>
    </span>
  );
}
