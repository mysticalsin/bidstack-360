// Route-level weight control: the bklit chart layer (d3 + motion paths) loads
// as its own chunk after the page shell paints, so the dashboard / account
// chunks stay near their pre-bklit size. Each placeholder reserves the chart's
// box so nothing jumps when the chart arrives (no CLS), and it's aria-hidden
// like the charts themselves (the card's summary and Table carry the data).
import { type ComponentType, lazy, Suspense } from 'react';

import type * as Adapters from './bklit-adapters';

type Mod = typeof Adapters;
const load = () => import('./bklit-adapters');

function lazyChart<P extends object>(name: string, pick: (m: Mod) => ComponentType<P>, reserve: (p: P) => React.CSSProperties | null) {
  // Cast: React 18's lazy() prop typing can't see through a generic P.
  const Lazy = lazy(() => load().then((m) => ({ default: pick(m) }))) as unknown as ComponentType<Record<string, unknown>>;
  function LazyChart(props: P) {
    const box = reserve(props);
    return (
      <Suspense fallback={box ? <div aria-hidden className="viz-bk-reserve" style={box} /> : null}>
        <Lazy {...(props as Record<string, unknown>)} />
      </Suspense>
    );
  }
  LazyChart.displayName = `Lazy${name}`;
  return LazyChart;
}

export const HeroArea = lazyChart('HeroArea', (m) => m.HeroArea, (p) => ({ aspectRatio: p.aspect ?? '3.2 / 1' }));
export const WinRateLine = lazyChart('WinRateLine', (m) => m.WinRateLine, (p) => (p.data.length < 2 ? null : { aspectRatio: '2.6 / 1' }));
export const QuarterBars = lazyChart('QuarterBars', (m) => m.QuarterBars, () => ({ aspectRatio: '2.6 / 1' }));
export const StageFunnel = lazyChart('StageFunnel', (m) => m.StageFunnel, () => ({ aspectRatio: '2.4 / 1' }));
export const StatusRings = lazyChart('StatusRings', (m) => m.StatusRings, (p) => ({ width: p.size ?? 168, height: p.size ?? 168 }));
export const MetricSpark = lazyChart('MetricSpark', (m) => m.MetricSpark, (p) => (p.values.length < 2 ? null : { display: 'inline-block', width: 88, height: 24 }));

/** Warm the chart chunk early (e.g. on route hover) without rendering. */
export const preloadCharts = load;
