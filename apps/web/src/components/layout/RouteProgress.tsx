// NProgress-style top-of-viewport progress bar. Shows when React Query
// has any in-flight request OR when the user has just navigated to a new
// route (lazy chunks are still loading). Auto-hides when the work
// settles.
//
// Apple/Linear/Vercel all do this — it's the cheapest UX signal that the
// app is alive when a network round-trip is in progress.

import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

import { usePreferences } from '@/stores/preferences';

export function RouteProgress() {
  const fetching = useIsFetching();
  const mutating = useIsMutating();
  const inFlight = fetching + mutating > 0;
  const motionPref = usePreferences((s) => s.motion);
  const reduced =
    motionPref === 'reduced' ||
    (motionPref !== 'full' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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
      {/* CSS instead of framer-motion so the entry can paint before that chunk evaluates. */}
      <div
        className="h-full bg-[var(--brand-primary)] shadow-[0_0_8px_var(--brand-primary)]"
        style={{
          width: visible ? '85%' : '100%',
          opacity: visible ? 1 : 0,
          transitionProperty: 'width, opacity',
          transitionDuration: reduced ? '1ms' : visible ? '6s' : '200ms',
          transitionTimingFunction: visible ? 'cubic-bezier(0.05, 0.7, 0.1, 1)' : 'ease',
        }}
      />
    </div>
  );
}
