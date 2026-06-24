import { useState, forwardRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { HoverCard } from '@/components/ui/HoverCard';
import { buildApiUrl } from '@/lib/api';
import type { CrmLogo } from '@bidstack/shared';

import { displayableLogoUrl } from './logoUrlSafety';

interface CompanyLogoProps {
  name: string;
  /** CRM-resolved logo. Same-origin/proxied assets render; raw third-party URLs fall back. */
  logo?: CrmLogo | null;
  /** Bare domain (no protocol). Gates the same-origin logo proxy + attribution. */
  domain?: string | null;
  /** When set with a real domain, pulls the live logo via the same-origin proxy
   *  (/companies/:id/logo → logo.dev/Clearbit), falling back to initials. */
  companyId?: string | null;
  size?: number;
  className?: string;
  /** When provided, wraps the logo in a HoverCard that reveals a data brief. */
  brief?: ReactNode;
  /** Above-the-fold? Triggers fetchpriority="high" + eager loading. */
  priority?: boolean;
}

// Logo source chain:
//   1. Same-origin/proxied CRM logo assets
//   2. Initials fallback (always works, no third-party runtime request)
export const CompanyLogo = forwardRef<HTMLSpanElement, CompanyLogoProps>(function CompanyLogo(
  { name, logo, domain, size = 36, className, brief, priority = false },
  ref,
) {
  const { t } = useTranslation('crm');
  const sources: string[] = [];
  const normalizedDomain = normalizeDomain(domain);
  const logoUrl = displayableLogoUrl(logo?.url);

  // Live logo via the same-origin domain proxy — only for a real (non-reserved)
  // domain, so no-domain companies don't fire 404s. Falls through to logo.url /
  // initials on miss.
  if (normalizedDomain && !isReservedDomain(normalizedDomain)) {
    // buildApiUrl prefixes VITE_API_URL so the <img> reaches the API on the
    // split-origin demo (Vercel SPA → Railway API); a bare /api path would hit
    // the SPA's catch-all rewrite and return index.html (broken image).
    sources.push(buildApiUrl(`/api/v1/logo?domain=${encodeURIComponent(normalizedDomain)}`));
  }
  if (logoUrl && !isReservedDomain(normalizedDomain)) {
    sources.push(logoUrl);
  }

  const [sourceIdx, setSourceIdx] = useState(0);
  const url = sources[sourceIdx] ?? null;

  const glyph = (
    <span
      ref={ref}
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.18)),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        background: 'var(--brand-primary-tint)',
        color: 'var(--brand-primary)',
        border: '1px solid var(--border-default)',
        fontSize: Math.max(11, Math.round(size * 0.3)),
        fontWeight: 700,
      }}
      title={logo?.attribution?.label ?? t('companyLogo.ariaLabel', '{{name}} logo', { name })}
      role="img"
      aria-label={t('companyLogo.ariaLabel', '{{name}} logo', { name })}
    >
      {url ? (
        <img
          // Cache-bust source switches so the browser actually retries the next URL.
          key={`${sourceIdx}-${url}`}
          src={url}
          // Logo is decorative — the brand name is already announced by the
          // wrapping aria-label, so an empty alt is correct per WCAG H67
          // (text alternatives for images that are decorative). Explicit
          // empty alt (vs. omitted) tells screen readers to skip the image.
          alt=""
          // Above-the-fold logos (cockpit hero) get eager loading + high
          // fetchpriority to keep them out of the LCP critical path. Below
          // the fold they stay lazy. `decoding="async"` is safe in both
          // cases — keeps the main thread responsive while the image
          // decodes.
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setSourceIdx((i) => i + 1)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }}
        />
      ) : (
        initialsFor(name)
      )}
    </span>
  );

  if (brief) {
    return <HoverCard content={brief}>{glyph}</HoverCard>;
  }
  return glyph;
});

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const [host] = domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/');
  return host?.trim().toLowerCase() || null;
}

function isReservedDomain(domain: string | null): boolean {
  if (!domain) return false;
  return (
    domain.endsWith('.example') ||
    domain.endsWith('.invalid') ||
    domain.endsWith('.localhost') ||
    domain.endsWith('.test') ||
    domain === 'example.com' ||
    domain === 'example.org' ||
    domain === 'example.net'
  );
}

function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : name.slice(0, 2))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}
