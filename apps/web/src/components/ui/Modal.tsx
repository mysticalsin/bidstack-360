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
 * `title` is rendered as a visually-hidden `RadixDialog.Title` (the `sr-only`
 * pattern Radix's own docs recommend). Every caller here already paints its
 * own styled heading inside `children`, so Radix's Title stays off-screen —
 * but it must still exist, because Radix keys its dev-mode a11y check (and
 * the DOM's auto `aria-labelledby`) off an actual `<Title>` element, not off
 * whatever `aria-label`/`aria-labelledby` a caller bolts on by hand. Passing
 * `aria-describedby={undefined}` likewise stops Radix from pointing at a
 * `Description` id that was never rendered — see the sibling `DialogContent`
 * primitive in Dialog.tsx for the same convention.
 *
 * @example
 * <Modal open={show} onClose={() => setShow(false)} title="My dialog">
 *   <div className="bg-[var(--surface)] rounded-2xl p-6">
 *     <h2>My dialog</h2>
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
   * Accessible name for the dialog, announced by screen readers on open.
   * Rendered as a visually-hidden Radix `Title` — pass the same text your
   * visible in-modal heading already shows.
   */
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
          onInteractOutside={() => onClose()}
          aria-describedby={undefined}
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
