// Ported from D:\CRM\packages\ui\src\components\dropdown-menu.tsx (272 lines).
// Heavy-rewrite tier (ROUND2-ULTRAPLAN manifest #6) — the export surface and
// every prop is byte-for-byte the CRM's so the grafted data-table can consume
// it unchanged; only the token vocabulary, the animation mechanism and the
// Radix entrypoint differ.
//
// Three structural swaps against the source:
//
//  1. `radix-ui` (the unified meta-package) → `@radix-ui/react-dropdown-menu`.
//     BidStack already depends on four scoped Radix packages
//     (dialog/hover-card/tabs/tooltip) and most of this menu's transitive
//     tree — popper, portal, presence, roving-focus, dismissable-layer — was
//     already installed. Pulling the meta-package would have duplicated all of
//     it; the scoped package is the one new dependency.
//
//  2. `tw-animate-css` utilities → ./dropdown-menu.css. See that file for why.
//     `data-open:` / `data-closed:` become explicit `data-[state=open|closed]:`
//     — the scoped Radix package emits `data-state`, and the explicit form is
//     unambiguous on every Tailwind 4.x.
//
//  3. shadcn token names → BidStack's vocabulary (index.css @theme + :root).
//     bg-popover→bg-surface-raised, text-popover-foreground→text-fg-primary,
//     bg-accent→bg-surface-hover, text-accent-foreground→text-fg-primary,
//     text-muted-foreground→text-fg-secondary, text-destructive→text-danger,
//     bg-destructive/10→bg-danger-tint, bg-border→bg-border-subtle,
//     ring-1 ring-foreground/10→border border-border-default.
//     Elevation is spelled `shadow-[var(--shadow-lg)]`: BidStack's shadow
//     scale lives on CSS variables, and it is the same elevation every other
//     floating surface uses (ui/HoverCard.tsx:49, contacts/ContactContextMenu.tsx:131).

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

import './dropdown-menu.css';

// Shared surface chrome for the two floating panels. `tk-menu-surface` is the
// hook ./dropdown-menu.css animates on — keep it first so a caller's className
// can still override anything after it via tailwind-merge.
const MENU_SURFACE =
  'tk-menu-surface z-50 rounded-lg border border-border-default bg-surface-raised p-1 text-fg-primary shadow-[var(--shadow-lg)]';

// Row chrome shared by Item / CheckboxItem / RadioItem / SubTrigger.
// `outline-none` matches the source's outline-hidden intent; the app-wide
// `*:focus-visible` ring in index.css is declared outside any cascade layer,
// so it still wins for keyboard users and the row never loses its focus
// indicator (WCAG 2.4.11) — the focus tint alone would not carry 3:1.
const MENU_ROW =
  "relative flex cursor-default items-center gap-2 rounded-sm text-xs outline-none select-none " +
  "focus:bg-surface-hover focus:text-fg-primary " +
  "data-[inset]:pl-7 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

function DropdownMenu({ ...props }: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({ ...props }: ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({ ...props }: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          MENU_SURFACE,
          // The two Radix custom properties keep the panel bounded by the
          // viewport and matched to its trigger — the column/facet menus in
          // the data-table rely on both.
          'max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-32',
          // Scrollable while open; clipped on the way out so the exit scale
          // cannot expose a scrollbar mid-animation.
          'overflow-x-hidden overflow-y-auto data-[state=closed]:overflow-hidden',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({ ...props }: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: 'default' | 'destructive';
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        'group/dropdown-menu-item',
        MENU_ROW,
        'px-2 py-2',
        // Pull every descendant (shortcut text, icons) up to the focused
        // foreground — except on a destructive row, which keeps its own red.
        'not-data-[variant=destructive]:focus:**:text-fg-primary',
        'data-[variant=destructive]:text-danger data-[variant=destructive]:focus:bg-danger-tint data-[variant=destructive]:focus:text-danger',
        'data-[variant=destructive]:[&_svg]:text-danger',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(MENU_ROW, 'py-2 pr-8 pl-2', 'focus:**:text-fg-primary', className)}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(MENU_ROW, 'py-2 pr-8 pl-2', 'focus:**:text-fg-primary', className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('px-2 py-2 text-xs text-fg-secondary data-[inset]:pl-7', className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  // -mx-1 cancels the panel's p-1 so the rule spans edge to edge.
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 h-px bg-border-subtle', className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        'ml-auto text-xs tracking-widest text-fg-secondary group-focus/dropdown-menu-item:text-fg-primary',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        MENU_ROW,
        'px-2 py-2',
        'not-data-[variant=destructive]:focus:**:text-fg-primary',
        // An open sub-menu keeps its trigger lit — otherwise the pointer
        // leaves the row and the trail back to the parent disappears.
        'data-[state=open]:bg-surface-hover data-[state=open]:text-fg-primary',
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(MENU_SURFACE, 'min-w-24 overflow-hidden', className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
