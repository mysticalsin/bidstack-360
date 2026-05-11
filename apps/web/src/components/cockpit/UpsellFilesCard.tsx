import { Card, SectionHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/StateMessages';

// Empty-state surrogate for the Files card on the org-wide /dashboard view.
// Files are scoped per account, so without an accountId we point the user
// at /accounts to pick one rather than rendering an unusable upload zone.
export function UpsellFilesCard() {
  return (
    <Card>
      <SectionHeader title="Files" />
      <div style={{ padding: '16px 18px 20px' }}>
        <EmptyState
          title="Pick an account"
          message="Open an account from /accounts to attach proposals, NDAs, and reference architectures."
        />
      </div>
    </Card>
  );
}
