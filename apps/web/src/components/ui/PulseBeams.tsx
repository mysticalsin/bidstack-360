import { motion, useReducedMotion } from 'framer-motion';
import { useId, type SVGProps } from 'react';

import { cn } from '@/lib/cn';

interface PulseBeamsProps extends SVGProps<SVGSVGElement> {
  intensity?: 'subtle' | 'strong';
}

const intensityMap = {
  subtle: 'opacity-45',
  strong: 'opacity-75',
} as const;

export function PulseBeams({ className, intensity = 'subtle', ...rest }: PulseBeamsProps) {
  const reduced = useReducedMotion();
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradientId = `pulse-beams-${id}`;

  return (
    <svg
      viewBox="0 0 720 240"
      fill="none"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full',
        intensityMap[intensity],
        className,
      )}
      aria-hidden
      {...rest}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="720" y2="240">
          <stop stopColor="var(--brand-primary)" stopOpacity="0" />
          <stop offset="0.46" stopColor="var(--brand-primary)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--tag-jade-fg)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[
        'M-20 58 C150 8 246 154 382 96 C500 46 590 86 742 34',
        'M-18 150 C120 190 242 58 386 132 C506 194 608 132 742 182',
        'M26 230 C182 152 270 210 396 166 C514 124 602 42 724 82',
      ].map((d, index) => (
        <motion.path
          key={d}
          d={d}
          stroke={`url(#${gradientId})`}
          strokeWidth={index === 1 ? 2.4 : 1.6}
          strokeLinecap="round"
          strokeDasharray="22 34"
          initial={false}
          animate={reduced ? undefined : { strokeDashoffset: [0, -112] }}
          transition={
            reduced ? undefined : { duration: 7 + index * 1.2, repeat: Infinity, ease: 'linear' }
          }
        />
      ))}
      {[
        { cx: 132, cy: 54 },
        { cx: 368, cy: 130 },
        { cx: 584, cy: 82 },
      ].map((node, index) => (
        <motion.circle
          key={`${node.cx}-${node.cy}`}
          cx={node.cx}
          cy={node.cy}
          r="4"
          fill="var(--brand-primary)"
          initial={false}
          animate={reduced ? undefined : { opacity: [0.35, 1, 0.35], scale: [1, 1.55, 1] }}
          transition={
            reduced
              ? undefined
              : { duration: 2.8, delay: index * 0.42, repeat: Infinity, ease: 'easeInOut' }
          }
        />
      ))}
    </svg>
  );
}
