import { useId, useState, type ComponentPropsWithoutRef } from 'react';

// Mirrored from apps/web/src/components/brand/BidStack360Logo.tsx. Keep in
// sync; future @bidstack/ui package extraction will collapse this duplication.

type LogoVariant = 'full' | 'mark';
type LogoTone = 'default' | 'mono' | 'inverse';

interface BidStack360LogoProps extends Omit<ComponentPropsWithoutRef<'svg'>, 'title'> {
  variant?: LogoVariant;
  tone?: LogoTone;
  title?: string;
  showSubtitle?: boolean;
}

const PALETTE = {
  markGradientStart: '#B49CFF',
  markGradientEnd: '#7C3AED',
  ringStroke: '#A78BFA',
  ringDot: '#7C3AED',
  wordmarkDeep: '#3F1E8F',
  wordmarkLight: '#A78BFA',
  subtitle: '#6D28D9',
} as const;

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(' ');
}

function imageAssetFor(variant: LogoVariant, tone: LogoTone): string | null {
  if (variant === 'mark') {
    return tone === 'inverse'
      ? '/brand/bidstack360-mark-inverse.png'
      : '/brand/bidstack360-mark.png';
  }
  return tone === 'inverse' ? '/brand/bidstack360-logo-inverse.png' : '/brand/bidstack360-logo.png';
}

export function BidStack360Logo({
  variant = 'full',
  tone = 'default',
  title = 'BidStack 360° by Mantu',
  showSubtitle = true,
  className,
  ...rest
}: BidStack360LogoProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageSrc = imageAssetFor(variant, tone);

  if (imageSrc && !imageFailed) {
    return (
      <img
        src={imageSrc}
        alt={title}
        className={cx('h-10 w-auto shrink-0 object-contain', className)}
        onError={() => setImageFailed(true)}
        decoding="async"
        loading="eager"
      />
    );
  }

  return (
    <BidStack360LogoSvg
      variant={variant}
      tone={tone}
      title={title}
      showSubtitle={showSubtitle}
      className={className}
      {...rest}
    />
  );
}

export function BidStack360LogoSvg({
  variant = 'full',
  tone = 'default',
  title = 'BidStack 360° by Mantu',
  showSubtitle = true,
  className,
  ...rest
}: BidStack360LogoProps) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const gradId = `bs360-grad-${rawId}`;
  const titleId = title ? `bs360-title-${rawId}` : undefined;

  const isMono = tone !== 'default';
  const markFill = isMono ? 'currentColor' : `url(#${gradId})`;
  const ringStroke = isMono ? 'currentColor' : PALETTE.ringStroke;
  const ringDot = isMono ? 'currentColor' : PALETTE.ringDot;
  const wordmarkFillDeep = isMono ? 'currentColor' : PALETTE.wordmarkDeep;
  const wordmarkFillLight = isMono ? 'currentColor' : PALETTE.wordmarkLight;
  const subtitleFill = isMono ? 'currentColor' : PALETTE.subtitle;

  const fullViewBox = showSubtitle ? '0 0 220 56' : '0 0 200 48';
  const toneClass = tone === 'inverse' ? 'text-white' : tone === 'mono' ? 'text-current' : '';

  return (
    <svg
      viewBox={variant === 'mark' ? '0 0 48 48' : fullViewBox}
      role={title ? 'img' : undefined}
      aria-labelledby={titleId}
      aria-hidden={title ? undefined : true}
      className={cx('h-10 w-auto shrink-0', toneClass, className)}
      {...rest}
    >
      {title ? <title id={titleId}>{title}</title> : null}

      {!isMono ? (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={PALETTE.markGradientStart} />
            <stop offset="100%" stopColor={PALETTE.markGradientEnd} />
          </linearGradient>
        </defs>
      ) : null}

      <g>
        <path
          d="M 24 4 A 20 20 0 0 1 43.4 28.5"
          fill="none"
          stroke={ringStroke}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M 24 44 A 20 20 0 0 1 4.6 19.5"
          fill="none"
          stroke={ringStroke}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <circle cx="43.4" cy="28.5" r="1.8" fill={ringDot} />
        <circle cx="4.6" cy="19.5" r="1.8" fill={ringDot} />

        <path
          fill={markFill}
          fillRule="evenodd"
          d="M 14 10
             H 25
             A 7 7 0 0 1 25 24
             H 25.4
             A 7.5 7.5 0 0 1 25.4 39
             H 14
             Z
             M 18 14
             V 20
             H 24
             A 3 3 0 0 0 24 14
             Z
             M 18 28
             V 35
             H 25
             A 3.5 3.5 0 0 0 25 28
             Z"
        />
      </g>

      {variant === 'full' ? (
        <g>
          <text
            x="58"
            y="28"
            fontFamily="Barlow, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fontSize="20"
            fontWeight="700"
            letterSpacing="-0.3"
            fill={wordmarkFillDeep}
          >
            BidStack
          </text>
          <text
            x="138"
            y="28"
            fontFamily="Barlow, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fontSize="20"
            fontWeight="700"
            letterSpacing="-0.3"
            fill={wordmarkFillLight}
          >
            360
          </text>
          <text
            x="178"
            y="16"
            fontFamily="Barlow, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
            fontSize="11"
            fontWeight="700"
            fill={wordmarkFillLight}
          >
            °
          </text>
          {showSubtitle ? (
            <text
              x="59"
              y="44"
              fontFamily="Barlow, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
              fontSize="8.5"
              fontWeight="600"
              letterSpacing="1.2"
              fill={subtitleFill}
            >
              BY MANTU · BID SMART. WIN MORE.
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
