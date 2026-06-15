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
          className="-mr-1 ml-0.5 grid h-4 w-4 place-items-center rounded-full hover:bg-black/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current"
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

/**
 * Returns black or white depending on which gives the higher contrast against
 * the supplied hex background. Sufficient for the tag palette which is all
 * mid-saturation; full APCA would be nicer but is overkill here.
 */
function contrastingTextColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return '#0F1320';
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  // Perceived luminance (Rec. 601 — close enough for chip contrast)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0F1320' : '#ffffff';
}
