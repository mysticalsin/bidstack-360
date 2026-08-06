// Sheet — a side panel that opens over the list instead of replacing it.
//
// This is the single largest contributor to the reference's feel (ADR-2 in
// docs/PLAN-crm-fusion.md). Today a drill-in is a route: the list unmounts, its
// scroll position and filter state are gone, and coming back means re-finding
// where you were. A sheet leaves the list mounted underneath, so "open a record"
// stops being something you leave a page to do.
//
// Built on Radix Dialog, so focus trapping, Esc, scroll locking, `aria-modal`
// and the inert background come from a primitive that already handles them —
// the same base as ui/Dialog.tsx, positioned differently.
//
// TWO THINGS CALLERS MUST GET RIGHT, because the component cannot enforce them:
//
//  1. Render the Sheet as a SIBLING of the list, never inside a branch that the
//     list's loading state can unmount. A refetch that swaps the list for a
//     skeleton must not take the open sheet with it.
//  2. Let the sheet's body fetch its own record by id. A sheet reached by
//     deep-link paints before the list behind it has any data, so it cannot read
//     the record out of the list's cache and expect it to be there.
//
// Motion is CSS (see `.sheet-*` in index.css), not framer-motion: Radix already
// keeps the element mounted through the closing state via `data-state`, and a
// spring here would fight the exit sequencing. `prefers-reduced-motion` drops
// the slide and keeps the fade.

import * as RadixDialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

/**
 * Panel width. Default `lg` (48rem): BidStack's detail surfaces carry bid facts,
 * compliance matrices and scoring tables, all of which are unreadable in the
 * narrow drawer the reference gets away with for a 4-field contact.
 */
export type SheetSize = 'md' | 'lg' | 'xl';

const SIZE: Record<SheetSize, string> = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-3xl',
  xl: 'sm:max-w-5xl',
};

// `title` is omitted from the base props before being redeclared: the DOM's own
// `title` attribute is `string`, and the sheet's title is a node (a record name
// plus a status badge, most of the time).
export interface SheetContentProps
  extends Omit<ComponentProps<typeof RadixDialog.Content>, 'title'> {
  /** Required: it is the accessible name, and Radix warns without it. */
  title: ReactNode;
  /** One line under the title. Omit rather than pass an empty string. */
  description?: ReactNode;
  /** Pinned to the bottom of the panel, outside the scroll area — save/cancel. */
  footer?: ReactNode;
  size?: SheetSize;
  /** Extra controls in the header, left of the close button. */
  headerActions?: ReactNode;
}

export const SheetContent = forwardRef<HTMLDivElement, SheetContentProps>(
  (
    { className, children, title, description, footer, headerActions, size = 'lg', ...rest },
    ref,
  ) => {
    const { t } = useTranslation('common');
    return (
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-[var(--surface-overlay)]" />
        <RadixDialog.Content
          ref={ref}
          // Full width below `sm` — a 48rem panel on a phone is just a worse
          // full-screen page. Above it, the panel is a right-hand column.
          className={cn(
            'sheet-panel fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none',
            SIZE[size],
            className,
          )}
          // Set explicitly. Radix relies on `hideOthers()` to pull the rest of
          // the page out of the accessibility tree instead, and in this app that
          // is not landing — with a sheet open, `#root` carries no `aria-hidden`
          // in either the dev server or a production build. `aria-modal` is the
          // standard way to tell assistive tech to ignore everything outside,
          // and it does not depend on that side effect firing. The same gap
          // affects every Radix modal here, including ui/Dialog; fixing it at
          // the root is tracked separately.
          aria-modal="true"
          {...(description ? {} : { 'aria-describedby': undefined })}
          {...rest}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-6 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="truncate text-base font-medium tracking-tight text-[var(--fg-primary)]">
                {title}
              </RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-sm text-[var(--fg-tertiary)]">
                  {description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <RadixDialog.Close
                aria-label={t('sheet.closeAriaLabel', 'Close panel')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-card)] pointer-coarse:h-11 pointer-coarse:w-11"
              >
                <Icon name="close" size={16} ariaHidden />
              </RadixDialog.Close>
            </div>
          </div>

          {/* The panel is the scroll container, not the page: a long compliance
              matrix scrolls inside the sheet while the list behind stays put. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            {children}
          </div>

          {footer ? (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-6 py-4">
              {footer}
            </div>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    );
  },
);
SheetContent.displayName = 'SheetContent';
