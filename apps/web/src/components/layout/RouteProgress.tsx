// NProgress-style top-of-viewport progress bar. Shows when React Query
// has any in-flight request OR when the user has just navigated to a new
// route (lazy chunks are still loading). Auto-hides when the work
// settles.
//
// Apple/Linear/Vercel all do this — it's the cheapest UX signal that the
// app is alive when a network round-trip is in progress.

import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

export function RouteProgress() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const inFlight = fetching + mutating > 0;
  const reduced = useReducedMotion();

  // Bump on every route change so a fast nav-without-fetch still shows a
  // brief progress hint (otherwise lazy-route loads finish before React
  // Query starts fetching and there's no visible signal). React allows
  // comparing prior state during render to derive new state without an
  // effect — this is the documented escape hatch for "reset state when
  // a prop changes."
  const { pathname } = useLocation();
  const [prevPath, setPrevPath] = useState(pathname);
  const [routeTick, setRouteTick] = useState(0);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setRouteTick((n) => n + 1);
  }

  // Visible state: true while in-flight OR for ~280ms after a route tick.
  // Drive the flash via a separate compare-prev tracker so the effect body
  // only runs the timer (not the setState).
  const [routeFlash, setRouteFlash] = useState(false);
  const [lastFlashedTick, setLastFlashedTick] = useState(0);
  if (routeTick !== lastFlashedTick) {
    setLastFlashedTick(routeTick);
    if (routeTick > 0) setRouteFlash(true);
  }
  useEffect(() => {
    if (!routeFlash) return;
    const h = window.setTimeout(() => setRouteFlash(false), 280);
    return () => window.clearTimeout(h);
  }, [routeFlash]);

  const visible = inFlight || routeFlash;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[150] h-0.5 overflow-hidden"
    >
      <motion.div
        // Hand-rolled "trickle" — the bar drifts forward continuously while
        // there's work, snaps to 100% and fades out when work settles.
        // Easier and lighter than nprogress for a 2-state indicator.
        initial={false}
        animate={visible ? { width: '85%', opacity: 1 } : { width: '100%', opacity: 0 }}
        transition={
          reduced
            ? { duration: 0.001 }
            : visible
              ? { width: { duration: 6, ease: [0.05, 0.7, 0.1, 1] }, opacity: { duration: 0.15 } }
              : { width: { duration: 0.2 }, opacity: { duration: 0.25, delay: 0.1 } }
        }
        className="h-full bg-[var(--brand-primary)] shadow-[0_0_8px_var(--brand-primary)]"
      />
    </div>
  );
}
