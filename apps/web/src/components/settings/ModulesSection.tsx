/**
 * ModulesSection — admin-only Settings tab to toggle optional app modules:
 * Agent Studio (Crew automation) visibility, and the AppFlowy "Collaborate"
 * workspace embed (enable + URL). Persists to OrgSettings.appModules.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, SectionHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';
import { useAppModules, useUpdateAppModules } from '@/hooks/useAppModules';
import type { AppModules, AppModulesUpdate } from '@bidstack/shared';

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 rounded border-[var(--border-default)] text-[var(--brand-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]"
      />
      <span>
        <span className="block text-sm font-medium text-[var(--fg-primary)]">{label}</span>
        <span className="block text-xs text-[var(--fg-tertiary)]">{hint}</span>
      </span>
    </label>
  );
}

export function ModulesSection() {
  const { data, isLoading } = useAppModules();
  const update = useUpdateAppModules();
  // Draft overlays the server value (no setState-in-effect); a key is "edited"
  // once it's present in draft.
  const [draft, setDraft] = useState<AppModulesUpdate>({});

  const view: AppModules = {
    agentStudioEnabled: draft.agentStudioEnabled ?? data?.agentStudioEnabled ?? false,
    appflowyEnabled: draft.appflowyEnabled ?? data?.appflowyEnabled ?? false,
    appflowyUrl: draft.appflowyUrl !== undefined ? draft.appflowyUrl : (data?.appflowyUrl ?? null),
    // SERUM is toggled in its own section; preserve the current value here.
    serumEnabled: draft.serumEnabled ?? data?.serumEnabled ?? false,
  };
  const set = <K extends keyof AppModulesUpdate>(k: K, v: AppModulesUpdate[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader title="Agent Studio" caption="Crew/agent automation control tower" />
        <div className="px-5 pb-4">
          <Toggle
            checked={view.agentStudioEnabled}
            onChange={(v) => set('agentStudioEnabled', v)}
            label="Show Agent Studio in the sidebar"
            hint="Hidden by default. When on, members can run crews; admins author them."
          />
        </div>
      </Card>

      <Card>
        <SectionHeader title="Collaborate (AppFlowy)" caption="Embedded collaborative workspace" />
        <div className="space-y-3 px-5 pb-4">
          <Toggle
            checked={view.appflowyEnabled}
            onChange={(v) => set('appflowyEnabled', v)}
            label="Enable the Collaborate workspace"
            hint="Adds a Collaborate section that embeds your AppFlowy instance."
          />
          <div>
            <label htmlFor="appflowy-url" className="mb-1 block text-xs font-medium text-[var(--fg-secondary)]">
              AppFlowy workspace URL
            </label>
            <Input
              id="appflowy-url"
              type="url"
              inputMode="url"
              placeholder="https://your-appflowy-instance.example/workspace"
              value={view.appflowyUrl ?? ''}
              onChange={(e) => set('appflowyUrl', e.target.value.trim() === '' ? null : e.target.value.trim())}
            />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-3">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-[var(--warning)]" ariaHidden />
            <p className="text-xs text-[var(--fg-tertiary)]">
              AppFlowy is a separate platform with its own login and data store — collaborative content lives outside
              Polo PreSales&apos;s tenancy. Self-hosting AppFlowy carries AGPL-3.0 obligations. Confirm with legal/PO before
              enabling. SSO between Clerk and AppFlowy is a separate setup. See docs/solutions/appflowy-workspace.md.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" disabled={isLoading || update.isPending} onClick={() => update.mutate(view)}>
          {update.isPending ? 'Saving…' : 'Save modules'}
        </Button>
      </div>
    </div>
  );
}
