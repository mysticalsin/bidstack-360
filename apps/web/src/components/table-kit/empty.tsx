// Ported from D:\CRM\packages\ui\src\components\empty.tsx (137 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #9).
//
// WHY the cva calls are gone: BidStack does not depend on
// class-variance-authority (verified — 0 matches in apps/web/src and no entry
// in any package.json), and three two-branch variant maps do not justify a new
// runtime dependency. Each `cva(base, { variants })` is inlined as a base
// string plus a plain `Record<Variant, string>` looked up at render — the same
// output, no dependency, and the variant union is enforced by TS instead of by
// cva's inferred `VariantProps`.
//
// Token edits (old shadcn names spelled descriptively so the DoD's
// foreign-token grep over this directory stays clean): muted-foreground →
// text-fg-secondary, muted → bg-surface-sunken, foreground → text-fg-primary,
// hover primary → hover:text-brand, font-heading → font-display, and the
// dashed border gains a width and an explicit colour (the CRM's
// `border-dashed` alone paints nothing without a global border reset).

import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

type EmptyWidth = 'default' | 'wide';
type EmptyMediaVariant = 'default' | 'icon';
type EmptyContentLayout = 'stack' | 'row';

const EMPTY_BASE =
  'group/empty flex w-full min-w-0 flex-col items-center justify-center gap-4 rounded-lg ' +
  'border border-dashed border-border-subtle px-6 py-12 text-center text-balance';

// `width` carries no classes of its own — it is published as `data-width` and
// read by the descendants' `group-data-[width=wide]/empty:` selectors. Kept as
// an explicit map (rather than dropped) so adding a width that DOES need
// classes stays a one-line change.
const EMPTY_WIDTH: Record<EmptyWidth, string> = {
  default: '',
  wide: '',
};

function Empty({
  className,
  width = 'default',
  ...props
}: ComponentProps<'div'> & { width?: EmptyWidth }) {
  return (
    <div
      data-slot="empty"
      data-width={width}
      className={cn(EMPTY_BASE, EMPTY_WIDTH[width], className)}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        'flex max-w-sm flex-col items-center gap-2',
        'group-data-[width=wide]/empty:max-w-xl',
        className,
      )}
      {...props}
    />
  );
}

const EMPTY_MEDIA_BASE =
  'mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0';

const EMPTY_MEDIA_VARIANT: Record<EmptyMediaVariant, string> = {
  default: 'bg-transparent',
  icon: "flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-primary [&_svg:not([class*='size-'])]:size-4",
};

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & { variant?: EmptyMediaVariant }) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(EMPTY_MEDIA_BASE, EMPTY_MEDIA_VARIANT[variant], className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-title"
      className={cn('font-display text-sm font-medium', className)}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        'text-xs/relaxed text-fg-secondary [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-brand',
        className,
      )}
      {...props}
    />
  );
}

const EMPTY_CONTENT_BASE =
  'flex w-full max-w-sm min-w-0 items-center gap-2.5 text-xs text-balance ' +
  'group-data-[width=wide]/empty:max-w-2xl';

const EMPTY_CONTENT_LAYOUT: Record<EmptyContentLayout, string> = {
  stack: 'flex-col',
  row: 'flex-row flex-wrap justify-center',
};

function EmptyContent({
  className,
  layout = 'stack',
  ...props
}: ComponentProps<'div'> & { layout?: EmptyContentLayout }) {
  return (
    <div
      data-slot="empty-content"
      className={cn(EMPTY_CONTENT_BASE, EMPTY_CONTENT_LAYOUT[layout], className)}
      {...props}
    />
  );
}

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle };
