import * as RadixTabs from '@radix-ui/react-tabs';
import { forwardRef, type ComponentProps, type MouseEvent } from 'react';

import { cn } from '@/lib/cn';
import { useUiSound } from '@/hooks/useUiSound';

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<HTMLDivElement, ComponentProps<typeof RadixTabs.List>>(
  ({ className, ...rest }, ref) => (
    <RadixTabs.List
      ref={ref}
      className={cn('flex items-center gap-1 border-b border-[var(--border-subtle)]', className)}
      {...rest}
    />
  ),
);
TabsList.displayName = 'TabsList';

export const TabsTrigger = forwardRef<HTMLButtonElement, ComponentProps<typeof RadixTabs.Trigger>>(
  ({ className, onClick, ...rest }, ref) => {
    const play = useUiSound();
    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      play('toggle');
      onClick?.(event);
    };

    return (
      <RadixTabs.Trigger
        ref={ref}
        onClick={handleClick}
        className={cn(
          // Apple HIG segmented-control-ish look. State styles per design-standards.md:
          // default / hover / focus-visible (2px ring, WCAG 2.2) / active (data-state) / disabled.
          'relative inline-flex h-9 items-center gap-2 rounded-t-md px-3 text-xs font-medium text-[var(--fg-secondary)] transition-colors',
          'hover:text-[var(--fg-primary)] hover:bg-[var(--surface-sunken)] dark:hover:bg-[rgba(168,85,247,0.06)]',
          // P1 #20: explicit focus ring so keyboard users always have a visible indicator
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-1',
          'active:scale-[0.97]',
          'data-[state=active]:text-[var(--brand-primary)]',
          'data-[disabled]:opacity-50 data-[disabled]:pointer-events-none',
          // Active underline: gradient in dark mode, solid in light
          'data-[state=active]:after:content-[""] data-[state=active]:after:absolute data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-[2px] data-[state=active]:after:bg-[var(--brand-primary)] data-[state=active]:after:rounded-full dark:data-[state=active]:after:bg-gradient-to-r dark:data-[state=active]:after:from-[var(--brand-gradient-start)] dark:data-[state=active]:after:to-[var(--brand-gradient-end)]',
          className,
        )}
        {...rest}
      />
    );
  },
);
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = forwardRef<HTMLDivElement, ComponentProps<typeof RadixTabs.Content>>(
  ({ className, ...rest }, ref) => (
    <RadixTabs.Content ref={ref} className={cn('pt-4 outline-none', className)} {...rest} />
  ),
);
TabsContent.displayName = 'TabsContent';
