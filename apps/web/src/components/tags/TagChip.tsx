import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import type { Tag } from '@bidstack/shared';

/**
 * Sprint 1 — Krayin import.
 * A single tag chip. Renders the tag's name on top of its colour, with
 * runtime-computed text contrast so the chip never falls below WCAG 2.2 AA
 * 4.5:1 regardless of which palette colour the user picked.
 *
 * Per code-quality.md the effective touch target stays ≥ 44px when used as
 * a clickable chip (parent sets that via padding); as a static label we let
 * it be more compact.
 */
interface TagChipProps {
  tag: Pick<Tag, 'id' | 'name' | 'color'>;
  onRemove?: () => void;
  interactive?: boolean;
  size?: 'sm' | 'md';
}

export function TagChip({ tag, onRemove, interactive = false, size = 'sm' }: TagChipProps) {
  const { t } = useTranslation('crm');
  const fg = useMemo(() => contrastingTextColor(tag.color), [tag.color]);

  return (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={t('tagChip.tagLabel', '{{name}}, tag', { name: tag.name })}
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium leading-none align-middle',
        size === 'sm' ? 'h-6 px-2.5 text-[11px]' : 'h-7 px-3 text-xs',
        interactive &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--brand-primary)]',
      )}
      style={{ backgroundColor: tag.color, color: fg }}
    >
      <span className="truncate max-w-[180px]">{tag.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={t('tagChip.removeTag', 'Remove tag {{name}}', { name: tag.name })}
          // Visible glyph stays 16px to preserve the chip's design; the tap
          // target is expanded to ≥44px on coarse pointers via an invisible
          // overlay (`before:`) so touch users get a WCAG 2.5.8 / 2.2 AA hit
          // area without changing the visual layout.
          className={cn(
            '-mr-1 ml-0.5 relative grid h-4 w-4 place-items-center rounded-full',
            'hover:bg-black/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current',
            'before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2',
            'before:h-11 before:w-11 before:content-[""] before:hidden pointer-coarse:before:block',
          )}
          style={{ color: fg }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path
              d="M2 2l6 6M8 2l-6 6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

const DARK_TEXT = '#0F1320';
const LIGHT_TEXT = '#ffffff';

/**
 * Returns the dark or light text token that has the higher WCAG 2.x contrast
 * ratio against the supplied hex background. A pure luminance threshold is not
 * enough: for mid-saturation palette colours (e.g. a ~0.45-luminance blue)
 * white-on-colour can sit at ~3.7:1 — below AA — while the old threshold still
 * picked white. Computing the real ratio for both candidates and taking the
 * winner guarantees we land on whichever side clears (or best approaches)
 * 4.5:1 for the actual palette colour.
 */
function contrastingTextColor(hex: string): string {
  const bg = relativeLuminance(hex);
  if (bg === null) return DARK_TEXT;
  const darkLum = relativeLuminance(DARK_TEXT) ?? 0;
  const lightLum = 1; // #ffffff
  const onDark = contrastRatio(bg, darkLum);
  const onLight = contrastRatio(bg, lightLum);
  return onDark >= onLight ? DARK_TEXT : LIGHT_TEXT;
}

/** WCAG relative luminance of a #rrggbb colour, or null if unparseable. */
function relativeLuminance(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return null;
  const num = parseInt(m[1], 16);
  const channels = [(num >> 16) & 0xff, (num >> 8) & 0xff, num & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}
