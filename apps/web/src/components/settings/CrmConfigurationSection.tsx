import { CustomFieldsSection } from './CustomFieldsSection';
import { EmailTemplatesSection } from './EmailTemplatesSection';
import { LeadRotSection } from './LeadRotSection';
import { PipelineStagesSection } from './PipelineStagesSection';
import { TagsSection } from './TagsSection';

export function CrmConfigurationSection() {
  return (
    <div className="space-y-6">
      <PipelineStagesSection />
      <LeadRotSection />
      <TagsSection />
      <EmailTemplatesSection />
      <CustomFieldsSection />
    </div>
  );
}
