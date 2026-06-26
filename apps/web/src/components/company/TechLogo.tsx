import { useState, type CSSProperties } from 'react';

import { techLogoUrl } from './techIconSlug';

interface TechLogoProps {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Tech-stack glyph: the REAL brand logo via the same-origin proxy
 * (Simple Icons), with a deterministic colored monogram as the offline-safe
 * fallback (proxy 404 / unknown brand / load error). Never a broken image.
 */
export function TechLogo({ name, size = 16, className, style }: TechLogoProps) {
  const url = techLogoUrl(name);
  const [failed, setFailed] = useState(false);
  const tone = toneForName(name);

  if (url && !failed) {
    return (
      <span
        className={className}
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: Math.max(4, Math.round(size * 0.22)),
          overflow: 'hidden',
          flexShrink: 0,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          ...style,
        }}
      >
        <img
          src={url}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: '72%', height: '72%', objectFit: 'contain' }}
        />
      </span>
    );
  }

  return (
    <span
      className={className}
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: Math.max(4, Math.round(size * 0.22)),
        background: `linear-gradient(135deg, color-mix(in srgb, ${tone} 18%, var(--surface-raised)), var(--surface-sunken))`,
        color: tone,
        border: '1px solid color-mix(in srgb, currentColor 28%, var(--border-default))',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.12)',
        fontSize: Math.max(8, Math.round(size * 0.58)),
        fontWeight: 800,
        lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function toneForName(name: string): string {
  const tones = [
    'var(--tag-blue-fg)',
    'var(--tag-jade-fg)',
    'var(--tag-amber-fg)',
    'var(--tag-purple-fg)',
    'var(--tag-teal-fg)',
    'var(--tag-rose-fg)',
  ];
  const sum = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return tones[sum % tones.length] ?? 'var(--fg-tertiary)';
}
