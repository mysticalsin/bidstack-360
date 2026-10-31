import { useId, type ComponentPropsWithoutRef } from 'react';

// Mirrored from apps/web/src/components/brand/PoloPreSalesLogo.tsx. Keep in
// sync; a future @bidstack/ui package extraction will collapse this duplication.

type LogoVariant = 'full' | 'mark';
type LogoTone = 'default' | 'mono' | 'inverse';

interface PoloPreSalesLogoProps extends Omit<ComponentPropsWithoutRef<'svg'>, 'title'> {
  variant?: LogoVariant;
  tone?: LogoTone;
  title?: string;
  showSubtitle?: boolean;
}

// Compass-pin lockup. See the web component for the geometry notes.
const PIN_PATH =
  'M 94.70 183.62 A 94.00 94.00 0 1 1 225.30 183.62 C 183.37 224.10 163.74 281.14 160.00 292.00 C 156.26 281.14 136.63 224.10 94.70 183.62 ZM 160 55.00 A 55 55 0 1 0 160 165.00 A 55 55 0 1 0 160 55.00 Z';
const STAR_PATH = 'M 160 60 L 171 99 L 208 110 L 171 121 L 160 160 L 149 121 L 112 110 L 149 99 Z';
const POLO_WORD_PATH =
  'M 339 252L 233 252L 233 0L 62 0L 62 702L 339 702Q 423 702 481 673Q 539 644 568 593Q 597 542 597 476Q 597 415 569 364.5Q 541 314 483 283Q 425 252 339 252ZM 423 476Q 423 518 399 541Q 375 564 326 564L 233 564L 233 388L 326 388Q 375 388 399 411Q 423 434 423 476ZM 708 279Q 708 365 746 430.5Q 784 496 850 531Q 916 566 998 566Q 1080 566 1146 531Q 1212 496 1250 430.5Q 1288 365 1288 279Q 1288 193 1249.5 127.5Q 1211 62 1144.5 27Q 1078 -8 996 -8Q 914 -8 848.5 27Q 783 62 745.5 127Q 708 192 708 279ZM 1114 279Q 1114 346 1080.5 382Q 1047 418 998 418Q 948 418 915 382.5Q 882 347 882 279Q 882 212 914.5 176Q 947 140 996 140Q 1045 140 1079.5 176Q 1114 212 1114 279ZM 1606 740L 1606 0L 1435 0L 1435 740ZM 1752 279Q 1752 365 1790 430.5Q 1828 496 1894 531Q 1960 566 2042 566Q 2124 566 2190 531Q 2256 496 2294 430.5Q 2332 365 2332 279Q 2332 193 2293.5 127.5Q 2255 62 2188.5 27Q 2122 -8 2040 -8Q 1958 -8 1892.5 27Q 1827 62 1789.5 127Q 1752 192 1752 279ZM 2158 279Q 2158 346 2124.5 382Q 2091 418 2042 418Q 1992 418 1959 382.5Q 1926 347 1926 279Q 1926 212 1958.5 176Q 1991 140 2040 140Q 2089 140 2123.5 176Q 2158 212 2158 279Z';

const VIEW_W = 320;
const VIEW_H = 408;
const STAR_CX = 160;
const STAR_CY = 110;
const STAR_R = 6;
const WORD_TRANSFORM = 'translate(28.17 385.50) scale(0.110132 -0.110132)';

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ');
}

export function PoloPreSalesLogo({
  variant = 'full',
  tone = 'default',
  title = 'Polo PreSales by Mantu',
  showSubtitle = false,
  className,
  ...rest
}: PoloPreSalesLogoProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pinId = `polo-pin-${rawId}`;
  const starId = `polo-star-${rawId}`;
  const wordId = `polo-word-${rawId}`;
  const titleId = title ? `polo-title-${rawId}` : undefined;

  const colored = tone === 'default';
  const pinFill = colored ? `url(#${pinId})` : 'currentColor';
  const starFill = colored ? `url(#${starId})` : 'currentColor';
  const wordFill = colored ? `url(#${wordId})` : 'currentColor';
  const subtitleFill =
    tone === 'inverse' ? 'rgba(255,255,255,0.7)' : tone === 'mono' ? 'currentColor' : '#3E5560';
  const starHole = `M ${STAR_CX} ${STAR_CY - STAR_R} A ${STAR_R} ${STAR_R} 0 1 0 ${STAR_CX} ${STAR_CY + STAR_R} A ${STAR_R} ${STAR_R} 0 1 0 ${STAR_CX} ${STAR_CY - STAR_R} Z`;
  const fullHeight = showSubtitle ? VIEW_H + 36 : VIEW_H;
  const toneClass = tone === 'inverse' ? 'text-white' : '';

  return (
    <svg
      viewBox={variant === 'mark' ? '56 12 208 292' : `0 0 ${VIEW_W} ${fullHeight}`}
      role={title ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={title ? undefined : true}
      className={cx('w-auto shrink-0', toneClass, className)}
      fill="none"
      {...rest}
    >
      {title ? <title id={titleId}>{title}</title> : null}
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
              <stop offset="0" stopColor="#163844" />
              <stop offset="0.55" stopColor="#1C4654" />
              <stop offset="1" stopColor="#3A3832" />
            </linearGradient>
          ) : null}
        </defs>
      ) : null}
      <path d={PIN_PATH} fill={pinFill} fillRule="evenodd" />
      <path d={`${STAR_PATH}${starHole}`} fill={starFill} fillRule="evenodd" />
      {variant === 'full' ? (
        <>
          <path d={POLO_WORD_PATH} fill={wordFill} transform={WORD_TRANSFORM} />
          {showSubtitle ? (
            <text
              x="160"
              y={VIEW_H + 22}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              letterSpacing="1.8"
              fill={subtitleFill}
            >
              BY MANTU · BID SMART. WIN MORE.
            </text>
          ) : null}
        </>
      ) : null}
    </svg>
  );
}
