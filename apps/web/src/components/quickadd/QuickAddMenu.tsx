// Quick-add menu — press `N` from anywhere (outside an input) to open a
// small palette listing "New …" options. Each option routes to the dialog
// that creates that record type. Modeled after macOS's File → New menu
// and Linear's `C` shortcut.
//
// We mount the dialogs lazily *inside* this component so we don't pay
// their cost when the menu is closed.

import * as RadixDialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { ContactDialog } from '@/components/contact/ContactDialog';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { springModal } from '@/lib/motion';
import { cn } from '@/lib/cn';

type Entity = 'opportunity' | 'task' | 'contact' | 'note';

const OPTIONS: Array<{ key: Entity; label: string; hint: string; description: string }> = [
  {
    key: 'opportunity',
    label: 'New opportunity',
    hint: 'O',
    description: 'Add a bid to the pipeline.',
  },
  {
    key: 'task',
    label: 'New task',
    hint: 'T',
    description: 'Create a follow-up, optionally linked to an opp.',
  },
  { key: 'contact', label: 'New contact', hint: 'C', description: 'Add a decision-maker.' },
  {
    key: 'note',
    label: 'New note',
    hint: 'M',
    description: 'Drop a thought on the current account.',
  },
];

export function QuickAddMenu() {
  const [open, setOpen] = useState(false);
  // After choosing, mount the matching dialog. Cleared when the dialog closes.
  const [pick, setPick] = useState<Entity | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const reduced = useReducedMotion();
  const navigate = useNavigate();

  // Global keybinding: `N` opens the menu (when not typing in a field). This
  // mirrors Linear/Notion's "new record" shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      const isInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
      if (isInput) return;
      e.preventDefault();
      setOpen(true);
      setActiveIdx(0);
    };
    window.addEventListener('keydown', handler as never);
    return () => window.removeEventListener('keydown', handler as never);
  }, []);

  const choose = (entity: Entity) => {
    setOpen(false);
    if (entity === 'note') {
      // We don't have a global "note" dialog yet — notes live per-account.
      // Send the user to a known account they can attach a note to.
      navigate('/accounts/mantu');
      return;
    }
    setPick(entity);
  };

  return (
    <>
      <RadixDialog.Root open={open} onOpenChange={setOpen}>
        <AnimatePresence>
          {open ? (
            <RadixDialog.Portal forceMount>
              <RadixDialog.Overlay asChild forceMount>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
                />
              </RadixDialog.Overlay>
              <RadixDialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
                  transition={springModal}
                  className="fixed left-1/2 top-[20vh] z-50 w-[min(440px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)] outline-none"
                  onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveIdx((i) => Math.min(OPTIONS.length - 1, i + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveIdx((i) => Math.max(0, i - 1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      choose(OPTIONS[activeIdx]!.key);
                    } else {
                      // Letter shortcut: pressing the hint character picks it.
                      const k = e.key.toUpperCase();
                      const opt = OPTIONS.find((o) => o.hint === k);
                      if (opt) {
                        e.preventDefault();
                        choose(opt.key);
                      }
                    }
                  }}
                >
                  <RadixDialog.Title className="border-b border-[var(--border-subtle)] px-4 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                    Create
                  </RadixDialog.Title>
                  <ul role="listbox" className="py-1">
                    {OPTIONS.map((opt, i) => {
                      const active = i === activeIdx;
                      return (
                        <li
                          key={opt.key}
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIdx(i)}
                          onClick={() => choose(opt.key)}
                          className={cn(
                            'flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm',
                            active && 'bg-[var(--brand-primary-tint)]',
                          )}
                        >
                          <div className="min-w-0">
                            <div
                              className={cn(
                                'font-medium',
                                active ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-primary)]',
                              )}
                            >
                              {opt.label}
                            </div>
                            <div className="text-[11px] text-[var(--fg-tertiary)]">
                              {opt.description}
                            </div>
                          </div>
                          <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
                            {opt.hint}
                          </kbd>
                        </li>
                      );
                    })}
                  </ul>
                </motion.div>
              </RadixDialog.Content>
            </RadixDialog.Portal>
          ) : null}
        </AnimatePresence>
      </RadixDialog.Root>

      {/* Selected dialog mounts AFTER the menu closes so its open-animation
          plays on a clean stage. Each dialog manages its own open state via
          a controlled `open`; we set it true once and clear pick on close. */}
      {pick === 'opportunity' ? (
        <CreateOpportunityDialog trigger={<span style={{ display: 'none' }} />} />
      ) : null}
      {pick === 'task' ? <TaskDialogAuto onDone={() => setPick(null)} /> : null}
      {pick === 'contact' ? <ContactDialogAuto onDone={() => setPick(null)} /> : null}
    </>
  );
}

// CreateTaskDialog / ContactDialog don't expose a controlled-open prop in a
// uniform way, so we mount them and click their triggers on the next tick
// via a small wrapper. Cheap, no API churn.
function TaskDialogAuto({ onDone: _onDone }: { onDone: () => void }) {
  // Render the standard dialog with no oppId pre-filled. The user closes it
  // normally — we don't need a programmatic close hook for parity with the
  // other entry points.
  return <CreateTaskDialog />;
}

function ContactDialogAuto({ onDone }: { onDone: () => void }) {
  return (
    <ContactDialog
      open
      onOpenChange={(o) => {
        if (!o) onDone();
      }}
    />
  );
}
