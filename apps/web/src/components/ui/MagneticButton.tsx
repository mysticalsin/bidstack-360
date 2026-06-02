import { type ReactNode, useRef, useState, useCallback } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { cn } from '@/lib/cn';

interface MagneticButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Strength of the magnetic pull (default: 0.3) */
  strength?: number;
  /** Scale effect on hover (default: 1.05) */
  hoverScale?: number;
}

/**
 * MagneticButton — A premium interaction component that gently pulls toward the cursor.
 * Common in high-end design systems (e.g., Apple, boutique studios).
 * Respects prefers-reduced-motion by falling back to standard button behavior.
 */
export function MagneticButton({
  children,
  className,
  onClick,
  strength = 0.3,
  hoverScale = 1.05,
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const reduced = useReducedMotion();

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (reduced || !ref.current) return;
      const { clientX, clientY } = e;
      const { left, top, width, height } = ref.current.getBoundingClientRect();
      const x = (clientX - (left + width / 2)) * strength;
      const y = (clientY - (top + height / 2)) * strength;
      setPosition({ x, y });
    },
    [reduced, strength],
  );

  const handleMouseLeave = useCallback(() => {
    setPosition({ x: 0, y: 0 });
  }, []);

  return (
    <motion.button
      ref={ref}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full bg-[var(--brand-primary)] px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-press)]',
        // P1 #20: WCAG 2.2 — explicit focus-visible ring (2px, 3:1 contrast, offset so it clears the rounded shape)
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2',
        className,
      )}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      animate={{ x: position.x, y: position.y }}
      whileHover={reduced ? undefined : { scale: hoverScale }}
      whileTap={reduced ? undefined : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 350, damping: 25, mass: 0.5 }}
    >
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
}
