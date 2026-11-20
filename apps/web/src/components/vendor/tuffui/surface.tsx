// TUFFUI (https://tuffui.com) · MIT License · Copyright (c) 2026 TUFFUI contributors
// Vendored from registry/surface/surface.tsx at commit 378f3eaa (see ./LICENSE).
// Rewrites at import: bg-surface -> bg-surface-shell; rounded-[1.375rem] -> rounded-xl; p-1.5 -> p-1;
// Panel rounded-2xl -> rounded-lg; Inset rounded-xl bg-foreground/[0.04] -> rounded-md bg-fg-primary/[0.04];
// IconTile rounded-xl bg-foreground/[0.06] text-muted-foreground -> rounded-md bg-fg-primary/[0.06]
// text-fg-secondary; subtitle text-muted-foreground -> text-fg-secondary; @/lib/utils -> @/lib/cn;
// Phosphor Icon type -> lucide LucideIcon (weight="fill" dropped); ShellHeader heading gains text-fg-primary and
// a title attribute for truncated string titles; upstream donation line dropped.
import type { LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/cn';

/*
 * Depth without borders: a `Shell` holds `Panel`s, a panel holds `Inset`
 * blocks. Layers separate only by background (DESIGN.md 9.4).
 */

type DivProps = ComponentProps<'div'>;

/** Outer frame. Headers and footers sit in its padding, content in panels. */
export function Shell({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('@container w-full rounded-xl bg-surface-shell p-1', className)} {...props} />;
}

/** Main content area inside a shell. */
export function Panel({ className, ...props }: DivProps) {
  return <div className={cn('rounded-lg bg-surface-inset', className)} {...props} />;
}

/** One level deeper: code, payloads, details inside a panel. */
export function Inset({ className, ...props }: DivProps) {
  return <div className={cn('rounded-md bg-fg-primary/[0.04]', className)} {...props} />;
}

/** Icon in a tinted square. Pass a lucide icon, or children for anything else. */
export function IconTile({ icon: IconComponent, className, children, ...props }: DivProps & { icon?: LucideIcon }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-md bg-fg-primary/[0.06] text-fg-secondary',
        className,
      )}
      {...props}
    >
      {IconComponent ? <IconComponent className="size-4" /> : children}
    </div>
  );
}

export type ShellHeaderProps = Omit<DivProps, 'title'> & {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right side: a stat, a pill or actions. Vertically centered with the title. */
  aside?: ReactNode;
  /** Heading level for the title. */
  as?: 'h2' | 'h3' | 'h4';
};

/**
 * Header row for a shell. The icon tile sits in line with panel content below
 * it, and everything is vertically centered.
 */
export function ShellHeader({ icon, title, subtitle, aside, as: Heading = 'h3', className, ...props }: ShellHeaderProps) {
  return (
    <div className={cn('flex items-center gap-3 pt-1.5 pr-3.5 pb-3 pl-1.5', className)} {...props}>
      {icon && <IconTile icon={icon} />}
      <div className={cn('min-w-0 flex-1', !icon && 'pl-2')}>
        <Heading
          className="truncate text-[0.9375rem] font-medium text-fg-primary"
          title={typeof title === 'string' ? title : undefined}
        >
          {title}
        </Heading>
        {subtitle && (
          <p className="truncate text-[0.8125rem] text-fg-secondary" title={typeof subtitle === 'string' ? subtitle : undefined}>
            {subtitle}
          </p>
        )}
      </div>
      {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </div>
  );
}
