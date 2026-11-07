import { CircleCheck, Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AccessPolicyRulesSchema, type AccessPolicyRule } from '@bidstack/shared';

import { ApprovalsQueue, VersionHistory } from '@/components/access-policies/ApprovalsQueue';
import { ImpactPreview } from '@/components/access-policies/ImpactPreview';
import { PolicyBuilder } from '@/components/access-policies/PolicyBuilder';
import { Button } from '@/components/ui/Button';
import { confirm } from '@/components/ui/ConfirmDialog';
import { ErrorState, LoadingSkeleton } from '@/components/ui/StateMessages';
import { toast } from '@/components/ui/Toast';
import { Panel, Shell } from '@/components/vendor/tuffui/surface';
import { StatusPill } from '@/components/vendor/tuffui/status-pill';
import {
  useAccessPolicies,
  useAccessPolicyTransition,
  useSaveAccessPolicy,
  useSimulateAccessPolicy,
  type AccessPolicyList,
  type AccessPolicySimulation,
} from '@/hooks/useAccessPolicies';
import { useHasPermission } from '@/hooks/useCapabilities';
import { useRoles } from '@/hooks/useRoles';
import { useUserGroups } from '@/hooks/useUserGroups';

interface Draft {
  id?: string;
  name: string;
  rules: AccessPolicyRule[];
}

function latestDraft(data: AccessPolicyList | undefined): Draft | null {
  const row = data?.items.find((i) => (i.status === 'draft' || i.status === 'rejected') && i.createdById === data.viewerId);
  return row ? { id: row.id, name: row.name, rules: row.rules } : null;
}

