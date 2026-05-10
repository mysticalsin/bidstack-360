import * as RadixTabs from '@radix-ui/react-tabs';
import { forwardRef, type ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof RadixTabs.List>
>(({ className, ...rest }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn(
      'flex items-center gap-1 border-b border-[var(--border-subtle)]',
      className,
    )}
    {...rest}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof RadixTabs.Trigger>
>(({ className, ...rest }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      // Apple HIG segmented-control-ish look. State styles per design-standards.md:
      // default / hover / focus (3px ring via global) / active (data-state).
      'relative inline-flex h-9 items-center gap-2 rounded-t-md px-3 text-xs font-medium text-[var(--fg-secondary)] transition-colors',
      'hover:text-[var(--fg-primary)]',
      'data-[state=active]:text-[var(--brand-primary)]',
      // Active underline (offset 1px below the border so it overlaps cleanly)
      'data-[state=active]:after:content-[""] data-[state=active]:after:absolute data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-[2px] data-[state=active]:after:bg-[var(--brand-primary)] data-[state=active]:after:rounded-full',
      className,
    )}
    {...rest}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof RadixTabs.Content>
>(({ className, ...rest }, ref) => (
  <RadixTabs.Content
    ref={ref}
    className={cn('pt-4 outline-none', className)}
    {...rest}
  />
));
TabsContent.displayName = 'TabsContent';
