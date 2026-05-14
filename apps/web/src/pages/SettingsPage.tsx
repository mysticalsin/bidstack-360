import { ApiKeysSection } from '@/components/settings/ApiKeysSection';
import { CustomFieldsSection } from '@/components/settings/CustomFieldsSection';
import { WorkspaceSection } from '@/components/settings/WorkspaceSection';
import { TeamSection } from '@/components/settings/TeamSection';
import { NotificationPrefsSection } from '@/components/settings/NotificationPrefsSection';
import { PipelineStagesSection } from '@/components/settings/PipelineStagesSection';
import { CurrencyLocaleSection } from '@/components/settings/CurrencyLocaleSection';
import { WebhooksSection } from '@/components/settings/WebhooksSection';
import { Card, SectionHeader } from '@/components/ui/Card';
import { useIsAdmin } from '@/lib/auth';
import { usePreferences, type Density, type MotionPref } from '@/stores/preferences';
import { useThemeStore } from '@/stores/theme';

export function SettingsPage() {
  const isAdmin = useIsAdmin();
  const { theme, setTheme } = useThemeStore();
  const density = usePreferences((s) => s.density);
  const setDensity = usePreferences((s) => s.setDensity);
  const motion = usePreferences((s) => s.motion);
  const setMotion = usePreferences((s) => s.setMotion);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Personalize BidStack, manage your team, and configure workspace defaults.
        </p>
      </header>

      <WorkspaceSection />
      <TeamSection />
      <NotificationPrefsSection />
      <CurrencyLocaleSection />
      <PipelineStagesSection />

      <Card>
        <SectionHeader title="Appearance" caption="Theme follows your OS by default." />
        <div className="p-5">
          <fieldset>
            <legend className="sr-only">Theme</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ThemeOption
                value="light"
                label="Light"
                description="Bright surfaces, sharp contrast."
                checked={theme === 'light'}
                onChange={() => setTheme('light')}
              />
              <ThemeOption
                value="dark"
                label="Dark"
                description="Dim surfaces, easier on the eyes at night."
                checked={theme === 'dark'}
                onChange={() => setTheme('dark')}
              />
            </div>
          </fieldset>
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Density"
          caption="How much breathing room tables and forms give themselves."
        />
        <div className="p-5">
          <fieldset>
            <legend className="sr-only">Density</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <RadioOption
                name="density"
                value="compact"
                label="Compact"
                description="More rows per screen. Best on large monitors."
                checked={density === 'compact'}
                onChange={() => setDensity('compact')}
              />
              <RadioOption
                name="density"
                value="comfortable"
                label="Comfortable"
                description="The default — balanced for most workflows."
                checked={density === 'comfortable'}
                onChange={() => setDensity('comfortable')}
              />
              <RadioOption
                name="density"
                value="spacious"
                label="Spacious"
                description="Roomier targets. Pairs well with touch input."
                checked={density === 'spacious'}
                onChange={() => setDensity('spacious')}
              />
            </div>
          </fieldset>
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Motion"
          caption='"System" follows your OS reduced-motion preference; the others override it.'
        />
        <div className="p-5">
          <fieldset>
            <legend className="sr-only">Motion preference</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <RadioOption
                name="motion"
                value="system"
                label="System"
                description="Honor the OS setting."
                checked={motion === 'system'}
                onChange={() => setMotion('system')}
              />
              <RadioOption
                name="motion"
                value="full"
                label="Full motion"
                description="Animate everything regardless of OS."
                checked={motion === 'full'}
                onChange={() => setMotion('full')}
              />
              <RadioOption
                name="motion"
                value="reduced"
                label="Reduced"
                description="Minimize transitions and animation."
                checked={motion === 'reduced'}
                onChange={() => setMotion('reduced')}
              />
            </div>
          </fieldset>
        </div>
      </Card>

      {isAdmin ? (
        <>
          <CustomFieldsSection />
          <WebhooksSection />
          <ApiKeysSection />
        </>
      ) : null}
    </div>
  );
}

function RadioOption({
  name,
  value,
  label,
  description,
  checked,
  onChange,
}: {
  name: string;
  value: Density | MotionPref | string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
          : 'border-[var(--border-default)] hover:bg-[var(--surface-sunken)]'
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
      />
      <div>
        <div className="text-sm font-medium text-[var(--fg-primary)]">{label}</div>
        <div className="text-xs text-[var(--fg-secondary)]">{description}</div>
      </div>
    </label>
  );
}

function ThemeOption({
  value,
  label,
  description,
  checked,
  onChange,
}: {
  value: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
          : 'border-[var(--border-default)] hover:bg-[var(--surface-sunken)]'
      }`}
    >
      <input
        type="radio"
        name="theme"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
      />
      <div>
        <div className="text-sm font-medium text-[var(--fg-primary)]">{label}</div>
        <div className="text-xs text-[var(--fg-secondary)]">{description}</div>
      </div>
    </label>
  );
}
