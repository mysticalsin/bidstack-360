import * as RadixDialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof RadixDialog.Content> & { title: string; description?: ReactNode }
>(({ className, children, title, description, ...rest }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 z-40 bg-[var(--surface-overlay)] backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[min(560px,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
        <RadixDialog.Title className="text-sm font-semibold text-[var(--fg-primary)]">
          {title}
        </RadixDialog.Title>
        <RadixDialog.Close
          aria-label="Close"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)]"
        >
          ×
        </RadixDialog.Close>
      </div>
      {description ? (
        <RadixDialog.Description className="px-5 pt-3 text-xs text-[var(--fg-secondary)]">
          {description}
        </RadixDialog.Description>
      ) : null}
      <div className="px-5 py-4">{children}</div>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
DialogContent.displayName = 'DialogContent';
