import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ACCESS_POLICY_RESOURCES,
  ACCESS_POLICY_SENSITIVITIES,
  type AccessPolicyRule,
  type AccessPolicySubjectMatch,
  type PermissionKey,
} from '@bidstack/shared';

import { Button } from '@/components/ui/Button';

import { DAY_LABEL, RESOURCE_LABEL, actionsFor, describeRule, newRuleId, parseCountries } from './policy-format';

export interface PolicyBuilderOptions {
  roles: string[];
  teams: string[];
}

interface PolicyBuilderProps {
  rules: AccessPolicyRule[];
  onChange: (rules: AccessPolicyRule[]) => void;
  options: PolicyBuilderOptions;
  readOnly?: boolean;
}

const fieldsetClass = 'min-w-0 rounded-lg bg-surface-inset p-3';
const legendClass = 'px-1 text-xs font-medium text-fg-secondary';
const inputClass =
  'h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)] disabled:opacity-60';

function toggle<T>(list: readonly T[] | undefined, value: T, on: boolean): T[] {
  const current = list ?? [];
  return on ? [...current.filter((v) => v !== value), value] : current.filter((v) => v !== value);
}

function Checks<T extends string | number>({
  label,
  values,
  selected,
  render,
  onToggle,
  disabled,
}: {
  label: string;
  values: readonly T[];
  selected: readonly T[] | undefined;
  render?: (v: T) => string;
  onToggle: (value: T, on: boolean) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  if (values.length === 0) return null;
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span id={labelId} className="text-xs text-fg-secondary">
        {label}
      </span>
      {values.map((v) => (
        <label key={String(v)} className="inline-flex min-h-6 items-center gap-1.5 text-sm text-fg-primary">
          <input
            type="checkbox"
            checked={selected?.includes(v) ?? false}
            disabled={disabled}
            onChange={(e) => onToggle(v, e.target.checked)}
          />
          {render ? render(v) : String(v)}
        </label>
      ))}
    </div>
  );
}

function CountriesInput({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: readonly string[] | undefined;
  onCommit: (codes: string[]) => void;
  disabled?: boolean;
}) {
  const text = (value ?? []).join(', ');
  return (
    <label className="flex items-center gap-2 text-xs text-fg-secondary">
      {label}
      <input
        key={text}
        className={`${inputClass} max-w-48`}
        defaultValue={text}
        placeholder="FR, DE"
        disabled={disabled}
        onBlur={(e) => {
          const codes = parseCountries(e.target.value);
          if (codes.join(',') !== (value ?? []).join(',')) onCommit(codes);
        }}
      />
    </label>
  );
}

function SubjectFields({
  match,
  options,
  onChange,
  withCountries,
  disabled,
}: {
  match: AccessPolicySubjectMatch;
  options: PolicyBuilderOptions;
  onChange: (next: AccessPolicySubjectMatch) => void;
  withCountries: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-2">
      <Checks
        label={t('accessPolicies.roles', 'Roles')}
        values={options.roles}
        selected={match.roles}
        disabled={disabled}
        onToggle={(v, on) => onChange({ ...match, roles: toggle(match.roles, v, on) })}
      />
      <Checks
        label={t('accessPolicies.teams', 'Teams')}
        values={options.teams}
        selected={match.teams}
        disabled={disabled}
        onToggle={(v, on) => onChange({ ...match, teams: toggle(match.teams, v, on) })}
      />
      {withCountries && (
        <CountriesInput
          label={t('accessPolicies.userCountries', 'User countries')}
          value={match.countries}
          disabled={disabled}
          onCommit={(countries) => onChange({ ...match, countries })}
        />
      )}
    </div>
  );
}

