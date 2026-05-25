// Settings → Advanced. Admin-only workspace configuration:
// Custom Fields, Webhooks, API Keys.

import { CustomFieldsSection } from './CustomFieldsSection';
import { WebhooksSection } from './WebhooksSection';
import { ApiKeysSection } from './ApiKeysSection';

export function AdvancedSection() {
  return (
    <div className="space-y-6">
      <CustomFieldsSection />
      <WebhooksSection />
      <ApiKeysSection />
    </div>
  );
}
