/**
 * CommandPalette — global ⌘K search/navigation overlay.
 *
 * Shell (this file, ~270 lines):
 *   CommandPalette    → Radix Dialog + Framer Motion chrome
 *   PaletteBody       → query state, keyboard nav, list JSX
 *   highlightText     → inline JSX helper (JSX, only used here)
 *
 * Extracted:
 *   commandPaletteUtils.ts  → pure types, constants, matchers, formatters
 *   usePaletteItems.ts      → all hooks + item-list memo
 */
import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { springModal } from '@/lib/motion';

import {
  fuzzyMatch,
  groupAriaLabel,
  groupItemsByRun,
  groupTag,
  type Item,
} from './commandPaletteUtils';
import { buildAskCopilotItem, CopilotPanel, type CopilotKeyHandler } from './CopilotPanel';
import { isCopilotQuery, looksLikeCopilotAsk, stripCopilotPrefix } from './copilotActions';
import { usePaletteItems } from './usePaletteItems';

// ── Public component ─────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const reduced = useReducedMotion();
  const { t } = useTranslation('crm');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-40 bg-surface-overlay backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -8 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -4 }}
                transition={springModal}
                className="fixed left-1/2 top-[15vh] z-50 w-[min(560px,92vw)] -translate-x-1/2 rounded-xl outline-none glass-menu"
              >
                <Dialog.Title className="sr-only">
                  {t('commandPalette.title', 'Command palette')}
                </Dialog.Title>
                <PaletteBody onClose={() => onOpenChange(false)} />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

// ── PaletteBody ──────────────────────────────────────────────────────────────

function PaletteBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('crm');
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // queryRef is a stable ref to the current query — used in the document
  // keydown handler (closure captures the ref, not the stale state value).
  const queryRef = useRef('');
  const listRef = useRef<HTMLDivElement | null>(null);

  // Copilot mode is DERIVED from the query (leading '?' or '>'), not stored —
  // erasing the prefix drops straight back to search with zero extra state.
  const copilotMode = isCopilotQuery(query);
  const copilotKeyRef = useRef<CopilotKeyHandler | null>(null);
  const [copilotActiveId, setCopilotActiveId] = useState<string | null>(null);

  // Feed an empty query while in copilot mode so the debounced server
  // searches never fire against a natural-language prompt.
  const { items, isFetching, selectNavTarget, findDirectNavTarget } = usePaletteItems(
    copilotMode ? '' : query,
    onClose,
  );

  const enterCopilot = useCallback((q: string) => {
    const next = `? ${q.trim()}`;
    queryRef.current = next;
    setQuery(next);
    setActiveIdx(0);
    inputRef.current?.focus();
  }, []);

  // Sentence-like queries grow an "Ask Copilot" escape hatch APPENDED to the
  // results — never ranked into them, so search ordering/muscle memory hold.
  const displayItems = useMemo(() => {
    if (copilotMode || !looksLikeCopilotAsk(query)) return items;
    // enterCopilot only reads refs when invoked from the item's onSelect
    // handler (a user event), never during render — buildAskCopilotItem stores
    // it, it does not call it. The refs rule can't prove that, so scope it here.
    // eslint-disable-next-line react-hooks/refs
    return [...items, buildAskCopilotItem(query, t, enterCopilot)];
  }, [items, query, copilotMode, t, enterCopilot]);

  // Focus the input immediately on mount — both sync (for standard focus) and
  // deferred one frame (for portals that mount slightly after the effect runs).
  useLayoutEffect(() => {
    inputRef.current?.focus();
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Keep queryRef in sync so the document keydown handler always reads the
  // latest query without needing to be recreated on every keystroke.
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // Auto-scroll the active row into view when arrowing through long result
  // lists. Deferred one frame so the DOM has settled with the new active
  // class before we measure.
  useEffect(() => {
    if (!listRef.current) return;
    const safe = displayItems.length === 0 ? 0 : Math.min(activeIdx, displayItems.length - 1);
    const node = listRef.current.querySelector<HTMLElement>(`[data-cmdk-idx="${safe}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, displayItems.length]);

  // Clamp activeIdx when the result set shrinks (user typed more specifically).
  const safeIdx = displayItems.length === 0 ? 0 : Math.min(activeIdx, displayItems.length - 1);

  // Activate focused list item with Enter / Space for screen-reader users
  // who arrow directly into the listbox via VoiceOver/JAWS gestures.
  const handleItemKeyDown = (e: KeyboardEvent<HTMLDivElement>, item: Item) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      item.onSelect();
    }
  };

  // If the user presses a printable key while focus is outside the input
  // (e.g. on a list item), append the character to the query and re-focus.
  const appendQueryCharacter = useCallback((key: string) => {
    inputRef.current?.focus();
    setQuery((prev) => {
      const next = `${prev}${key}`;
      queryRef.current = next;
      return next;
    });
    setActiveIdx(0);
  }, []);

  // Capture printable keypresses anywhere in the document so the palette
  // never "eats" a key without reflecting it in the query.
  useEffect(() => {
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.target === inputRef.current) return;
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      appendQueryCharacter(event.key);
      event.preventDefault();
    };
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => document.removeEventListener('keydown', handleDocumentKeyDown, true);
  }, [appendQueryCharacter]);

  const handlePaletteKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.target === inputRef.current) return;
    if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
    appendQueryCharacter(e.key);
    e.preventDefault();
  };

  return (
    <div onKeyDown={handlePaletteKeyDown}>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <span className="text-[var(--fg-tertiary)]" aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          role="combobox"
          autoFocus
          type="search"
          value={query}
          onChange={(e) => {
            const nextQuery = e.currentTarget.value;
            queryRef.current = nextQuery;
            setQuery(nextQuery);
            setActiveIdx(0);
          }}
          onKeyDown={(e) => {
            // Copilot mode owns the keyboard: the panel moves its own
            // highlight and runs actions; everything else still types.
            if (copilotMode) {
              if (copilotKeyRef.current?.(e)) e.preventDefault();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(displayItems.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const directRoute = findDirectNavTarget(
                queryRef.current || e.currentTarget.value,
              );
              if (directRoute) {
                selectNavTarget(directRoute);
                return;
              }
              displayItems[safeIdx]?.onSelect();
            }
          }}
          placeholder={t(
            'commandPalette.searchPlaceholder',
            'Search accounts, contacts, tasks, opportunities…',
          )}
          className="flex-1 bg-transparent text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-tertiary)] focus:outline-none"
          aria-label={t('commandPalette.searchAriaLabel', 'Search across the workspace')}
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={copilotMode ? 'copilot-list' : 'cmdk-list'}
          aria-activedescendant={
            copilotMode
              ? (copilotActiveId ?? undefined)
              : displayItems.length
                ? `cmdk-option-${safeIdx}`
                : undefined
          }
        />
        <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--fg-tertiary)]">
          esc
        </kbd>
      </div>

      {copilotMode ? (
        <CopilotPanel
          prompt={stripCopilotPrefix(query)}
          onClose={onClose}
          keyHandlerRef={copilotKeyRef}
          onActiveOptionChange={setCopilotActiveId}
        />
      ) : (
      <div
        ref={listRef}
        id="cmdk-list"
        role="listbox"
        className="max-h-[60vh] overflow-y-auto py-2"
      >
        {displayItems.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--fg-tertiary)]">
            {isFetching
              ? t('commandPalette.searching', 'Searching…')
              : t('commandPalette.noMatches', 'No matches.')}
          </div>
        ) : null}
        {/* Wrap contiguous same-group runs in role="group" + aria-label so
            screen readers get "Create", "Navigate", "Accounts", etc.
            announced — the mono badge (groupTag) below only carries that
            info visually, and is suppressed entirely on icon-led rows
            (leading logos). Grouping is derived purely for rendering; the
            flat `index` from the original `items` array is preserved on
            each row so keyboard nav / aria-activedescendant is unaffected. */}
        {groupItemsByRun(displayItems).map((run) => (
          <div
            key={`group-${run.group}-${run.entries[0]?.index}`}
            role="group"
            aria-label={groupAriaLabel(run.group)}
          >
            {run.entries.map(({ item, index }) => {
              const active = index === safeIdx;
              return (
                <div
                  id={`cmdk-option-${index}`}
                  key={item.id}
                  data-cmdk-idx={index}
                  role="option"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onMouseEnter={() => setActiveIdx(index)}
                  onClick={item.onSelect}
                  onKeyDown={(e) => handleItemKeyDown(e, item)}
                  // min-h-11 keeps touch targets ≥ 44px (WCAG 2.5.5 AA)
                  className="relative flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors rounded-lg mx-2 my-0.5 bg-transparent z-10"
                >
                  {active && (
                    <motion.div
                      layoutId="command-palette-highlight"
                      className="absolute inset-0 bg-[var(--surface-hover)] rounded-lg -z-10"
                      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    />
                  )}
                  <div className="flex items-center gap-2 min-w-0">
                    {item.leading ? (
                      <span className="shrink-0" aria-hidden>
                        {item.leading}
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md font-mono border transition-all',
                          active
                            ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]'
                            : 'border-[var(--border-default)] bg-[var(--surface-sunken)] text-[var(--fg-tertiary)]',
                        )}
                      >
                        {groupTag(item.group)}
                      </span>
                    )}
                    <span
                      className={cn(
                        'truncate transition-colors',
                        active
                          ? 'text-[var(--brand-primary)] font-medium'
                          : 'text-[var(--fg-primary)]',
                      )}
                    >
                      {highlightText(item.label, query, active)}
                    </span>
                  </div>
                  {item.hint ? (
                    <span className="shrink-0 text-[10px] text-[var(--fg-tertiary)]">
                      {item.hint}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ── Inline JSX helpers (only used in this file, not worth a separate .tsx) ───

function highlightText(text: string, query: string, active: boolean) {
  // Fuzzy indices (not a substring regex) so the highlight shows exactly the
  // characters that earned the row its rank — an acronym match like "gtd" →
  // "Go to Dashboard" renders three separate marks. No match (e.g. a server
  // hit that matched on a hidden field) renders plain.
  const match = query.trim() ? fuzzyMatch(query, text) : null;
  if (!match) return <span>{text}</span>;
  const matched = new Set(match.indices);
  const runs: { chars: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const hit = matched.has(i);
    const last = runs[runs.length - 1];
    if (last && last.hit === hit) last.chars += text.charAt(i);
    else runs.push({ chars: text.charAt(i), hit });
  }
  return (
    <span>
      {runs.map((run, i) =>
        run.hit ? (
          <mark
            key={i}
            // Theme tokens (not raw yellow-*) so the highlight resolves in
            // both modes: --tag-amber-* is defined per theme in index.css.
            className={cn(
              'bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)] rounded-sm px-0.5 font-semibold',
              active && 'font-bold',
            )}
          >
            {run.chars}
          </mark>
        ) : (
          run.chars
        ),
      )}
    </span>
  );
}
