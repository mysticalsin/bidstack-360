// Apple-style "rich tooltip" for previewing record details on hover. Used
// for company logos in the cockpit + table cells where the full context
// would otherwise require a click. Larger, slower-appearing than Tooltip;
// designed to be read, not glanced at.

import * as RadixHoverCard from '@radix-ui/react-hover-card';
import { motion, useReducedMotion } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';

import { springModal } from '@/lib/motion';

interface Props {
  children: ReactNode;
  content: ReactNode;
  /** Delay before showing, in ms. 350ms is the macOS "deliberate hover" feel. */
  openDelay?: number;
  closeDelay?: number;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function HoverCard({
  children,
  content,
  openDelay = 350,
  closeDelay = 120,
  side = 'right',
}: Props) {
  return (
    <RadixHoverCard.Root openDelay={openDelay} closeDelay={closeDelay}>
      <RadixHoverCard.Trigger asChild>{children}</RadixHoverCard.Trigger>
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content asChild side={side} sideOffset={8} align="start">
          <HoverCardBody>{content}</HoverCardBody>
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
    </RadixHoverCard.Root>
  );
}

const HoverCardBody = forwardRef<HTMLDivElement, { children: ReactNode }>(({ children }, ref) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: 2, scale: 0.99 }}
      transition={springModal}
      className="z-50 w-[min(320px,92vw)] rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] p-4 shadow-[var(--shadow-lg)]"
    >
      {children}
    </motion.div>
  );
});
HoverCardBody.displayName = 'HoverCardBody';
