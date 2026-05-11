// Avatar with deterministic gradient fallback when no image is available.
// Generates a brand-aware two-tone gradient from a hash of the seed string
// so the same name always produces the same gradient — visually distinct
// per person without needing real photos.

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
        color: '#fff',
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
