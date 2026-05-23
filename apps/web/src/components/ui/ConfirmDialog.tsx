// Imperative confirm() replacement. Renders a Radix-backed dialog with
// Apple-style spring motion. Returns a Promise<boolean> so callers can
// `if (await confirm({...}))` exactly like `window.confirm`.
//
// The destructive variant tints the confirm button red and gives Cancel
// the default styling — matches Apple HIG's destructive-action affordance.

import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useRef } from 'react';
import { create } from 'zustand';

import { Button } from '@/components/ui/Button';
import { springModal } from '@/lib/motion';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in destructive (red) styling. */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: string;
  resolve: (value: boolean) => void;
}

interface ConfirmStore {
  pending: PendingConfirm | null;
  request: (opts: ConfirmOptions) => Promise<boolean>;
  resolve: (value: boolean) => void;
}

const useConfirmStore = create<ConfirmStore>((set, get) => ({
  pending: null,
  request: (opts) => {
    // If a confirm is already on-screen, deny the new request rather than
    // queueing or stomping on the in-flight one. Two simultaneous confirms
    // would be confusing UX.
    if (get().pending) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      set({ pending: { ...opts, id: crypto.randomUUID(), resolve } });
    });
  },
  resolve: (value) => {
    const p = get().pending;
    if (!p) return;
    p.resolve(value);
    set({ pending: null });
  },
}));

/** Imperative confirm: `if (await confirm({ title: '…' })) { /* … *\/ }` */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(opts);
}

export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);
  // AnimatePresence drives the exit animation when `pending` becomes null
  // (after a resolve). We keep Radix in `open=true` whenever pending exists;
  // the motion exit variants handle the visual fade-out before unmount.
  return (
    <AnimatePresence>
      {pending ? <ConfirmInstance key={pending.id} pending={pending} onResolve={resolve} /> : null}
    </AnimatePresence>
  );
}

function ConfirmInstance({
  pending,
  onResolve,
}: {
  pending: PendingConfirm;
  onResolve: (value: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  return (
    <RadixDialog.Root open onOpenChange={(o) => !o && onResolve(false)}>
      <RadixDialog.Portal forceMount>
        <RadixDialog.Overlay asChild forceMount>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
          />
        </RadixDialog.Overlay>
        <RadixDialog.Content
          asChild
          forceMount
          onOpenAutoFocus={(e) => {
            // Apple HIG: confirm dialogs default focus to the confirm button
            // for destructive actions too. Users press Esc to cancel.
            e.preventDefault();
            confirmRef.current?.focus();
          }}
        >
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 4 }}
            transition={springModal}
            className="fixed left-1/2 top-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)]"
          >
            <div className="px-5 pb-3 pt-5">
              <RadixDialog.Title className="text-base font-semibold text-[var(--fg-primary)]">
                {pending.title}
              </RadixDialog.Title>
              {pending.description ? (
                <RadixDialog.Description className="mt-2 text-sm text-[var(--fg-secondary)]">
                  {pending.description}
                </RadixDialog.Description>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-5 py-3">
              <Button size="sm" variant="secondary" onClick={() => onResolve(false)}>
                {pending.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                ref={confirmRef}
                size="sm"
                variant={pending.destructive ? 'destructive' : 'primary'}
                onClick={() => onResolve(true)}
              >
                {pending.confirmLabel ?? (pending.destructive ? 'Delete' : 'Confirm')}
              </Button>
            </div>
          </motion.div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
