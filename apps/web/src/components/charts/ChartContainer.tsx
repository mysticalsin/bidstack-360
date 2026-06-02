// Wrapper component for all chart instances.
// Provides: loading skeleton, error state, empty state, title/subtitle,
// actions menu (Export / Refresh / Configure), accessible live region.
// All children receive consistent dark-mode aware padding + border styling.

import { motion, useReducedMotion } from 'framer-motion';
import { MoreHorizontal, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { springSoft } from '@/lib/motion';

interface Action {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
}

interface Props {
  title?: string;
  subtitle?: string;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  actions?: Action[];
  onRefresh?: () => void;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}

export function ChartContainer({
  title,
  subtitle,
  loading = false,
  error = null,
  empty = false,
  emptyMessage = 'No data available for this time period.',
  actions = [],
  onRefresh,
  className,
  children,
  'aria-label': ariaLabel,
}: Props) {
  const reduced = useReducedMotion();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // WHY Escape closes the menu: onBlur alone isn't enough — users navigating
  // via keyboard expect Escape to dismiss a menu without moving focus away from
  // the trigger. ARIA 1.2 §menu specifies Escape closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const allActions: Action[] = [
    ...(onRefresh ? [{ label: 'Refresh', icon: <RefreshCw size={14} />, onClick: onRefresh }] : []),
    ...actions,
  ];

  return (
    <div
      className={cn(
        'relative rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)]',
        'dark:bg-[var(--surface-glass)] dark:backdrop-blur-md',
        'dark:border-[var(--border-glow)]',
        className,
      )}
      role="region"
      aria-label={ariaLabel ?? title ?? 'Chart'}
    >
      {/* Header */}
      {(title || allActions.length > 0) && (
        <div className="flex items-start justify-between px-4 pt-4 pb-2">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-[var(--fg-primary)] leading-tight">
                {title}
              </h3>
            )}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--fg-tertiary)]">{subtitle}</p>}
          </div>
          {allActions.length > 0 && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((p) => !p)}
                aria-label="Chart actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-md',
                  'text-[var(--fg-tertiary)] hover:text-[var(--fg-primary)]',
                  'hover:bg-[var(--surface-sunken)] transition-colors',
                  // min touch target via padding trick — visual stays small
                  'min-w-[44px] min-h-[44px] -m-[8px] p-[8px]',
                )}
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <motion.div
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={springSoft}
                  role="menu"
                  className={cn(
                    'absolute right-0 top-8 z-20 min-w-[140px] rounded-lg py-1',
                    'bg-[var(--surface-card)] border border-[var(--border-default)]',
                    'shadow-[var(--shadow-md)]',
                  )}
                  onBlur={() => setMenuOpen(false)}
                >
                  {allActions.map((a) => (
                    <button
                      key={a.label}
                      role="menuitem"
                      onClick={() => {
                        a.onClick();
                        setMenuOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-sm',
                        'text-[var(--fg-secondary)] hover:text-[var(--fg-primary)]',
                        'hover:bg-[var(--surface-sunken)] transition-colors',
                        'min-h-[44px]',
                      )}
                    >
                      {a.icon}
                      {a.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Body */}
      <div className="px-4 pb-4 pt-1">
        {loading ? (
          <ChartSkeleton />
        ) : error ? (
          <ChartError message={error} />
        ) : empty ? (
          <ChartEmpty message={emptyMessage} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// ── Internal sub-states ──────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="animate-pulse" aria-label="Loading chart" role="status">
      <div className="flex items-end gap-1.5 h-36">
        {[60, 80, 45, 95, 70, 55, 88, 65, 75, 50].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm bg-[var(--border-subtle)]"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        {[40, 65, 50].map((w, i) => (
          <div
            key={i}
            className="h-2 rounded-full bg-[var(--border-subtle)]"
            style={{ width: `${w}px` }}
          />
        ))}
      </div>
    </div>
  );
}

function ChartError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center py-10 text-center">
      <span className="text-2xl mb-2" aria-hidden>
        ⚠
      </span>
      <p className="text-xs text-[var(--danger)]">{message}</p>
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <span className="text-2xl mb-2" aria-hidden>
        📊
      </span>
      <p className="text-xs text-[var(--fg-tertiary)]">{message}</p>
    </div>
  );
}
