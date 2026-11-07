import { Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { DivergingBars } from '@/components/vendor/tuffui/diverging-bars';
import { Inset } from '@/components/vendor/tuffui/surface';
import type { AccessPolicySimulation, AccessPolicySimulationSide } from '@/hooks/useAccessPolicies';

import { RESOURCE_LABEL } from './policy-format';

interface ImpactPreviewProps {
  result: AccessPolicySimulation | null;
  onRun: () => void;
  running: boolean;
  disabled?: boolean;
}

function Side({ title, side }: { title: string; side: AccessPolicySimulationSide }) {
  const { t } = useTranslation('settings');
  return (
    <section aria-label={title} className="min-w-0 space-y-2">
      <h4 className="text-sm font-medium text-fg-primary">{title}</h4>
      <ul className="space-y-1 text-sm">
        {side.users.map((u) => (
          <li key={u.userId} className="flex justify-between gap-3">
            <span className="truncate text-fg-primary">{u.name}</span>
            <span className="tabular-nums text-fg-secondary">{u.count}</span>
          </li>
        ))}
      </ul>
      {side.examples.length > 0 && (
        <ul className="space-y-1 text-xs text-fg-secondary">
          {side.examples.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              {t(
                'accessPolicies.example',
                '{{user}}: {{action}} on {{resource}}{{rule}}, {{date}}',
                {
                  user: e.userName,
                  action: e.action,
                  resource: RESOURCE_LABEL[e.resource],
                  rule: e.ruleId ? ` (rule ${e.ruleId})` : '',
                  date: e.at.slice(0, 10),
                },
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Who would gain or lose access if the draft were live, over the last 7 days of audit events. */
export function ImpactPreview({ result, onRun, running, disabled }: ImpactPreviewProps) {
  const { t } = useTranslation('settings');
  const [asTable, setAsTable] = useState(false);
  const changed = result ? result.gained.count + result.lost.count > 0 : false;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg-primary">{t('accessPolicies.impact', 'Impact preview')}</h3>
        <Button variant="secondary" size="sm" onClick={onRun} disabled={running || disabled}>
          <Play className="size-4" aria-hidden="true" />
          {running ? t('accessPolicies.running', 'Running') : t('accessPolicies.run', 'Run simulation')}
        </Button>
      </div>

      {!result ? (
        <p className="text-sm text-fg-secondary">
          {t(
            'accessPolicies.runPrompt',
            'Run a simulation to see who gains or loses access over the last 7 days.',
          )}
        </p>
      ) : !changed ? (
        <p className="text-sm text-fg-secondary">
          {t('accessPolicies.noChange', 'No one gains or loses access over the last 7 days.')}
        </p>
      ) : (
        <>
          <Inset className="space-y-1 p-3">
            <p className="flex flex-wrap gap-x-4 text-lg font-medium tabular-nums">
              <span className="text-danger">
                {result.lost.count === 1
                  ? t('accessPolicies.loseOne', '{{count}} loses access', { count: result.lost.count })
                  : t('accessPolicies.loseMany', '{{count}} lose access', { count: result.lost.count })}
              </span>
              <span className="text-success">
                {result.gained.count === 1
                  ? t('accessPolicies.gainOne', '{{count}} gains access', { count: result.gained.count })
                  : t('accessPolicies.gainMany', '{{count}} gain access', { count: result.gained.count })}
              </span>
            </p>
            <p className="text-xs text-fg-secondary">
              {t('accessPolicies.evaluated', 'Across {{count}} audit events in the last 7 days.', {
                count: result.evaluated,
              })}
            </p>
          </Inset>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
              {asTable ? t('accessPolicies.viewChart', 'View as chart') : t('accessPolicies.viewTable', 'View as table')}
            </Button>
          </div>
          <DivergingBars
            title={t('accessPolicies.daily', 'Daily access changes')}
            labels={result.byDay.map((d) => d.day.slice(5))}
            series={[
              {
                id: 'gained',
                label: t('accessPolicies.gains', 'Gains access'),
                values: result.byDay.map((d) => d.gained),
                color: 'var(--success)',
              },
            ]}
            below={{
              id: 'lost',
              label: t('accessPolicies.loses', 'Loses access'),
              values: result.byDay.map((d) => d.lost),
              color: 'var(--danger)',
            }}
            showTable={asTable}
            className="max-w-none"
          />

          <div className="grid gap-4 @3xl:grid-cols-2">
            {result.lost.count > 0 && <Side title={t('accessPolicies.loses', 'Loses access')} side={result.lost} />}
            {result.gained.count > 0 && (
              <Side title={t('accessPolicies.gains', 'Gains access')} side={result.gained} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
