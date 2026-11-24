import { useState, type CSSProperties } from 'react';

import { Tooltip } from '@/components/ui/Tooltip';

import { techLogoUrl } from './techIconSlug';

interface TechLogoProps {
  name: string;
  size?: number;
  /** Kept so older call sites compile. The plate colour is fixed so brand marks stay true. */
  color?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Tech-stack glyph: the real brand mark on a light plate (Simple Icons / curated
 * favicon, same-origin proxy), with a two-letter monogram when the mark is
 * missing or fails. Never a broken image. Hover and keyboard focus name the product.
 */
export function TechLogo({ name, size = 16, className, style }: TechLogoProps) {
  const url = techLogoUrl(name);
  const [failed, setFailed] = useState(false);
  const label = name.trim() || 'Technology';
  const mark = url && !failed ? (
    <span
      className={className}
      data-tech-logo={label}
      data-plate="brand"
      title={label}
      aria-hidden
      style={plateStyle(size, style)}
    >
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: '68%', height: '68%', objectFit: 'contain' }}
      />
    </span>
  ) : (
    <span
      className={className}
      data-tech-logo={label}
      data-fallback="monogram"
      title={label}
      aria-hidden
      style={monogramStyle(size, toneForName(label), style)}
    >
      {techMonogram(label)}
    </span>
  );

  return (
    <Tooltip content={label}>
      {mark}
    </Tooltip>
  );
}

/** Two letters so brands that share a first letter (Azure / AWS) stay distinct. */
export function techMonogram(name: string): string {
  const parts = name.trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  const words = parts.filter((part) => /[A-Za-z]/.test(part));
  if (words.length >= 2) return `${words[0]![0] ?? ''}${words[1]![0] ?? ''}`.toUpperCase();
  const word = words[0] ?? parts[0] ?? '';
  const letters = word.replace(/[^A-Za-z0-9]/g, '');
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return letters.toUpperCase();
  return '?';
}

function plateStyle(size: number, style?: CSSProperties): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: Math.max(6, Math.round(size * 0.22)),
    overflow: 'hidden',
    flexShrink: 0,
    // Light plate in both themes. Black brand marks (GitHub, and others) disappear on a dark tile.
    background: '#fff',
    border: '1px solid color-mix(in srgb, #171717 14%, transparent)',
    boxShadow: '0 1px 1px rgb(0 0 0 / 0.04)',
    ...style,
  };
}

function monogramStyle(size: number, tone: string, style?: CSSProperties): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    borderRadius: Math.max(6, Math.round(size * 0.22)),
    background: `color-mix(in srgb, ${tone} 16%, var(--surface-card))`,
    color: tone,
    border: `1px solid color-mix(in srgb, ${tone} 38%, var(--border-default))`,
    fontSize: Math.max(10, Math.round(size * 0.38)),
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1,
    flexShrink: 0,
    ...style,
  };
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
  return tones[sum % tones.length] ?? 'var(--fg-secondary)';
}
