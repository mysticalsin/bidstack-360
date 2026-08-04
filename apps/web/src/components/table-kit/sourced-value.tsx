// Ported from D:\CRM\packages\ui\src\components\sourced-value.tsx (70 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #14) — the strip's renderer.
//
// RETARGETED, not ported: the CRM's own tooltip.tsx is NOT on the graft list.
// The upstream three-part composition
//   <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger>
//            <TooltipContent>{source}</TooltipContent></Tooltip>
// collapses onto BidStack's tested single-prop Tooltip
// (components/ui/Tooltip.tsx), which already wraps Radix, owns its Provider,
// and animates with springSnap. Two consequences, both deliberate:
//   1. Panel styling (max-w, padding, border, shadow) now comes from
//      BidStack's TooltipBody — the CRM's `max-w-sm px-3 py-2` is dropped so
//      provenance panels match every other hint in the app.
//   2. `side` is exposed so a table cell near the viewport edge can flip the
//      panel; upstream had no such escape hatch and clipped on the last row.
//
// Token rewrite: text-muted-foreground → (none survived — the CRM's copy sat
// on opacity, which is theme-invariant and carried over as-is).
//
// The contract this file encodes: a value that came from an agent NEVER
// renders bare. It renders with a dotted underline that says "there is a
// receipt", and the receipt is one hover away. No underline ⇒ a human typed it.

import type { ReactElement, ReactNode } from 'react';

import { Tooltip } from '@/components/ui/Tooltip';

export const SOURCED_VALUE = 'underline decoration-dotted underline-offset-4';

export function SourcedValue({
  children,
  source,
  side = 'top',
}: {
  children: ReactElement;
  source: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}) {
  return (
    <Tooltip content={source} side={side}>
      {children}
    </Tooltip>
  );
}

export function Provenance({
  claim,
  reasons,
  observedAt,
  sourceUrl,
}: {
  claim: string;
  reasons: string[];
  observedAt?: string;
  sourceUrl?: string | null;
}) {
  return (
    <span className="flex flex-col gap-1.5">
      <span className="font-medium">{claim}</span>

      {reasons.length > 0 ? (
        <span className="flex flex-col gap-0.5 opacity-80">
          {reasons.map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </span>
      ) : null}

      {observedAt || sourceUrl ? (
        <span className="flex flex-wrap items-center gap-x-2 opacity-60">
          {observedAt ? <span>{observedAt}</span> : null}
          {sourceUrl ? <span className="truncate">{hostOf(sourceUrl)}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

// Hostname only — a full URL in a tooltip wraps to three lines and buries the
// claim. Falls back to the raw string when the value isn't parseable rather
// than throwing inside a render.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
