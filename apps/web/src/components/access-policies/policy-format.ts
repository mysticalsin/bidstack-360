import {
  ACCESS_POLICY_RESOURCE_ACTIONS,
  type AccessPolicyResource,
  type AccessPolicyRule,
  type PermissionKey,
} from '@bidstack/shared';

type T = (key: string, fallback: string, vars?: Record<string, unknown>) => string;

export const RESOURCE_LABEL: Record<AccessPolicyResource, string> = {
  companies: 'Companies',
  msa: 'MSAs',
  opportunities: 'Opportunities',
  exports: 'Exports',
};

export const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Actions that fit at least one of the resources, in matrix order. */
export function actionsFor(resources: readonly AccessPolicyResource[]): PermissionKey[] {
  const out: PermissionKey[] = [];
  for (const r of resources) for (const a of ACCESS_POLICY_RESOURCE_ACTIONS[r]) if (!out.includes(a)) out.push(a);
  return out;
}

/** Two-letter codes from free text: "fr, de" -> ["FR", "DE"]. */
export function parseCountries(text: string): string[] {
  const codes = text
    .split(/[\s,;]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return [...new Set(codes)];
}

function either(list: readonly string[] | undefined): string | null {
  return list && list.length > 0 ? list.join(' or ') : null;
}

/** One plain sentence per rule, so the builder reads back what it will do. */
export function describeRule(rule: AccessPolicyRule, t: T): string {
  const effect = rule.effect === 'deny' ? t('accessPolicies.deny', 'Deny') : t('accessPolicies.allow', 'Allow');
  const resources = rule.then.resources.map((r) => t(`accessPolicies.resource.${r}`, RESOURCE_LABEL[r])).join(', ');

  const who = [
    either(rule.when.roles) && t('accessPolicies.sentence.role', 'role {{v}}', { v: either(rule.when.roles) }),
    either(rule.when.teams) && t('accessPolicies.sentence.team', 'team {{v}}', { v: either(rule.when.teams) }),
    either(rule.when.countries) &&
      t('accessPolicies.sentence.userCountry', 'users in {{v}}', { v: either(rule.when.countries) }),
  ].filter(Boolean);
  const subject = who.length > 0 ? who.join(t('accessPolicies.sentence.and', ' and ')) : t('accessPolicies.sentence.everyone', 'everyone');

  const c = rule.conditions;
  const clauses = [
    either(c.countries) && t('accessPolicies.sentence.recordCountry', 'when the record country is {{v}}', { v: either(c.countries) }),
    either(c.sensitivities) &&
      t('accessPolicies.sentence.sensitivity', 'when sensitivity is {{v}}', { v: either(c.sensitivities) }),
    c.days &&
      c.days.length > 0 &&
      t('accessPolicies.sentence.days', 'on {{v}}', { v: c.days.map((d) => DAY_LABEL[d]).join(', ') }),
    c.hours &&
      t('accessPolicies.sentence.hours', 'between {{from}}:00 and {{to}}:00 UTC', { from: c.hours.from, to: c.hours.to }),
  ].filter(Boolean);

  const exempt = [
    either(rule.except.roles) && t('accessPolicies.sentence.role', 'role {{v}}', { v: either(rule.except.roles) }),
    either(rule.except.teams) && t('accessPolicies.sentence.team', 'team {{v}}', { v: either(rule.except.teams) }),
    either(rule.except.countries) &&
      t('accessPolicies.sentence.userCountry', 'users in {{v}}', { v: either(rule.except.countries) }),
  ].filter(Boolean);

  const tail = [
    ...clauses,
    ...(exempt.length > 0 ? [t('accessPolicies.sentence.except', 'except {{v}}', { v: exempt.join(', ') })] : []),
  ];
  return t('accessPolicies.sentence.full', '{{effect}} {{actions}} on {{resources}} for {{subject}}{{tail}}.', {
    effect,
    actions: rule.then.actions.join(', ') || t('accessPolicies.sentence.noAction', 'no action'),
    resources,
    subject,
    tail: tail.length > 0 ? `, ${tail.join(', ')}` : '',
  });
}

export function newRuleId(): string {
  return `rule-${crypto.randomUUID().slice(0, 8)}`;
}
