// CRM-style Settings page with left sidebar navigation.
// Sections: Profile, Appearance, Notifications, Security, Microsoft 365, Mobile, Workspace, Advanced.

import { useState } from 'react';
import { SettingsLayout, type SettingsSection } from '@/components/settings/SettingsLayout';
import { ProfileSection } from '@/components/settings/ProfileSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { NotificationPrefsSection } from '@/components/settings/NotificationPrefsSection';
import { SecuritySection } from '@/components/settings/SecuritySection';
import { MicrosoftSection } from '@/components/settings/MicrosoftSection';
import { MobileSection } from '@/components/settings/MobileSection';
import { WorkspaceSection } from '@/components/settings/WorkspaceSection';
import { AdvancedSection } from '@/components/settings/AdvancedSection';

const SECTIONS: Record<SettingsSection, React.ReactNode> = {
  profile: <ProfileSection />,
  appearance: <AppearanceSection />,
  notifications: <NotificationPrefsSection />,
  security: <SecuritySection />,
  microsoft: <MicrosoftSection />,
  mobile: <MobileSection />,
  workspace: <WorkspaceSection />,
  advanced: <AdvancedSection />,
};

const SECTION_TITLES: Record<SettingsSection, string> = {
  profile: 'Profile',
  appearance: 'Appearance',
  notifications: 'Notifications',
  security: 'Security',
  microsoft: 'Microsoft 365',
  mobile: 'Mobile App',
  workspace: 'Workspace',
  advanced: 'Advanced',
};

export function SettingsPage() {
  const [active, setActive] = useState<SettingsSection>('profile');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Manage your account, preferences, and workspace integrations.
        </p>
      </header>

      <SettingsLayout active={active} onChange={setActive}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[var(--fg-primary)]">
            {SECTION_TITLES[active]}
          </h2>
        </div>
        {SECTIONS[active]}
      </SettingsLayout>
    </div>
  );
}
