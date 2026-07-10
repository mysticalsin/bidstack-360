/**
 * Sandboxed iframe for PDF/HTML document preview.
 *
 * WHY: We need to present the document to the signer before they commit.
 * A sandboxed iframe prevents the embedded content from running scripts,
 * accessing the parent frame, or navigating away — critical for public-facing
 * signing pages where we can't trust the document source.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

interface DocumentPreviewIframeProps {
  /** Either a URL to a PDF or HTML document, or raw HTML string to srcdoc */
  src: string | null;
  /** If true, treat `src` as raw HTML for srcdoc instead of a URL */
  srcdoc?: boolean;
  title: string;
  className?: string;
  /** Height in px or CSS string. Default: 600px */
  height?: string | number;
}

export function DocumentPreviewIframe({
  src,
  srcdoc = false,
  title,
  className,
  height = 600,
}: DocumentPreviewIframeProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const { t } = useTranslation('signatures');

  const heightValue = typeof height === 'number' ? `${height}px` : height;

  if (!src) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-xl border border-dashed border-[var(--border-default)] bg-[var(--surface-sunken)] text-sm text-[var(--fg-tertiary)]',
          className,
        )}
        style={{ height: heightValue }}
        role="region"
        aria-label={t('documentPreviewIframe.regionAriaLabel', 'Document preview')}
      >
        {t('documentPreviewIframe.emptyMessage', 'No document preview available')}
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] text-sm',
          className,
        )}
        style={{ height: heightValue }}
        role="alert"
      >
        <span className="text-[var(--fg-secondary)]">
          {t('documentPreviewIframe.errorMessage', 'Unable to load document preview.')}
        </span>
        {!srcdoc && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            {t('documentPreviewIframe.openInNewTab', 'Open document in new tab')}
          </a>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn('relative overflow-hidden rounded-xl border border-[var(--border-subtle)]', className)}
      style={{ height: heightValue }}
      role="region"
      aria-label={t('documentPreviewIframe.regionAriaLabelTitled', 'Document preview: {{title}}', { title })}
    >
      {!loaded && (
        // Document-shaped shimmer (title line + paragraph lines) from the
        // shared bs-shimmer skeleton system — the preview "loads itself"
        // instead of hiding behind a spinner.
        <div
          className="absolute inset-0 space-y-3 bg-[var(--surface-sunken)] p-6"
          aria-busy="true"
          aria-live="polite"
        >
          <span className="bs-shimmer block h-5 w-1/2" aria-hidden />
          <span className="bs-shimmer block h-3 w-full" aria-hidden />
          <span className="bs-shimmer block h-3 w-11/12" aria-hidden />
          <span className="bs-shimmer block h-3 w-full" aria-hidden />
          <span className="bs-shimmer block h-3 w-2/3" aria-hidden />
          <span className="sr-only">{t('documentPreviewIframe.loading', 'Loading document…')}</span>
        </div>
      )}
      <iframe
        // Minimal sandbox: allow-same-origin lets PDF.js work; everything else blocked
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        title={title}
        {...(srcdoc ? { srcDoc: src } : { src })}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={cn('h-full w-full border-0', !loaded && 'invisible')}
        aria-label={t('documentPreviewIframe.iframeAriaLabel', 'Preview of {{title}}', { title })}
      />
    </div>
  );
}
