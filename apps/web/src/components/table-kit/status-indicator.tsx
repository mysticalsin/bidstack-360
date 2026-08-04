// Ported from D:\CRM\packages\ui\src\components\status-indicator.tsx (107 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #11).
//
// Token rewrites — the CRM's shadcn CSS-var vocabulary → BidStack's own:
//   var(--color-muted-foreground) → var(--fg-secondary)
//   var(--color-info)             → var(--info)
//   var(--color-success)          → var(--success)
//   var(--color-warning)          → var(--warning)
//   var(--color-destructive)      → var(--danger)      (BidStack has no
//                                                       "destructive")
//   text-muted-foreground         → text-fg-secondary
//
// WHY raw var() and not a Tailwind colour utility: the dot's colour also feeds
// `--bloom-color`, which the .bloom-* classes (index.css "Grafted rhythm")
// read to tint the glow. A utility class would set background-color but leave
// the glow on currentColor, so the two would drift apart on any tone.
//
// The status grammar: a 6px square dot + a word. Never a pill, never a colour
// flood — at table density a badge per row turns the grid into confetti.

import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { type Bloom, bloomClass } from '@/lib/table/dither';

import { Spinner } from './spinner';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export type StatusSize = 'default' | 'sm';

const SIZE_CLASS: Record<StatusSize, string> = {
  default: '',
  sm: 'text-xs',
};

const TONE_COLOR: Record<StatusTone, string> = {
  neutral: 'var(--fg-secondary)',
  info: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--danger)',
};

function IndicatorDot({
  tone = 'neutral',
  color,
  pulse = false,
  bloom = 'low',
  className,
  style,
  ...props
}: ComponentProps<'span'> & {
  tone?: StatusTone;
  color?: string;
  pulse?: boolean;
  bloom?: Bloom;
}) {
  const resolved = color ?? TONE_COLOR[tone];

  return (
    <span
      data-slot="indicator-dot"
      data-tone={tone}
      className={cn(
        'inline-block size-1.5 shrink-0',
        pulse && 'animate-pulse',
        bloomClass(bloom),
        className,
      )}
      style={
        {
          backgroundColor: resolved,
          '--bloom-color': resolved,
          ...style,
        } as CSSProperties
      }
      {...props}
    />
  );
}

function StatusIndicator({
  tone = 'neutral',
  color,
  label,
  pulse = false,
  busy = false,
  bloom = 'low',
  size = 'default',
  className,
  ...props
}: Omit<ComponentProps<'span'>, 'color'> & {
  tone?: StatusTone;
  color?: string;
  label: ReactNode;
  pulse?: boolean;
  busy?: boolean;
  bloom?: Bloom;
  size?: StatusSize;
}) {
  return (
    <span
      data-slot="status-indicator"
      data-tone={tone}
      className={cn(
        'inline-flex min-w-0 items-center gap-2 text-fg-secondary',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {busy ? (
        <Spinner className="size-3 shrink-0" />
      ) : (
        <IndicatorDot
          tone={tone}
          color={color}
          pulse={pulse}
          bloom={bloom}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

export { IndicatorDot, StatusIndicator, TONE_COLOR };
