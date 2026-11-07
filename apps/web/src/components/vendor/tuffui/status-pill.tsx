// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/status-pill/status-pill.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: bg-foreground/[0.07] -> bg-fg-primary/[0.07]; text-muted-foreground -> text-fg-secondary;
// text-brand -> text-brand-deep; positive -> success; negative -> danger; @/lib/utils -> @/lib/cn;
// Phosphor CheckCircle/XCircle/Warning/WarningCircle/Info/Clock -> lucide CircleCheck/CircleX/
// TriangleAlert/CircleAlert/Info/Clock; Phosphor weight="bold" -> lucide strokeWidth 2.5;
// useId colons stripped so the mask url() reference is valid in every engine.
import { CircleAlert, CircleCheck, CircleX, Clock, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type StatusTone = 'neutral' | 'brand' | 'positive' | 'negative' | 'warning';

const tones: Record<StatusTone, string> = {
  neutral: 'bg-fg-primary/[0.07] text-fg-secondary',
  brand: 'bg-brand/15 text-brand-deep',
  positive: 'bg-success/15 text-success',
  negative: 'bg-danger/15 text-danger',
  warning: 'bg-warning/15 text-warning',
};

const sizes = {
  sm: { pill: 'h-5 gap-1 px-2 text-[0.6875rem]', icon: 'size-3' },
  md: { pill: 'h-6 gap-1.5 px-2.5 text-xs', icon: 'size-3.5' },
} as const;

const CIRCLE = <circle cx="8" cy="8" r="8" />;
const TRIANGLE = (
  <path d="M8 1.1c.55 0 1.03.29 1.3.76l6.03 10.72c.55.98-.16 2.2-1.3 2.2H1.97c-1.14 0-1.85-1.22-1.3-2.2L6.7 1.86c.27-.47.75-.76 1.3-.76Z" />
);
const BANG = (y: number) => (
  <>
    <path d={`M8 ${y}v3`} />
    <circle cx="8" cy={y + 5.7} r="0.45" fill="black" />
  </>
);

/**
 * Filled status glyphs with heavier cut-out lines than an outline icon, so the
 * check, cross and "!" stay legible at pill sizes.
 */
const glyphs = new Map<LucideIcon, { shape: ReactNode; mark: ReactNode }>([
  [CircleCheck, { shape: CIRCLE, mark: <path d="M4.9 8.3 7 10.3l4.1-4.5" /> }],
  [CircleX, { shape: CIRCLE, mark: <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" /> }],
  [TriangleAlert, { shape: TRIANGLE, mark: BANG(5.2) }],
  [CircleAlert, { shape: CIRCLE, mark: BANG(4.2) }],
  [
    Info,
    {
      shape: CIRCLE,
      mark: (
        <>
          <circle cx="8" cy="4.9" r="0.45" fill="black" />
          <path d="M8 7.6v3.6" />
        </>
      ),
    },
  ],
  [Clock, { shape: CIRCLE, mark: <path d="M8 4.3v3.9l2.5 1.5" /> }],
]);

function Glyph({ glyph, className }: { glyph: { shape: ReactNode; mark: ReactNode }; className: string }) {
  const id = `sp${useId().replace(/[^\w-]/g, '')}`;
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('shrink-0', className)}>
      <mask id={id}>
        <rect width="16" height="16" fill="white" />
        <g fill="none" stroke="black" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          {glyph.mark}
        </g>
      </mask>
      <g fill="currentColor" mask={`url(#${id})`}>
        {glyph.shape}
      </g>
    </svg>
  );
}

export type StatusPillProps = ComponentProps<'span'> & {
  tone?: StatusTone;
  size?: keyof typeof sizes;
  /** Optional icon before the text. The text always stays, so tone is never the only signal. */
  icon?: LucideIcon;
  iconWeight?: 'fill' | 'bold';
};

export function StatusPill({
  tone = 'neutral',
  size = 'md',
  icon: IconComponent,
  iconWeight = 'fill',
  className,
  children,
  ...props
}: StatusPillProps) {
  const glyph = IconComponent && iconWeight === 'fill' ? glyphs.get(IconComponent) : undefined;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium',
        sizes[size].pill,
        tones[tone],
        className,
      )}
      {...props}
    >
      {glyph ? (
        <Glyph glyph={glyph} className={sizes[size].icon} />
      ) : IconComponent ? (
        <IconComponent
          strokeWidth={iconWeight === 'bold' ? 2.5 : 2}
          className={cn('shrink-0', sizes[size].icon)}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  );
}

/** Small mono chip for identifiers: transports, models, branches, file types. */
export function Tag({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-md bg-fg-primary/[0.06] px-1.5 font-mono text-[0.6875rem] text-fg-secondary',
        className,
      )}
      {...props}
    />
  );
}
