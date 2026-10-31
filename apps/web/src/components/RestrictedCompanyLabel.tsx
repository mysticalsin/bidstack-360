import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/ui/Icon';

/** Non-clickable stand-in for a company outside the caller's scope. */
export function RestrictedCompanyLabel({ className = '' }: { className?: string }) {
  const { t } = useTranslation('crm');
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm text-[var(--fg-secondary)] ${className}`}
      title={t('restrictedCompany.hint', 'Outside your access scope')}
      data-restricted="true"
    >
      <Icon name="shield" size={14} className="text-[var(--fg-tertiary)]" />
      {t('restrictedCompany.name', 'Restricted company')}
      <span className="sr-only">{t('restrictedCompany.srHint', '(outside your access scope)')}</span>
    </span>
  );
}
