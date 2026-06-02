import { WorkspaceSection as OriginalWorkspaceSection } from './WorkspaceSection.original';
import { TeamSection } from './TeamSection';
import { RolesSection } from './RolesSection';
import { CurrencyLocaleSection } from './CurrencyLocaleSection';

export function WorkspaceSection() {
  return (
    <div className="space-y-6">
      <OriginalWorkspaceSection />
      <TeamSection />
      <RolesSection />
      <CurrencyLocaleSection />
    </div>
  );
}
