import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCurrencyStore, SUPPORTED_CURRENCIES } from '@/stores/currency';
import { springSnap } from '@/lib/motion';

export function CurrencySelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const { currency, setCurrency, fetchRates, ratesLoading, ratesError } = useCurrencyStore();
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const selectedIndex = SUPPORTED_CURRENCIES.findIndex((c) => c.code === currency);
  const selected = SUPPORTED_CURRENCIES[selectedIndex];

  // WHY useLayoutEffect: syncing visual keyboard-navigation highlight before
  // paint — classic useLayoutEffect use-case. setState-in-effect is flagged
  // by the rule but intentional here: the highlight is pure React UI state
  // with no external system involved.
  useLayoutEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    } else {
      setHighlightedIndex(-1);
    }
  }, [open, selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (ratesLoading) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightedIndex(0);
        } else {
          setHighlightedIndex((prev) => (prev + 1) % SUPPORTED_CURRENCIES.length);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setHighlightedIndex(SUPPORTED_CURRENCIES.length - 1);
        } else {
          setHighlightedIndex(
            (prev) => (prev - 1 + SUPPORTED_CURRENCIES.length) % SUPPORTED_CURRENCIES.length,
          );
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (!open) {
          setOpen(true);
        } else if (highlightedIndex >= 0 && highlightedIndex < SUPPORTED_CURRENCIES.length) {
          const c = SUPPORTED_CURRENCIES[highlightedIndex];
          if (c) {
            setCurrency(c.code);
          }
          setOpen(false);
          triggerRef.current?.focus();
        }
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={ref} className="tb-currency relative">
      <Tooltip
        content={
          ratesError
            ? `Rates unavailable: ${ratesError}`
            : `Currency: ${selected?.name ?? currency}`
        }
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          onKeyDown={handleKeyDown}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-xs font-semibold text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] transition-colors focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:outline-none"
          aria-label={`Select currency, current: ${currency}`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="text-sm">{selected?.symbol ?? currency}</span>
          <span className="tb-currency-code">{currency}</span>
          {ratesLoading && (
            <span className="ml-0.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
          )}
          <Icon name="chevron-down" size={12} ariaHidden />
        </button>
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={springSnap}
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-52 rounded-lg glass-menu p-1.5 focus:outline-none"
            role="listbox"
            aria-label="Select currency"
          >
            <div className="px-3 py-1.5 border-b border-[var(--border-subtle)] mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                Display currency
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto flex flex-col gap-0.5">
              {SUPPORTED_CURRENCIES.map((c, index) => {
                const isSelected = c.code === currency;
                const isHighlighted = index === highlightedIndex;

                return (
                  <button
                    key={c.code}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      setCurrency(c.code);
                      setOpen(false);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className="relative flex w-full items-center gap-2 px-3 py-2 text-left text-sm rounded-md transition-colors text-[var(--fg-primary)] bg-transparent focus:outline-none cursor-pointer"
                  >
                    {/* Sliding background highlight */}
                    {isHighlighted && (
                      <motion.div
                        layoutId="currency-highlight"
                        className="absolute inset-0 bg-[var(--surface-hover)] rounded-md -z-10"
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    <span className="w-6 text-center text-base z-10">{c.symbol}</span>
                    <span
                      className={`flex-1 z-10 ${isSelected ? 'font-semibold text-[var(--brand-primary)]' : ''}`}
                    >
                      {c.name}
                    </span>
                    <span className="text-xs text-[var(--fg-tertiary)] z-10">{c.code}</span>
                    {isSelected && (
                      <span className="z-10 text-[var(--brand-primary)]">
                        <Icon name="check" size={14} ariaHidden />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
