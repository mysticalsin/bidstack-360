// macOS Finder-style Quick Look. Pressing Space on a focused contact row
// in the Contacts table opens this overlay — a peek at the full record
// without committing to the edit dialog. Esc or Space again closes it.
//
// Distinct from ContactDialog (which mutates) — Quick Look is read-only,
// fast to open/close, and keyboard-driven.

import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { useFocusRestore } from '@/hooks/useFocusRestore';
import { springModal } from '@/lib/motion';
import type { Contact, Sentiment } from '@bidstack/shared';

const SENTIMENT_TONE: Record<Sentiment, BadgeTone> = {
  hot: 'tomato',
  warm: 'amber',
  neutral: 'gray',
  cold: 'blue',
};

interface Props {
  contact: Contact | null;
  onClose: () => void;
}

export function ContactQuickLook({ contact, onClose }: Props) {
  const reduced = useReducedMotion();
  const open = Boolean(contact);
  // Quick Look is always opened programmatically (via Space key) — Radix
  // can't auto-restore focus because there's no trigger element. The
  // hook captures pre-open focus and puts it back on close so j/k
  // navigation stays alive.
  useFocusRestore(open);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {open && contact ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                transition={springModal}
                className="fixed left-1/2 top-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
              >
                <Dialog.Title className="border-b border-[var(--border-subtle)] px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  Quick Look
                </Dialog.Title>
                <div className="space-y-3 p-5">
                  <div>
                    <div className="text-lg font-semibold text-[var(--fg-primary)]">
                      {contact.name}
                    </div>
                    {contact.role ? (
                      <div className="text-sm text-[var(--fg-secondary)]">{contact.role}</div>
                    ) : null}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-[var(--fg-tertiary)]">Customer</dt>
                    <dd className="text-[var(--fg-primary)]">{contact.customer}</dd>
                    {contact.email ? (
                      <>
                        <dt className="text-[var(--fg-tertiary)]">Email</dt>
                        <dd>
                          <a
                            href={`mailto:${contact.email}`}
                            className="text-[var(--brand-primary)] hover:underline"
                          >
                            {contact.email}
                          </a>
                        </dd>
                      </>
                    ) : null}
                    {contact.phone ? (
                      <>
                        <dt className="text-[var(--fg-tertiary)]">Phone</dt>
                        <dd className="text-[var(--fg-primary)]">{contact.phone}</dd>
                      </>
                    ) : null}
                    {contact.influence !== null ? (
                      <>
                        <dt className="text-[var(--fg-tertiary)]">Influence</dt>
                        <dd className="text-[var(--fg-primary)]">{contact.influence}/5</dd>
                      </>
                    ) : null}
                    {contact.sentiment ? (
                      <>
                        <dt className="text-[var(--fg-tertiary)]">Sentiment</dt>
                        <dd>
                          <Badge tone={SENTIMENT_TONE[contact.sentiment]}>
                            {contact.sentiment}
                          </Badge>
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </div>
                <footer className="flex justify-between border-t border-[var(--border-subtle)] px-5 py-2 text-[10px] text-[var(--fg-tertiary)]">
                  <span>
                    Press{' '}
                    <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1 py-0.5 font-mono">
                      Esc
                    </kbd>{' '}
                    or{' '}
                    <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1 py-0.5 font-mono">
                      Space
                    </kbd>{' '}
                    to close
                  </span>
                  <span>Read-only</span>
                </footer>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}
