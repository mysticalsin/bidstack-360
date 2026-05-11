// Dev-only HUD that surfaces Core Web Vitals + React Query fetch counts
// in the corner of the viewport. Opt in via "?devhud=1" or localStorage.
//
// This is *only* mounted when the flag is set, so production users never
// see it. Dev users get a tight feedback loop on regressions: LCP/CLS/INP
// numbers update in place as the observers fire.

import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { reportWebVitals, type Metric } from '@/lib/web-vitals';

function flagOn(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('devhud') === '1') {
    try {
      localStorage.setItem('bidstack-devhud', '1');
    } catch {
      /* ignore */
    }
    return true;
  }
  try {
    return localStorage.getItem('bidstack-devhud') === '1';
  } catch {
    return false;
  }
}

export function WebVitalsHud() {
  const [enabled, setEnabled] = useState(() => flagOn());
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const fetching = useIsFetching();
  const mutating = useIsMutating();

  useEffect(() => {
    if (!enabled) return;
    return reportWebVitals((m) => {
      setMetrics((prev) => ({ ...prev, [m.name]: m }));
    });
  }, [enabled]);

  if (!enabled) return null;

  const fmt = (m: Metric) => (m.name === 'CLS' ? m.value.toFixed(3) : `${Math.round(m.value)}ms`);

  return (
    <div
      role="region"
      aria-label="Dev metrics HUD"
      className="pointer-events-auto fixed bottom-3 left-3 z-[400] w-56 rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-2 text-[10px] font-mono shadow-[var(--shadow-md)]"
    >
      <div className="mb-1 flex items-center justify-between text-[var(--fg-tertiary)]">
        <span>DEV HUD</span>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.removeItem('bidstack-devhud');
            } catch {
              /* ignore */
            }
            setEnabled(false);
          }}
          aria-label="Hide dev HUD"
          className="hover:text-[var(--fg-primary)]"
        >
          ×
        </button>
      </div>
      {(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const).map((name) => {
        const m = metrics[name];
        return (
          <div key={name} className="flex items-center justify-between">
            <span className="text-[var(--fg-secondary)]">{name}</span>
            {m ? (
              <span
                style={{
                  color:
                    m.rating === 'good'
                      ? 'var(--success)'
                      : m.rating === 'needs-improvement'
                        ? 'var(--warning)'
                        : 'var(--danger)',
                }}
              >
                {fmt(m)}
              </span>
            ) : (
              <span className="text-[var(--fg-tertiary)]">—</span>
            )}
          </div>
        );
      })}
      <div className="mt-1 flex items-center justify-between border-t border-[var(--border-subtle)] pt-1 text-[var(--fg-secondary)]">
        <span>fetch / mut</span>
        <span className="text-[var(--fg-primary)]">
          {fetching} / {mutating}
        </span>
      </div>
    </div>
  );
}
