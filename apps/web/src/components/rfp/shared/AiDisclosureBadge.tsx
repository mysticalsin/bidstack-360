import { useTranslation } from 'react-i18next';

/**
 * AI-assisted draft disclosure badge.
 * Required by EU AI Act Art. 50 (transparency for AI-generated content).
 * Must appear on every AI-drafted proposal section visible to the end user.
 */
export function AiDisclosureBadge() {
  const { t } = useTranslation('rfp');

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[var(--tag-amber-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tag-amber-fg)]"
      aria-label={t('aiDisclosureBadge.ariaLabel', 'This content was generated with AI assistance')}
      title={t('aiDisclosureBadge.title', 'AI-assisted draft — review before sending')}
    >
      <span aria-hidden="true">✦</span>
      {t('aiDisclosureBadge.label', 'AI-assisted draft')}
    </span>
  );
}
