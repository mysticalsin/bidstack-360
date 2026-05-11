// "✓" confirmation chip that flashes for ~1 second when an inline edit
// succeeds, then fades out. Sits inline with the value being edited so the
// user sees the save in the same eye-line where they made the change.
//
// Apple's optimistic-save UX. The chip never blocks: the value updates
// first, the chip appears to confirm, and the user can move on.

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface Props {
  /** When this value flips truthy, the chip flashes once. */
  trigger: unknown;
  /** Fade-out delay in ms. */
  duration?: number;
}

export function SavedFlash({ trigger, duration = 900 }: Props) {
  const [visible, setVisible] = useState(false);
  // Track the last trigger value we acted on. When the parent passes a new
  // one, we derive `visible = true` during render (no setState-in-effect)
  // and let the timer below schedule the fade-out asynchronously.
  const [seenTrigger, setSeenTrigger] = useState(trigger);
  const reduced = useReducedMotion();

  if (trigger !== seenTrigger) {
    setSeenTrigger(trigger);
    if (trigger != null && trigger !== false) setVisible(true);
  }

  useEffect(() => {
    if (!visible) return;
    const handle = window.setTimeout(() => setVisible(false), duration);
    return () => window.clearTimeout(handle);
  }, [visible, duration]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.span
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          transition={{ type: 'spring', stiffness: 360, damping: 22 }}
          aria-hidden
          className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--success)] text-[10px] font-bold text-white"
        >
          ✓
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}