const nameClass =
  'h-9 w-full max-w-sm rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2.5 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AccessPoliciesSection() {
  const { t } = useTranslation('settings');
  const canRead = useHasPermission('access-policies:read');
  const canWrite = useHasPermission('access-policies:write');
  const canApprove = useHasPermission('access-policies:approve');
  const list = useAccessPolicies();
  const roles = useRoles({ enabled: canWrite });
  const groups = useUserGroups();
  const save = useSaveAccessPolicy();
  const transition = useAccessPolicyTransition();
  const simulate = useSimulateAccessPolicy();

  const [edited, setEdited] = useState<Draft | null>(null);
  const [simulation, setSimulation] = useState<AccessPolicySimulation | null>(null);
  const [announcement, setAnnouncement] = useState('');

  if (!canRead) {
    return (
      <p className="text-sm text-fg-secondary">
        {t('accessPolicies.noAccess', 'Access policies are limited to administrators.')}
      </p>
    );
  }
  if (list.isLoading) return <LoadingSkeleton />;
  if (list.isError || !list.data) {
    return (
      <ErrorState
        title={t('accessPolicies.loadErrorTitle', 'Access policies did not load')}
        message={t('accessPolicies.loadError', 'Reload the page to try again.')}
      />
    );
  }

  const data = list.data;
  const draft: Draft = edited ?? latestDraft(data) ?? { name: t('accessPolicies.newName', 'New policy'), rules: [] };
  const valid = AccessPolicyRulesSchema.safeParse(draft.rules).success && draft.name.trim().length > 0;
  const options = {
    roles: (roles.data?.items ?? []).map((r) => r.name).sort(),
    teams: (groups.data?.items ?? []).map((g) => g.name).sort(),
  };
  const busy = transition.isPending || save.isPending;

  const change = (next: Partial<Draft>) => {
    setEdited({ ...draft, ...next });
    setSimulation(null);
  };

  const persist = async (): Promise<string | null> => {
    try {
      const row = await save.mutateAsync({ id: draft.id, name: draft.name.trim(), rules: draft.rules });
      setEdited({ id: row.id, name: row.name, rules: row.rules });
      return row.id;
    } catch (err) {
      toast.error(t('accessPolicies.saveError', 'Could not save the draft: {{message}}', { message: errorMessage(err) }));
      return null;
    }
  };

  const run = async (action: 'submit' | 'approve' | 'reject' | 'publish' | 'rollback', id: string, note?: string) => {
    try {
      const row = await transition.mutateAsync({ id, action, note });
      const messages = {
        submit: t('accessPolicies.submitted', 'Submitted for approval.'),
        approve: t('accessPolicies.approvedMsg', 'Approved. It can be published now.'),
        reject: t('accessPolicies.rejectedMsg', 'Rejected and returned to its author.'),
        publish: t('accessPolicies.published', 'Published v{{n}}.', { n: row.version }),
        rollback: t('accessPolicies.rolledBack', 'Rolled back. v{{n}} is live.', { n: row.version }),
      };
      setAnnouncement(messages[action]);
      if (action === 'submit') setEdited(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const submit = async () => {
    const id = await persist();
    if (id) await run('submit', id);
  };

  const rollback = async (id: string) => {
    const target = data.items.find((i) => i.id === id);
    const ok = await confirm({
      title: t('accessPolicies.rollbackTitle', 'Roll back to v{{n}}?', { n: target?.version }),
      description: t(
        'accessPolicies.rollbackDescription',
        'Its rules are published again as v{{next}}. The current version stays in the history.',
        { next: data.nextVersion },
      ),
      confirmLabel: t('accessPolicies.rollbackConfirm', 'Roll back'),
    });
    if (ok) await run('rollback', id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-fg-primary">{t('accessPolicies.title', 'Access policies')}</h2>
        <StatusPill size="sm" tone={data.enforcement ? 'positive' : 'neutral'} icon={data.enforcement ? CircleCheck : Info}>
          {data.enforcement
            ? t('accessPolicies.enforcing', 'Enforcing')
            : t('accessPolicies.enforcementOff', 'Enforcement off')}
        </StatusPill>
        {data.published && (
          <span className="text-sm text-fg-secondary">
            {t('accessPolicies.liveVersion', 'v{{n}} is live', { n: data.published.version })}
          </span>
        )}
      </div>
      <p aria-live="polite" className="text-sm text-fg-secondary empty:hidden">
        {announcement}
      </p>

      <div className="grid gap-4 @container lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Shell>
          <Panel className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-1 flex-col gap-1 text-xs text-fg-secondary">
                {t('accessPolicies.name', 'Policy name')}
                <input
                  className={nameClass}
                  value={draft.name}
                  maxLength={120}
                  disabled={!canWrite}
                  onChange={(e) => change({ name: e.target.value })}
                />
              </label>
              {canWrite && data.published && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    change({
                      id: undefined,
                      name: t('accessPolicies.copyName', 'Changes to v{{n}}', { n: data.published?.version }),
                      rules: data.published?.rules ?? [],
                    })
                  }
                >
                  {t('accessPolicies.startFromLive', 'Start from v{{n}}', { n: data.published.version })}
                </Button>
              )}
            </div>
            <PolicyBuilder
              rules={draft.rules}
              onChange={(rules) => change({ rules })}
              options={options}
              readOnly={!canWrite}
            />
            {canWrite && (
              <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
                <Button variant="secondary" size="sm" disabled={!valid || busy} onClick={() => void persist()}>
                  {t('accessPolicies.saveDraft', 'Save draft')}
                </Button>
                <Button size="sm" disabled={!valid || busy || draft.rules.length === 0} onClick={() => void submit()}>
                  {t('accessPolicies.submit', 'Submit for approval')}
                </Button>
              </div>
            )}
          </Panel>
        </Shell>

        <Shell>
          <Panel className="@container p-4">
            <ImpactPreview
              result={simulation}
              running={simulate.isPending}
              disabled={!canWrite || !valid}
              onRun={() =>
                simulate.mutate(draft.rules, {
                  onSuccess: setSimulation,
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            />
          </Panel>
        </Shell>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Shell>
          <Panel className="space-y-3 p-4">
            <h3 className="text-sm font-semibold text-fg-primary">{t('accessPolicies.approvals', 'Approvals')}</h3>
            <ApprovalsQueue
              items={data.items}
              currentUserId={data.viewerId}
              canApprove={canApprove}
              canPublish={canWrite}
              nextVersion={data.nextVersion}
              busy={busy}
              onApprove={(id, note) => run('approve', id, note)}
              onReject={(id, note) => run('reject', id, note)}
              onPublish={(id) => run('publish', id)}
            />
          </Panel>
        </Shell>
        <Shell>
          <Panel className="space-y-3 p-4">
            <h3 className="text-sm font-semibold text-fg-primary">{t('accessPolicies.versions', 'Versions')}</h3>
            <VersionHistory items={data.items} canWrite={canWrite} busy={busy} onRollback={(id) => void rollback(id)} />
          </Panel>
        </Shell>
      </div>
    </div>
  );
}
