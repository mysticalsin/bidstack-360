import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCurrencyStore, SUPPORTED_CURRENCIES } from '@/stores/currency';
import { springSnap } from '@/lib/motion';

export function CurrencySelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { currency, setCurrency, fetchRates, ratesLoading, ratesError } = useCurrencyStore();

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

  const selected = SUPPORTED_CURRENCIES.find((c) => c.code === currency);

  return (
    <div ref={ref} className="tb-currency relative">
      <Tooltip content={ratesError ? `Rates unavailable: ${ratesError}` : `Currency: ${selected?.name ?? currency}`}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-2.5 py-1.5 text-xs font-semibold text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] transition-colors"
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
            className="absolute right-0 top-[calc(100%+6px)] z-30 w-52 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] shadow-[var(--shadow-lg)]"
            role="listbox"
            aria-label="Select currency"
          >
            <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--fg-tertiary)]">
                Display currency
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {SUPPORTED_CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  role="option"
                  aria-selected={c.code === currency}
                  onClick={() => {
                    setCurrency(c.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    c.code === currency
                      ? 'bg-[var(--surface-hover)] text-[var(--brand-primary)] font-semibold'
                      : 'text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  <span className="w-6 text-center text-base">{c.symbol}</span>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-[var(--fg-tertiary)]">{c.code}</span>
                  {c.code === currency && <Icon name="check" size={14} ariaHidden />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