function RuleCard({
  rule,
  index,
  total,
  options,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: {
  rule: AccessPolicyRule;
  index: number;
  total: number;
  options: PolicyBuilderOptions;
  readOnly?: boolean;
  onChange: (rule: AccessPolicyRule) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('settings');
  const n = index + 1;
  const offered = actionsFor(rule.then.resources);
  const c = rule.conditions;

  const setResources = (resource: (typeof ACCESS_POLICY_RESOURCES)[number], on: boolean) => {
    const resources = ACCESS_POLICY_RESOURCES.filter((r) =>
      r === resource ? on : rule.then.resources.includes(r),
    );
    if (resources.length === 0) return;
    const fits = actionsFor(resources);
    onChange({ ...rule, then: { resources, actions: rule.then.actions.filter((a) => fits.includes(a)) } });
  };

  return (
    <fieldset aria-label={t('accessPolicies.ruleN', 'Rule {{n}}', { n })} className="space-y-3 rounded-xl bg-surface-shell p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-fg-primary">{t('accessPolicies.ruleN', 'Rule {{n}}', { n })}</span>
        <select
          aria-label={t('accessPolicies.effect', 'Effect')}
          className={`${inputClass} w-auto`}
          value={rule.effect}
          disabled={readOnly}
          onChange={(e) => onChange({ ...rule, effect: e.target.value as AccessPolicyRule['effect'] })}
        >
          <option value="deny">{t('accessPolicies.deny', 'Deny')}</option>
          <option value="allow">{t('accessPolicies.allow', 'Allow')}</option>
        </select>
        {!readOnly && (
          <span className="ml-auto flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('accessPolicies.moveUp', 'Move rule {{n}} up', { n })}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('accessPolicies.moveDown', 'Move rule {{n}} down', { n })}
              disabled={index === total - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('accessPolicies.remove', 'Remove rule {{n}}', { n })}
              onClick={onRemove}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </span>
        )}
      </div>

      <p className="text-sm text-fg-primary">{describeRule(rule, t)}</p>

      <div className="grid gap-2 @3xl:grid-cols-2">
        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('accessPolicies.when', 'When')}</legend>
          <SubjectFields
            match={rule.when}
            options={options}
            withCountries
            disabled={readOnly}
            onChange={(when) => onChange({ ...rule, when })}
          />
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('accessPolicies.then', 'Then')}</legend>
          <div className="space-y-2">
            <Checks
              label={t('accessPolicies.resources', 'Resources')}
              values={ACCESS_POLICY_RESOURCES}
              selected={rule.then.resources}
              render={(r) => t(`accessPolicies.resource.${r}`, RESOURCE_LABEL[r])}
              disabled={readOnly}
              onToggle={setResources}
            />
            <Checks<PermissionKey>
              label={t('accessPolicies.actions', 'Actions')}
              values={offered}
              selected={rule.then.actions}
              disabled={readOnly}
              onToggle={(a, on) => onChange({ ...rule, then: { ...rule.then, actions: toggle(rule.then.actions, a, on) } })}
            />
            {rule.then.actions.length === 0 && (
              <p className="text-xs text-danger">{t('accessPolicies.pickAction', 'Pick at least one action.')}</p>
            )}
          </div>
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('accessPolicies.conditions', 'Conditions')}</legend>
          <div className="space-y-2">
            <CountriesInput
              label={t('accessPolicies.recordCountries', 'Record countries')}
              value={c.countries}
              disabled={readOnly}
              onCommit={(countries) => onChange({ ...rule, conditions: { ...c, countries } })}
            />
            <Checks
              label={t('accessPolicies.sensitivity', 'Sensitivity')}
              values={ACCESS_POLICY_SENSITIVITIES}
              selected={c.sensitivities}
              disabled={readOnly}
              onToggle={(s, on) => onChange({ ...rule, conditions: { ...c, sensitivities: toggle(c.sensitivities, s, on) } })}
            />
            <Checks
              label={t('accessPolicies.days', 'Days (UTC)')}
              values={[0, 1, 2, 3, 4, 5, 6]}
              selected={c.days}
              render={(d) => DAY_LABEL[d]!}
              disabled={readOnly}
              onToggle={(d, on) =>
                onChange({ ...rule, conditions: { ...c, days: toggle(c.days, d, on).sort((a, b) => a - b) } })
              }
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-secondary">
              <label className="inline-flex items-center gap-1.5">
                {t('accessPolicies.fromHour', 'From hour (UTC)')}
                <input
                  type="number"
                  min={0}
                  max={23}
                  className={`${inputClass} w-16`}
                  value={c.hours?.from ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const from = e.target.value === '' ? null : Number(e.target.value);
                    const { hours: _drop, ...rest } = c;
                    onChange({
                      ...rule,
                      conditions: from === null ? rest : { ...rest, hours: { from, to: c.hours?.to ?? 24 } },
                    });
                  }}
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                {t('accessPolicies.toHour', 'To hour (UTC)')}
                <input
                  type="number"
                  min={1}
                  max={24}
                  className={`${inputClass} w-16`}
                  value={c.hours?.to ?? ''}
                  disabled={readOnly}
                  onChange={(e) => {
                    const to = e.target.value === '' ? null : Number(e.target.value);
                    const { hours: _drop, ...rest } = c;
                    onChange({
                      ...rule,
                      conditions: to === null ? rest : { ...rest, hours: { from: c.hours?.from ?? 0, to } },
                    });
                  }}
                />
              </label>
            </div>
          </div>
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>{t('accessPolicies.except', 'Except')}</legend>
          <SubjectFields
            match={rule.except}
            options={options}
            withCountries={false}
            disabled={readOnly}
            onChange={(except) => onChange({ ...rule, except })}
          />
        </fieldset>
      </div>
    </fieldset>
  );
}

/** When / Then / Except rule rows. Rules apply in order only for display; any matching deny wins. */
export function PolicyBuilder({ rules, onChange, options, readOnly }: PolicyBuilderProps) {
  const { t } = useTranslation('settings');

  const add = () =>
    onChange([
      ...rules,
      {
        id: newRuleId(),
        effect: 'deny',
        when: {},
        then: { actions: ['companies:write'], resources: ['companies'] },
        conditions: {},
        except: {},
      },
    ]);

  const move = (index: number, delta: -1 | 1) => {
    const next = [...rules];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item!);
    onChange(next);
  };

  return (
    <div className="@container space-y-3">
      {rules.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          {t('accessPolicies.noRules', 'No rules yet. The RBAC matrix applies as is.')}
        </p>
      ) : (
        <ol className="space-y-3">
          {rules.map((rule, i) => (
            <li key={rule.id}>
              <RuleCard
                rule={rule}
                index={i}
                total={rules.length}
                options={options}
                readOnly={readOnly}
                onChange={(next) => onChange(rules.map((r, j) => (j === i ? next : r)))}
                onMove={(delta) => move(i, delta)}
                onRemove={() => onChange(rules.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ol>
      )}
      {!readOnly && (
        <Button variant="secondary" size="sm" onClick={add}>
          <Plus className="size-4" aria-hidden="true" />
          {t('accessPolicies.addRule', 'Add rule')}
        </Button>
      )}
    </div>
  );
}
