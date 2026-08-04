// Ported from D:\CRM\packages\ui\src\components\card.tsx (122 lines).
// Light-rewrite tier (ROUND2-ULTRAPLAN manifest #8).
//
// NAMESPACED DELIBERATELY: BidStack's own components/ui/Card.tsx (the
// rounded-xl glass surface used by 40+ pages) is untouched. This is the
// grafted *slotted* card — a header/content/footer/panel set the dashboard and
// table tiers compose. Two cards, two jobs; the import path is the disambiguator.
//
// Token rewrites:
//   bg-card               → bg-surface-card      (×2)
//   text-muted-foreground → text-fg-secondary    (×2)
//   bare `border`         → `border border-border-subtle`
//
// WHY the explicit border colour: the CRM's globals.css sets a universal
// `* { border-color: var(--border) }` base rule. BidStack has no such rule, so
// a bare `border` here would render the browser default (currentColor) — a
// black 1px box in light mode. Every border in this graft names its token.

import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('flex flex-col gap-3', className)} {...props} />;
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min items-center gap-x-4 gap-y-1 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] sm:has-data-[slot=card-description]:grid-rows-[auto_auto]',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-pretty text-sm font-medium', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('hidden text-pretty text-xs/relaxed text-fg-secondary sm:block', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 flex items-center gap-2 self-center justify-self-end',
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface-card p-4 md:p-6',
        className,
      )}
      {...props}
    />
  );
}

function CardPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-panel"
      className={cn(
        'flex h-80 min-h-0 flex-col overflow-hidden rounded-lg border border-border-subtle bg-surface-card',
        className,
      )}
      {...props}
    />
  );
}

function CardPanelEmpty({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-panel-empty"
      className={cn(
        'flex flex-1 items-center justify-center p-6 text-center text-fg-secondary text-xs',
        className,
      )}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-3 border-t border-border-subtle pt-4', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardPanelEmpty,
  CardTitle,
};
