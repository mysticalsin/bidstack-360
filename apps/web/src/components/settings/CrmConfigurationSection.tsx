import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Card, SectionHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';

import { CustomFieldsSection } from './CustomFieldsSection';
import { EmailTemplatesSection } from './EmailTemplatesSection';
import { LeadRotSection } from './LeadRotSection';
import { PipelineStagesSection } from './PipelineStagesSection';
import { StageGateSection } from './StageGateSection';
import { TagsSection } from './TagsSection';

export function CrmConfigurationSection() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6">
      <PipelineStagesSection />
      {/* Directly under the stages it governs. */}
      <StageGateSection />
      <LeadRotSection />
      <TagsSection />
      <EmailTemplatesSection />
      <CustomFieldsSection />
      {/* Inbound link to the predictive-scoring admin page — it had no entry
          point from any admin surface and was unreachable. */}
      <Card>
        <SectionHeader
          title={t('crmConfiguration.predictiveScoringTitle', 'Predictive lead & deal scoring')}
          caption={t(
            'crmConfiguration.predictiveScoringCaption',
            'Review trained model versions, metrics, and retrain history.',
          )}
        />
        <div className="p-5">
          <Link
            to="/admin/predictive"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm font-medium text-[var(--fg-primary)] transition-colors hover:bg-[var(--surface-hover)]"
          >
            <Icon name="sparkle" size={16} />
            {t('crmConfiguration.openPredictiveScoring', 'Open predictive scoring')}
          </Link>
        </div>
      </Card>
    </div>
  );
}
