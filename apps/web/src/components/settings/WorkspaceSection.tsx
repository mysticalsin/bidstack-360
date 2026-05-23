import { WorkspaceSection as OriginalWorkspaceSection } from './WorkspaceSection.original';
import { TeamSection } from './TeamSection';
import { RolesSection } from './RolesSection';
import { CurrencyLocaleSection } from './CurrencyLocaleSection';
import { PipelineStagesSection } from './PipelineStagesSection';

export function WorkspaceSection() {
  return (
    <div className="space-y-6">
      <OriginalWorkspaceSection />
      <TeamSection />
      <RolesSection />
      <CurrencyLocaleSection />
      <PipelineStagesSection />
    </div>
  );
}
