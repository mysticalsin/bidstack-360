import { useTranslation } from 'react-i18next';

import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';

// Empty-state surrogate for the Files card on the org-wide /dashboard view.
// Files are scoped per account, so without an accountId we point the user
// at /accounts to pick one rather than rendering an unusable upload zone.
export function UpsellFilesCard() {
  const { t } = useTranslation('crm');
  return (
    <Card>
      <SectionHeader title={t('upsellFiles.title', 'Files')} />
      <div style={{ padding: '16px 18px 20px' }}>
        <EmptyState
          title={t('upsellFiles.emptyTitle', 'Pick an account')}
          message={t(
            'upsellFiles.emptyMessage',
            'Open an account from /accounts to attach proposals, NDAs, and reference architectures.',
          )}
        />
      </div>
    </Card>
  );
}
