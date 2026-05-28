/**
 * Modal — thin Radix Dialog wrapper for blocking full-screen modals.
 *
 * Provides focus trap, Escape-to-close, and return-focus-on-close via
 * @radix-ui/react-dialog, without imposing a layout on the inner content.
 * Use this instead of a raw `div role="dialog"` for any blocking overlay.
 *
 * For simple destructive confirmations, prefer the imperative `confirm()`
 * from `@/components/ui/ConfirmDialog` instead.
 *
 * WCAG 2.1.2 compliance: Radix Content handles the focus trap automatically.
 *
 * @example
 * <Modal open={show} onClose={() => setShow(false)} labelId="my-title-id">
 *   <div className="bg-[var(--surface)] rounded-2xl p-6">
 *     <h2 id="my-title-id">Title</h2>
 *     …
 *   </div>
 * </Modal>
 */
import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';

interface ModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the user closes the modal (Escape key or backdrop click). */
  onClose: () => void;
  /**
   * The `id` of the element that labels this modal (`aria-labelledby`).
   * Provide this when a visible heading inside the modal carries the label.
   * Mutually exclusive with `label`.
   */
  labelId?: string;
  /**
   * A short string that labels this modal when no visible heading id exists
   * (`aria-label`). Mutually exclusive with `labelId`.
   */
  label?: string;
  children: ReactNode;
}

export function Modal({ open, onClose, labelId, label, children }: ModalProps) {
  return (
    <RadixDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-fade-in" />
        <RadixDialog.Content
          aria-labelledby={labelId}
          aria-label={label}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          onInteractOutside={() => onClose()}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
