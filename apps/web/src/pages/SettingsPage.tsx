import { Card, SectionHeader } from '@/components/ui/Card';
import { useThemeStore } from '@/stores/theme';

export function SettingsPage() {
  const { theme, setTheme } = useThemeStore();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[var(--fg-primary)] tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-[var(--fg-secondary)]">
          Personalize BidStack for your workflow.
        </p>
      </header>

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
    </div>
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
        className="mt-1 accent-[var(--brand-primary)]"
      />
      <div>
        <div className="text-sm font-medium text-[var(--fg-primary)]">{label}</div>
        <div className="text-xs text-[var(--fg-secondary)]">{description}</div>
      </div>
    </label>
  );
}
