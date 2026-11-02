import { useId, type ComponentPropsWithoutRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';

type LogoVariant = 'full' | 'mark';
type LogoTone = 'default' | 'mono' | 'inverse';

interface PoloPreSalesLogoProps extends ComponentPropsWithoutRef<'svg'> {
  variant?: LogoVariant;
  tone?: LogoTone;
  title?: string;
}

// Compass-pin lockup: a teal-to-silver location ring, a gold four-point star,
// and the word "Polo" on a dark navy field. The accessible name stays
// "Polo PreSales". Outlines (not <text>) so the wordmark does not depend on
// a webfont. Poppins Bold glyph paths, y-up, placed with a flip scale.
const PIN_PATH =
  'M 94.70 183.62 A 94.00 94.00 0 1 1 225.30 183.62 C 183.37 224.10 163.74 281.14 160.00 292.00 C 156.26 281.14 136.63 224.10 94.70 183.62 ZM 160 55.00 A 55 55 0 1 0 160 165.00 A 55 55 0 1 0 160 55.00 Z';
const STAR_PATH = 'M 160 60 L 171 99 L 208 110 L 171 121 L 160 160 L 149 121 L 112 110 L 149 99 Z';
const POLO_WORD_PATH =
  'M 339 252L 233 252L 233 0L 62 0L 62 702L 339 702Q 423 702 481 673Q 539 644 568 593Q 597 542 597 476Q 597 415 569 364.5Q 541 314 483 283Q 425 252 339 252ZM 423 476Q 423 518 399 541Q 375 564 326 564L 233 564L 233 388L 326 388Q 375 388 399 411Q 423 434 423 476ZM 708 279Q 708 365 746 430.5Q 784 496 850 531Q 916 566 998 566Q 1080 566 1146 531Q 1212 496 1250 430.5Q 1288 365 1288 279Q 1288 193 1249.5 127.5Q 1211 62 1144.5 27Q 1078 -8 996 -8Q 914 -8 848.5 27Q 783 62 745.5 127Q 708 192 708 279ZM 1114 279Q 1114 346 1080.5 382Q 1047 418 998 418Q 948 418 915 382.5Q 882 347 882 279Q 882 212 914.5 176Q 947 140 996 140Q 1045 140 1079.5 176Q 1114 212 1114 279ZM 1606 740L 1606 0L 1435 0L 1435 740ZM 1752 279Q 1752 365 1790 430.5Q 1828 496 1894 531Q 1960 566 2042 566Q 2124 566 2190 531Q 2256 496 2294 430.5Q 2332 365 2332 279Q 2332 193 2293.5 127.5Q 2255 62 2188.5 27Q 2122 -8 2040 -8Q 1958 -8 1892.5 27Q 1827 62 1789.5 127Q 1752 192 1752 279ZM 2158 279Q 2158 346 2124.5 382Q 2091 418 2042 418Q 1992 418 1959 382.5Q 1926 347 1926 279Q 1926 212 1958.5 176Q 1991 140 2040 140Q 2089 140 2123.5 176Q 2158 212 2158 279Z';

const PLATE_W = 320;
const PLATE_H = 408;
const STAR_CX = 160;
const STAR_CY = 110;
const STAR_R = 6;
const WORD_TRANSFORM = 'translate(28.17 385.50) scale(0.110132 -0.110132)';

export function PoloPreSalesLogo({
  variant = 'full',
  tone = 'default',
  title,
  className,
  ...rest
}: PoloPreSalesLogoProps) {
  const { t } = useTranslation('crm');
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pinId = `polo-pin-${rawId}`;
  const starId = `polo-star-${rawId}`;
  const wordId = `polo-word-${rawId}`;
  const resolvedTitle = title ?? t('poloPreSalesLogo.title', 'Polo PreSales');
  const titleId = resolvedTitle ? `polo-logo-${rawId}` : undefined;

  // Default paints the reference lockup. Mono and inverse collapse to a single
  // ink so the mark still reads on the rail badge and other colored surfaces.
  const colored = tone === 'default';
  const pinFill = colored ? `url(#${pinId})` : 'currentColor';
  const starFill = colored ? `url(#${starId})` : 'currentColor';
  const wordFill = colored ? `url(#${wordId})` : 'currentColor';
  const starHole = `M ${STAR_CX} ${STAR_CY - STAR_R} A ${STAR_R} ${STAR_R} 0 1 0 ${STAR_CX} ${STAR_CY + STAR_R} A ${STAR_R} ${STAR_R} 0 1 0 ${STAR_CX} ${STAR_CY - STAR_R} Z`;

  return (
    <svg
      viewBox={variant === 'mark' ? '56 12 208 292' : `0 0 ${PLATE_W} ${PLATE_H}`}
      role={resolvedTitle ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={resolvedTitle ? undefined : true}
      className={cn('h-16 w-auto shrink-0', tone === 'inverse' && 'text-white', className)}
      fill="none"
      {...rest}
    >
      {resolvedTitle ? <title id={titleId}>{resolvedTitle}</title> : null}
      {colored ? (
        <defs>
          <linearGradient id={pinId} x1="248" y1="22" x2="70" y2="292" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F8FBFE" />
            <stop offset="0.32" stopColor="#E4EBF1" />
            <stop offset="0.58" stopColor="#7ED4E3" />
            <stop offset="1" stopColor="#14B8D2" />
          </linearGradient>
          <linearGradient id={starId} x1="118" y1="60" x2="202" y2="160" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFF4D4" />
            <stop offset="0.45" stopColor="#F3D48A" />
            <stop offset="1" stopColor="#E0A44A" />
          </linearGradient>
          {variant === 'full' ? (
            <linearGradient id={wordId} x1="0" y1="0" x2="1" y2="0.15" gradientUnits="objectBoundingBox">
              <stop offset="0" stopColor="#F2F7F8" />
              <stop offset="0.55" stopColor="#F7F8F9" />
              <stop offset="1" stopColor="#F3EEE6" />
            </linearGradient>
          ) : null}
        </defs>
      ) : null}
      {colored && variant === 'full' ? (
        <rect width={PLATE_W} height={PLATE_H} rx="34" fill="#071422" />
      ) : null}
      <path d={PIN_PATH} fill={pinFill} fillRule="evenodd" />
      <path d={colored ? STAR_PATH : `${STAR_PATH}${starHole}`} fill={starFill} fillRule="evenodd" />
      {colored ? <circle cx={STAR_CX} cy={STAR_CY} r={STAR_R} fill="#071422" /> : null}
      {variant === 'full' ? <path d={POLO_WORD_PATH} fill={wordFill} transform={WORD_TRANSFORM} /> : null}
    </svg>
  );
}
