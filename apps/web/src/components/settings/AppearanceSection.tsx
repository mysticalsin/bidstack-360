// Settings > Appearance. Theme, density, and motion preferences.

import { Card, SectionHeader } from '@/components/ui/Card';
import { useThemeStore } from '@/stores/theme';
import { usePreferences, type Density, type MotionPref } from '@/stores/preferences';
import { playUiSound, type UiSoundKind } from '@/lib/soundEngine';
import { cn } from '@/lib/cn';

export function AppearanceSection() {
  const { theme, setTheme } = useThemeStore();
  const density = usePreferences((s) => s.density);
  const setDensity = usePreferences((s) => s.setDensity);
  const motion = usePreferences((s) => s.motion);
  const setMotion = usePreferences((s) => s.setMotion);
  const visualEffects = usePreferences((s) => s.visualEffects);
  const setVisualEffects = usePreferences((s) => s.setVisualEffects);
  const sound = usePreferences((s) => s.sound);
  const setSound = usePreferences((s) => s.setSound);
  const soundVolume = usePreferences((s) => s.soundVolume);
  const setSoundVolume = usePreferences((s) => s.setSoundVolume);

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader title="Theme" caption="Choose your preferred color scheme." />
        <div className="p-5">
          <fieldset>
            <legend className="sr-only">Theme</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] p-3 transition-colors hover:bg-[var(--surface-sunken)]">
            <input
              type="checkbox"
              checked={visualEffects}
              onChange={(event) => setVisualEffects(event.target.checked)}
              className="mt-1 accent-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--fg-primary)]">
                Premium visual effects
              </span>
              <span className="block text-xs text-[var(--fg-secondary)]">
                Keep subtle depth and motion details on supported screens.
              </span>
            </span>
          </label>
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
                description="The default - balanced for most workflows."
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
          caption='"System" follows your OS reduced-motion preference.'
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

      <Card>
        <SectionHeader
          title="Sound"
          caption="Short, tactile UI sounds on clicks and confirmations. Interaction-only — never ambient."
        />
        <div className="space-y-4 p-5">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[var(--border-default)] p-3 transition-colors hover:bg-[var(--surface-sunken)]">
            <input
              type="checkbox"
              checked={sound}
              onChange={(event) => setSound(event.target.checked)}
              className="mt-1 accent-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
            />
            <span>
              <span className="block text-sm font-medium text-[var(--fg-primary)]">
                Sound effects
              </span>
              <span className="block text-xs text-[var(--fg-secondary)]">
                Play a soft click on button presses and a chime on save / error.
              </span>
            </span>
          </label>

          <div className={cn('transition-opacity', sound ? 'opacity-100' : 'opacity-50')}>
            <label
              htmlFor="sound-volume"
              className="flex items-center justify-between text-sm font-medium text-[var(--fg-primary)]"
            >
              Volume
              <span className="font-mono text-xs text-[var(--fg-secondary)]">
                {Math.round(soundVolume * 100)}%
              </span>
            </label>
            <input
              id="sound-volume"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(soundVolume * 100)}
              disabled={!sound}
              onChange={(event) => setSoundVolume(Number(event.target.value) / 100)}
              className="mt-2 h-2 w-full cursor-pointer accent-[var(--brand-primary)] disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)]"
              aria-label="Sound volume"
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--fg-tertiary)]">
              Preview
            </div>
            <div className="flex flex-wrap gap-2">
              <SoundTestChip kind="click" label="Click" volume={soundVolume} />
              <SoundTestChip kind="success" label="Success" volume={soundVolume} />
              <SoundTestChip kind="error" label="Error" volume={soundVolume} />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// Previews a single UI sound at the current volume, regardless of the on/off
// toggle — pressing it IS the intent, so it always plays (volume 0 stays silent).
function SoundTestChip({
  kind,
  label,
  volume,
}: {
  kind: UiSoundKind;
  label: string;
  volume: number;
}) {
  return (
    <button
      type="button"
      onClick={() => playUiSound(kind, volume)}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-md dark:rounded-full border border-[var(--border-default)] bg-[var(--surface-card)] px-3 text-xs font-medium text-[var(--fg-secondary)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-page)] dark:bg-[var(--surface-glass)] dark:backdrop-blur-md"
    >
      <span aria-hidden>▶</span>
      {label}
    </button>
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
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
        checked
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
          : 'border-[var(--border-default)] hover:bg-[var(--surface-sunken)]',
      )}
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
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
        checked
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary-tint)]'
          : 'border-[var(--border-default)] hover:bg-[var(--surface-sunken)]',
      )}
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
