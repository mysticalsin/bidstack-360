// Visually-hidden aria-live region for ephemeral stage-change / mutation
// announcements. Distinct from the Toast region: toasts are visible to
// everyone but screen readers only hear "polite" updates if the relevant
// node is wired with role="status" + aria-live. We dedicate a single
// always-mounted node so any feature can call `announce()` and the right
// thing happens.

import { useEffect, useState } from 'react';

import { useAnnouncer } from './useAnnouncer';

export function LiveAnnouncer() {
  const message = useAnnouncer((s) => s.message);
  const tick = useAnnouncer((s) => s.tick);
  // Clear the message a beat after it fires so the same text can be
  // announced again. The compare-prev pattern (`if (tick !== seenTick)`)
  // derives the displayed string during render so we don't set state from
  // inside an effect — the effect is now timer-only.
  const [displayed, setDisplayed] = useState('');
  const [seenTick, setSeenTick] = useState(0);
  if (tick !== seenTick) {
    setSeenTick(tick);
    if (message) setDisplayed(message);
  }
  useEffect(() => {
    if (!displayed) return;
    const h = window.setTimeout(() => setDisplayed(''), 1500);
    return () => window.clearTimeout(h);
  }, [displayed]);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {displayed}
    </div>
  );
}
