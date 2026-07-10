import { useEffect, useId, useRef, useState } from 'react';

import { ACCENTS } from '@/lib/accent';
import { useAccent } from '@/lib/useAccent';

// Compact accent-color picker for the marketing nav. Sits next to the dark-mode
// toggle. A disclosure popover whose swatches form a WAI-ARIA radiogroup with
// roving tabindex + arrow-key navigation. The choice is shared with the app via
// the `polo-accent` key.
export function AccentPicker() {
  const { accent, setAccent } = useAccent();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelId = useId();
  const current = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0]!;
  const activeIndex = Math.max(0, ACCENTS.findIndex((a) => a.id === accent));

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    // Move focus into the group on open.
    swatchRefs.current[activeIndex]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSwatchKey(e: React.KeyboardEvent, index: number) {
    const last = ACCENTS.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next !== null) {
      e.preventDefault();
      const a = ACCENTS[next]!;
      setAccent(a.id); // radiogroup selection follows focus
      swatchRefs.current[next]?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Accent color: ${current.label}`}
        className="mkt-btn mkt-btn-ghost h-11 w-11 p-0"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 rounded-full ring-1 ring-black/15 dark:ring-white/20"
          style={{
            background:
              current.id === 'default' ? 'linear-gradient(135deg,#2c4bff,#6e59ff)' : current.swatch,
          }}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          role="radiogroup"
          aria-label="Accent color"
          className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-2 shadow-lg"
        >
          <div className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--fg-tertiary)]">
            Accent color
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {ACCENTS.map((a, i) => {
              const selected = a.id === accent;
              return (
                <button
                  key={a.id}
                  ref={(el) => {
                    swatchRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={a.label}
                  title={a.label}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(e) => onSwatchKey(e, i)}
                  onClick={() => {
                    setAccent(a.id);
                    close();
                  }}
                  className={`flex h-11 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface-card)] ${
                    selected
                      ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary-tint)]'
                      : 'border-transparent hover:bg-[color:var(--surface-sunken)]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="grid h-6 w-6 place-items-center rounded-full ring-1 ring-black/15 dark:ring-white/20"
                    style={{
                      background:
                        a.id === 'default'
                          ? 'linear-gradient(135deg,#2c4bff,#6e59ff)'
                          : a.swatch,
                    }}
                  >
                    {selected ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
