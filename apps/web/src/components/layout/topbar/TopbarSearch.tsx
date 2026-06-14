// Topbar search bar with recent-search dropdown.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, useRef, useEffect, useLayoutEffect, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Icon } from '@/components/ui/Icon';
import { useRecentSearches } from '@/stores/recentSearches';

export function SearchBar() {
  const { t } = useTranslation('crm');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recents = useRecentSearches((s) => s.items);
  const pushRecent = useRecentSearches((s) => s.push);
  const clearRecents = useRecentSearches((s) => s.clear);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const reduced = useReducedMotion();

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  // WHY useLayoutEffect: resets keyboard-nav highlight before the next paint.
  // setState-in-effect is intentional — pure React UI state, no external
  // system.
  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlightedIndex(-1);
    }
  }, [open]);

  const runSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    pushRecent(trimmed);
    setQuery(trimmed);
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || query || recents.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % recents.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + recents.length) % recents.length);
        break;
      case 'Enter':
        if (highlightedIndex >= 0 && highlightedIndex < recents.length) {
          e.preventDefault();
          const q = recents[highlightedIndex];
          if (q) {
            runSearch(q);
          }
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <form onSubmit={onSubmit} className="tb-search relative" role="search">
      <Icon name="search" size={14} ariaHidden />
      <label htmlFor="tb-search-input" className="sr-only">
        {t('topbarSearch.label', 'Search opportunities, contacts, tasks')}
      </label>
      <input
        id="tb-search-input"
        type="search"
        placeholder={t('topbarSearch.placeholder', 'Search or jump to…')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        // Delay the close so a click on a dropdown item lands before the
        // dropdown unmounts. 150ms is the standard browser delay.
        onBlur={() => {
          blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
        }}
      />
      <kbd aria-hidden>Ctrl+/</kbd>
      <AnimatePresence>
        {open && !query && recents.length > 0 && (
          <motion.div
            role="listbox"
            aria-label={t('topbarSearch.recentSearchesAriaLabel', 'Recent searches')}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-lg glass-menu p-1.5 focus:outline-none"
          >
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2.5 py-1.5 mb-1 text-[10px] uppercase tracking-wider text-[var(--fg-tertiary)]">
              <span>{t('topbarSearch.recentHeading', 'Recent')}</span>
              <button
                type="button"
                onMouseDown={(e) => {
                  // Use mousedown not click so it fires before the input's
                  // blur tears the dropdown down.
                  e.preventDefault();
                  clearRecents();
                }}
                className="text-[10px] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] rounded px-1 py-0.5"
              >
                {t('topbarSearch.clear', 'Clear')}
              </button>
            </div>
            <ul className="flex flex-col gap-0.5">
              {recents.map((r, index) => {
                const isHighlighted = index === highlightedIndex;
                return (
                  <li key={r}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        runSearch(r);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className="relative block w-full px-2.5 py-1.5 text-left text-sm text-[var(--fg-primary)] bg-transparent focus-visible:outline-none rounded-md cursor-pointer"
                    >
                      {isHighlighted && (
                        <motion.div
                          layoutId="recent-search-highlight"
                          className="absolute inset-0 bg-[var(--surface-hover)] rounded-md -z-10"
                          transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{r}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
