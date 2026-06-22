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
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ContactDialog } from '@/components/contact/ContactDialog';
import { CreateOpportunityDialog } from '@/components/opportunity/CreateOpportunityDialog';
import { CreateTaskDialog } from '@/components/task/CreateTaskDialog';
import { springModal } from '@/lib/motion';
import { cn } from '@/lib/cn';

type Entity = 'opportunity' | 'task' | 'contact' | 'note';

type Option = { key: Entity; label: string; hint: string; description: string };

// `key` and `hint` are logic values (map keys + keyboard shortcuts) and stay
// untranslated; only the prose `label`/`description` are externalized.
const buildOptions = (t: (key: string, defaultValue: string) => string): Option[] => [
  {
    key: 'opportunity',
    label: t('quickAddMenu.option.opportunity.label', 'New opportunity'),
    hint: 'O',
    description: t('quickAddMenu.option.opportunity.description', 'Add a bid to the pipeline.'),
  },
  {
    key: 'task',
    label: t('quickAddMenu.option.task.label', 'New task'),
    hint: 'T',
    description: t(
      'quickAddMenu.option.task.description',
      'Create a follow-up, optionally linked to an opp.',
    ),
  },
  {
    key: 'contact',
    label: t('quickAddMenu.option.contact.label', 'New contact'),
    hint: 'C',
    description: t('quickAddMenu.option.contact.description', 'Add a decision-maker.'),
  },
  {
    key: 'note',
    label: t('quickAddMenu.option.note.label', 'New note'),
    hint: 'M',
    description: t('quickAddMenu.option.note.description', 'Drop a thought on the current account.'),
  },
];

export function QuickAddMenu() {
  const { t } = useTranslation('crm');
  const [open, setOpen] = useState(false);
  // After choosing, mount the matching dialog. Cleared when the dialog closes.
  const [pick, setPick] = useState<Entity | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const OPTIONS = buildOptions(t);

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
                  className="fixed left-1/2 top-[20vh] z-50 w-[min(440px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl outline-none glass-menu"
                  // The listbox role + active-descendant pointer + keyboard
                  // handler all live on this one focused element (Radix focuses
                  // the Content on open). Keeping role and aria-activedescendant
                  // on the SAME element is required by WCAG 4.1.2 — a screen
                  // reader follows the active option via this node's focus.
                  role="listbox"
                  aria-label={t('quickAddMenu.title', 'Create')}
                  aria-activedescendant={`quick-add-option-${OPTIONS[activeIdx]?.key}`}
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
                    {t('quickAddMenu.title', 'Create')}
                  </RadixDialog.Title>
                  {/* Presentational wrapper: the listbox role lives on the
                      focused Content above so role + aria-activedescendant share
                      one element. role="presentation" strips the implicit list
                      semantics so the option group isn't double-announced. */}
                  <ul role="presentation" className="p-1">
                    {OPTIONS.map((opt, i) => {
                      const active = i === activeIdx;
                      return (
                        <li
                          key={opt.key}
                          id={`quick-add-option-${opt.key}`}
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIdx(i)}
                          onClick={() => choose(opt.key)}
                          className="relative flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm transition-colors rounded-lg mx-1.5 my-1 bg-transparent z-10"
                        >
                          {active && (
                            <motion.div
                              layoutId="quick-add-highlight"
                              className="absolute inset-0 bg-[var(--surface-hover)] rounded-lg -z-10"
                              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                            />
                          )}
                          <div className="min-w-0">
                            <div
                              className={cn(
                                'font-medium transition-colors',
                                active ? 'text-[var(--brand-primary)]' : 'text-[var(--fg-primary)]',
                              )}
                            >
                              {opt.label}
                            </div>
                            <div className="text-[11px] text-[var(--fg-tertiary)]">
                              {opt.description}
                            </div>
                          </div>
                          <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-2 py-1 text-[10px] font-mono text-[var(--fg-tertiary)] shadow-sm font-semibold">
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
          plays on a clean stage. Each dialog is controlled: open while picked,
          and clearing the pick unmounts it. */}
      {pick === 'opportunity' ? (
        <CreateOpportunityDialog
          trigger={<span style={{ display: 'none' }} />}
          open
          onOpenChange={(o) => {
            if (!o) setPick(null);
          }}
        />
      ) : null}
      {pick === 'task' ? (
        <CreateTaskDialog
          trigger={<span style={{ display: 'none' }} />}
          open
          onOpenChange={(o) => {
            if (!o) setPick(null);
          }}
        />
      ) : null}
      {pick === 'contact' ? <ContactDialogAuto onDone={() => setPick(null)} /> : null}
    </>
  );
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
