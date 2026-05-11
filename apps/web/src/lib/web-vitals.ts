// Zero-dependency Web Vitals reporter. Subscribes to PerformanceObserver
// entries for LCP / CLS / INP and (optionally) hands them off to an
// analytics endpoint. Logs to console in dev so the developer can see
// regressions as they happen.
//
// Why not the `web-vitals` npm package? It's a thin wrapper around the same
// PerformanceObserver API. For our footprint we'd rather skip the extra
// dependency and keep the implementation in-tree so future Apple-aligned
// thresholds (LCP < 2.5s, INP < 200ms, CLS < 0.1) can be tuned without
// touching node_modules.

export type Metric = {
  name: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  id: string;
  navigationType: string;
};

// Apple-aligned thresholds (Core Web Vitals "good" buckets).
const THRESHOLDS: Record<Metric['name'], { good: number; poor: number }> = {
  LCP: { good: 2500, poor: 4000 },
  CLS: { good: 0.1, poor: 0.25 },
  INP: { good: 200, poor: 500 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
};

function rate(name: Metric['name'], value: number): Metric['rating'] {
  const t = THRESHOLDS[name];
  if (value <= t.good) return 'good';
  if (value <= t.poor) return 'needs-improvement';
  return 'poor';
}

function navType(): string {
  const entries = performance.getEntriesByType('navigation');
  const nav = entries[0] as PerformanceNavigationTiming | undefined;
  return nav?.type ?? 'navigate';
}

const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface ObservedLayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

interface PerformanceEventTimingLike extends PerformanceEntry {
  interactionId?: number;
  duration: number;
}

/** Start observing Web Vitals. Returns a cleanup function. */
export function reportWebVitals(onMetric: (metric: Metric) => void): () => void {
  if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  const cleanups: Array<() => void> = [];

  // ── LCP: largest contentful paint ──────────────────────────────────────
  // We watch until the page is backgrounded/unloaded, then report the last
  // observed entry — that's the Web Vitals spec definition.
  let lastLCP: PerformanceEntry | undefined;
  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      lastLCP = entries[entries.length - 1] ?? lastLCP;
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    cleanups.push(() => {
      if (lastLCP) {
        onMetric({
          name: 'LCP',
          value: lastLCP.startTime,
          rating: rate('LCP', lastLCP.startTime),
          id: id(),
          navigationType: navType(),
        });
      }
      lcpObs.disconnect();
    });
  } catch {
    /* Browser doesn't support LCP — drop silently. */
  }

  // ── CLS: cumulative layout shift ───────────────────────────────────────
  let clsValue = 0;
  let clsEntries: ObservedLayoutShift[] = [];
  try {
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as ObservedLayoutShift;
        // Only count shifts that weren't user-initiated.
        if (!e.hadRecentInput) {
          clsEntries.push(e);
          clsValue += e.value;
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
    cleanups.push(() => {
      onMetric({
        name: 'CLS',
        value: clsValue,
        rating: rate('CLS', clsValue),
        id: id(),
        navigationType: navType(),
      });
      clsObs.disconnect();
      clsEntries = [];
    });
  } catch {
    /* drop */
  }

  // ── INP: interaction to next paint ─────────────────────────────────────
  let worstINP = 0;
  try {
    const inpObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEventTimingLike;
        if (e.interactionId && e.duration > worstINP) {
          worstINP = e.duration;
        }
      }
    });
    // `durationThreshold` is part of the Event Timing API but missing from
    // TypeScript's lib.dom shape — cast through the wider init type to set
    // the 16ms floor (filters out micro-events while keeping the spec-
    // recommended granularity for INP).
    inpObs.observe({
      type: 'event',
      buffered: true,
      durationThreshold: 16,
    } as PerformanceObserverInit & { durationThreshold: number });
    cleanups.push(() => {
      if (worstINP > 0) {
        onMetric({
          name: 'INP',
          value: worstINP,
          rating: rate('INP', worstINP),
          id: id(),
          navigationType: navType(),
        });
      }
      inpObs.disconnect();
    });
  } catch {
    /* drop */
  }

  // Report on visibility-hide AND pagehide so we catch both tab-switch and
  // actual unload. The Page Lifecycle spec says visibilitychange is the
  // most reliable signal for "page is leaving."
  const flush = () => {
    cleanups.forEach((fn) => fn());
  };
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush, { once: true });

  return flush;
}

/** Dev-mode console logger. Wire into main.tsx in non-prod. */
export function logVitalsToConsole(metric: Metric): void {
  const tag = metric.rating === 'good' ? '✓' : metric.rating === 'needs-improvement' ? '⚠' : '✗';
  // eslint-disable-next-line no-console
  console.info(
    `${tag} ${metric.name}: ${metric.value.toFixed(metric.name === 'CLS' ? 3 : 0)}${
      metric.name === 'CLS' ? '' : 'ms'
    } (${metric.rating})`,
  );
}
