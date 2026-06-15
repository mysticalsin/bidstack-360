import * as RadixDialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export const DialogContent = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof RadixDialog.Content> & { title: string; description?: ReactNode }
>(({ className, children, title, description, ...rest }, ref) => {
  const { t } = useTranslation('common');
  const hasDesc = Boolean(description);
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(560px,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl dark:rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none ' +
            'dark:bg-[var(--surface-glass)] dark:backdrop-blur-xl dark:border-[var(--border-glow-strong)] dark:shadow-[0_0_40px_rgba(94,106,210,0.12),0_0_0_1px_rgba(94,106,210,0.2)]',
          className,
        )}
        {...(!hasDesc ? { 'aria-describedby': undefined } : {})}
        {...rest}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <RadixDialog.Title className="text-sm font-semibold text-[var(--fg-primary)]">
            {title}
          </RadixDialog.Title>
          <RadixDialog.Close
            aria-label={t('dialog.closeAriaLabel', 'Close')}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--fg-tertiary)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-card)] pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <span aria-hidden className="text-lg leading-none">
              ×
            </span>
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
  );
});
DialogContent.displayName = 'DialogContent';
