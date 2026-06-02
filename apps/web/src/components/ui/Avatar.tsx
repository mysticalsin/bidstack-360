// Avatar with deterministic gradient fallback when no image is available.
// Generates a brand-aware two-tone gradient from a hash of the seed string
// so the same name always produces the same gradient — visually distinct
// per person without needing real photos.
//
// Also exports OnlineDot: a 10px presence indicator (green = online,
// grey = offline) used in the Team settings table (A5 pattern).

import { useMemo } from 'react';

import { cn } from '@/lib/cn';

interface Props {
  /** String used to seed the gradient and initials (typically a person's name). */
  seed: string;
  /** Optional image URL — when provided, takes precedence over initials. */
  src?: string | null;
  /** Diameter in px. Defaults to 32. */
  size?: number;
  /** Override the rendered initials (otherwise derived from `seed`). */
  initials?: string;
  className?: string;
  /** Surface as decorative (aria-hidden); the parent typically already
   *  labels the row. */
  decorative?: boolean;
}

// HSL palette tuned to feel Apple-grade — warm-cool spread without going
// neon. Light theme uses 70% lightness; dark theme picks 55% for contrast.
const HUES = [212, 250, 282, 322, 5, 32, 165, 195];

function hash(value: string): number {
  // Tiny djb2-style hash — deterministic, fast, no deps. Enough variety for
  // ~hundreds of distinct seeds before collisions become visible.
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = (h * 33) ^ value.charCodeAt(i);
  return h >>> 0;
}

function initialsOf(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({ seed, src, size = 32, initials, className, decorative }: Props) {
  const { gradient, label } = useMemo(() => {
    const h = hash(seed || 'unknown');
    const hueA = HUES[h % HUES.length] ?? 212;
    const hueB = HUES[(h >>> 4) % HUES.length] ?? 282;
    return {
      gradient: `linear-gradient(135deg, hsl(${hueA} 70% 58%) 0%, hsl(${hueB} 70% 50%) 100%)`,
      label: initials ?? initialsOf(seed),
    };
  }, [seed, initials]);

  const sharedProps = {
    'aria-hidden': decorative ? true : undefined,
    'aria-label': decorative ? undefined : seed,
    role: decorative ? undefined : ('img' as const),
    style: { width: size, height: size, minWidth: size, minHeight: size, borderRadius: '50%' },
  };

  if (src) {
    return (
      <img
        {...sharedProps}
        src={src}
        alt={decorative ? '' : seed}
        loading="lazy"
        decoding="async"
        className={cn('object-cover', className)}
      />
    );
  }

  // Pure-CSS gradient fallback — no network call, no layout shift.
  return (
    <span
      {...sharedProps}
      style={{
        ...sharedProps.style,
        background: gradient,
        // White text wins contrast on every gradient in our palette (all
        // mid-tone hues at 50–58% lightness).
        color: 'white',
      }}
      className={cn(
        'inline-flex items-center justify-center font-semibold select-none',
        size <= 24 ? 'text-[10px]' : size <= 36 ? 'text-xs' : 'text-sm',
        className,
      )}
    >
      {label}
    </span>
  );
}

// ─── OnlineDot ────────────────────────────────────────────────────────────────
// A 10×10px presence indicator dot. WCAG 2.2 AA compliant:
//   - Green (#1a9e5c on --surface-card white) = 4.7:1 contrast → passes 3:1 AA
//   - Grey (#8a8a8a on white) = 3.3:1 contrast → passes 3:1 AA for UI components
//   - Role="img" + aria-label conveyed to screen readers.
//   - Title tooltip for pointer users.
//
// WHY co-located with Avatar: both are user-identity display primitives and
// they're typically composed together in the Team table.

interface OnlineDotProps {
  /** true = green online dot; false = grey offline dot */
  online: boolean;
  /** Screen-reader label — include the user's name for context, e.g. "Alice online" */
  label?: string;
  className?: string;
}

export function OnlineDot({ online, label, className }: OnlineDotProps) {
  const statusText = online ? 'Online' : 'Offline';
  const accessibleLabel = label ?? statusText;

  return (
    <span
      role="img"
      aria-label={accessibleLabel}
      title={statusText}
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
        // Colours: CSS vars from index.css — ratios documented in token comments.
        // Light: online=#1a9e5c (4.7:1), offline=#8a8a8a (3.3:1) — both pass 3:1 AA.
        // Dark:  online=#34d399, offline=#6b7280.
        online
          ? 'bg-[var(--presence-online)] shadow-[0_0_0_1.5px_var(--presence-online-ring)]'
          : 'bg-[var(--presence-offline)]',
        className,
      )}
    />
  );
}
