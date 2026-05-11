// Apple-style tooltip primitive. Wraps Radix Tooltip with our token system
// and spring motion so hover hints feel like macOS Help Tags — appear with
// a slight scale-up, disappear cleanly. 250ms default delay matches Apple.

import * as RadixTooltip from '@radix-ui/react-tooltip';
import { motion, useReducedMotion } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';

import { springSnap } from '@/lib/motion';

interface Props {
  children: ReactNode;
  content: ReactNode;
  /** Delay before the tooltip appears, in ms. Apple default ≈ 250ms. */
  delay?: number;
  /** Side of the trigger to render on. Defaults to "top". */
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Disable rendering entirely (useful when the trigger isn't focusable). */
  disabled?: boolean;
}

/** Single tooltip with built-in Provider. Use for one-offs. For multiple
 *  tooltips on the same page, prefer wrapping the root in `<TooltipRoot>`
 *  yourself and using `<TooltipBare>` to skip per-instance providers. */
export function Tooltip({ children, content, delay = 250, side = 'top', disabled }: Props) {
  if (disabled) return <>{children}</>;
  return (
    <RadixTooltip.Provider delayDuration={delay} disableHoverableContent>
      <TooltipBare content={content} side={side}>
        {children}
      </TooltipBare>
    </RadixTooltip.Provider>
  );
}

/** Provider-less variant — use under a single top-level `<RadixTooltip.Provider>`. */
export const TooltipBare = forwardRef<HTMLDivElement, Omit<Props, 'delay' | 'disabled'>>(
  ({ children, content, side = 'top' }, _ref) => {
    return (
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content asChild side={side} sideOffset={6}>
            <TooltipBody>{content}</TooltipBody>
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    );
  },
);
TooltipBare.displayName = 'TooltipBare';

const TooltipBody = forwardRef<HTMLDivElement, { children: ReactNode }>(({ children }, ref) => {
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 2 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      transition={springSnap}
      // Radix sets `data-state`; we don't need to wire exit because Radix
      // unmounts after a short timeout. The motion exit fires while the
      // node is still in the DOM thanks to AnimatePresence-like handling
      // inside Radix's Content (it waits for animation events).
      className="z-50 max-w-xs rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 py-1.5 text-xs text-[var(--fg-primary)] shadow-[var(--shadow-md)]"
    >
      {children}
    </motion.div>
  );
});
TooltipBody.displayName = 'TooltipBody';

// Re-export the provider so consumers can wrap the app once if desired.
export const TooltipProvider = RadixTooltip.Provider;
