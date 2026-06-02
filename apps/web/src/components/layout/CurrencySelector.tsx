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
  const {
    currency,
    setCurrency,
    enableAutoDetect,
    autoDetect,
    fetchRates,
    rates,
    ratesLoading,
    ratesError,
  } = useCurrencyStore();
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    fetchRates();
  }, [fetchRates]);

  useEffect(() => {
    if (autoDetect) void enableAutoDetect();
  }, [autoDetect, enableAutoDetect]);

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
  const statusText = ratesLoading
    ? 'Updating live rates'
    : ratesError
      ? 'Using cached rates'
      : formatRateStatus(rates?.date);

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
          className="group flex h-10 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 text-xs font-semibold text-[var(--fg-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          aria-label={`Select currency, current: ${currency}`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--surface-card)] text-sm text-[var(--fg-primary)] ring-1 ring-[var(--border-subtle)]">
            {selected?.symbol ?? currency}
          </span>
          <span className="tb-currency-code leading-none">
            <span className="block text-[10px] font-medium text-[var(--fg-tertiary)]">
              Currency
            </span>
            <span className="block text-xs font-semibold text-[var(--fg-primary)]">{currency}</span>
          </span>
          {ratesLoading && (
            <span className="ml-0.5 inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
          )}
          <Icon
            name="chevron-down"
            size={12}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
            ariaHidden
          />
        </button>
      </Tooltip>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={springSnap}
            className="absolute right-0 top-[calc(100%+8px)] z-30 w-[min(24rem,calc(100vw-1rem))] rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3 shadow-[var(--shadow-lg)] focus:outline-none max-md:fixed max-md:left-2 max-md:right-2 max-md:top-14 max-md:w-auto"
            role="listbox"
            aria-label="Select currency"
          >
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                  Display currency
                </span>
                <p className="mt-1 text-sm font-semibold text-[var(--fg-primary)]">
                  {selected?.name ?? currency}
                </p>
                <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{statusText}</p>
              </div>
              <button
                type="button"
                title="Auto selects currency from your browser location, then timezone"
                onClick={() => {
                  void enableAutoDetect();
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
                  autoDetect
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]'
                    : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)]'
                }`}
              >
                <Icon name="globe" size={13} ariaHidden />
                Auto
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
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
                      triggerRef.current?.focus();
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`relative flex min-h-12 w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
                      isSelected
                        ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)]/10 text-[var(--fg-primary)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    {/* Sliding background highlight */}
                    {isHighlighted && !isSelected && (
                      <motion.div
                        layoutId="currency-highlight"
                        className="absolute inset-0 rounded-xl bg-[var(--surface-hover)]"
                        transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                      />
                    )}
                    <span className="z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--surface-card)] text-sm font-semibold ring-1 ring-[var(--border-subtle)]">
                      {c.symbol}
                    </span>
                    <span className="z-10 min-w-0 flex-1">
                      <span
                        className={`block truncate ${isSelected ? 'font-semibold text-[var(--brand-primary)]' : 'font-medium'}`}
                      >
                        {c.code}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--fg-tertiary)]">
                        {c.name}
                      </span>
                    </span>
                    {isSelected && (
                      <span className="z-10 shrink-0 text-[var(--brand-primary)]">
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

function formatRateStatus(date: string | undefined): string {
  if (!date) return 'Live rates';
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return 'Live rates';
  return `Rates updated ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)}`;
}
