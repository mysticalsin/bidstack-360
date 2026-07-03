import { useEffect, useRef, useState } from 'react';

import { ACCENTS } from '@/lib/accent';
import { useAccent } from '@/lib/useAccent';

// Compact accent-color picker for the marketing nav. Sits next to the dark-mode
// toggle. A popover with the same six accents as the app; the choice is shared
// with the app via the `polo-accent` key.
export function AccentPicker() {
  const { accent, setAccent } = useAccent();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = ACCENTS.find((a) => a.id === accent) ?? ACCENTS[0]!;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Accent color: ${current.label}`}
        className="mkt-btn mkt-btn-ghost h-11 w-11 p-0"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 rounded-full ring-1 ring-black/15 dark:ring-white/20"
          style={{
            background:
              current.id === 'default'
                ? 'linear-gradient(135deg,#2c4bff,#6e59ff)'
                : current.swatch,
          }}
        />
      </button>

      {open ? (
        <div
          role="radiogroup"
          aria-label="Accent color"
          className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-[color:var(--border-default)] bg-[color:var(--surface-card)] p-2 shadow-lg"
        >
          <div className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-[color:var(--fg-tertiary)]">
            Accent color
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {ACCENTS.map((a) => {
              const selected = a.id === accent;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => {
                    setAccent(a.id);
                    setOpen(false);
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
